'use strict';

// Homepage front banners and their recurring rotation schedule live entirely in Google Drive / Apps Script.
// No MySQL row, OS cron job or always-running process is required.

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { requireRole, jsonOnly } = require('./auth.js');
const { sniffImage, driveNameFor } = require('./uploads.js');
const { writeCache } = require('./media.js');
const {
  isDriveConfigured, listHeroBanners, uploadHeroBanner, saveHeroRotation, trashHeroBanner, DriveError
} = require('./drive.js');

const MAX_BYTES = 12 * 1024 * 1024;
const WEB_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const FALLBACK_FILE = path.join(__dirname, '..', 'src', 'assets', 'hero-fashion-split-bg.webp');
let cache = { at: 0, value: null };

const extension = (mime) => ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[mime] || 'webp');
const image = (file) => ({
  id: file.id, name: file.name, created: file.created,
  url: `/media/${encodeURIComponent(`${file.id}.${extension(file.mimeType)}`)}`
});

async function files(force = false) {
  if (!force && cache.value && Date.now() - cache.at < 30_000) return cache.value;
  let value = await listHeroBanners();
  // First deployment: preserve the banner already on the website by putting it in Drive automatically.
  if (!value.files.length) {
    const buffer = await fs.readFile(FALLBACK_FILE);
    await uploadHeroBanner({
      name: 'homepage-front-banner-original.webp', mimeType: 'image/webp', buffer,
    });
    value = await listHeroBanners();
  }
  cache = { at: Date.now(), value };
  return value;
}

function activeFile(value, now = Date.now()) {
  const rows = value.files;
  if (!rows.length) return null;
  const schedule = value.schedule;
  if (!schedule?.anchor) return rows[0];
  const duration = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 }[schedule.unit];
  const anchor = new Date(schedule.anchor).getTime();
  if (!duration || !Number.isFinite(anchor) || now < anchor) return rows[0];
  const rotations = Math.floor((now - anchor) / (duration * schedule.every)) + 1;
  return rows[rotations % rows.length];
}

function readFileName(req) {
  try { return decodeURIComponent(req.get('x-file-name') || '').trim().replace(/[\u0000-\u001f\\/]/g, '').slice(0, 180); }
  catch { return ''; }
}

const handle = (work) => async (req, res, next) => {
  try { await work(req, res); }
  catch (error) {
    if (error instanceof DriveError) return res.status(error.code === 'drive_not_configured' ? 503 : 502).json({ error: error.code });
    return next(error);
  }
};

function createPublicHeroBannersRouter() {
  const router = express.Router();
  router.get('/', handle(async (req, res) => {
    if (!isDriveConfigured()) return res.json({ image: null });
    const current = activeFile(await files());
    return res.set('Cache-Control', 'no-store').json({ image: current ? image(current) : null });
  }));
  return router;
}

function createAdminHeroBannersRouter() {
  const router = express.Router();
  router.use(requireRole('approver'));

  router.get('/', handle(async (req, res) => {
    if (!isDriveConfigured()) return res.json({ configured: false, images: [], activeId: null });
    const value = await files(true);
    const active = activeFile(value);
    res.json({ configured: true, images: value.files.map(image), schedule: value.schedule, activeId: active?.id || null });
  }));

  router.post('/',
    (req, res, next) => (/^application\/octet-stream\b/i.test(req.get('content-type') || '')
      ? next() : res.status(415).json({ error: 'binary_required' })),
    express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }),
    handle(async (req, res) => {
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buffer.length) return res.status(400).json({ error: 'empty_file' });
      const type = sniffImage(buffer);
      if (!type || !WEB_TYPES.includes(type.mime)) return res.status(400).json({ error: 'unsupported_type' });
      const result = await uploadHeroBanner({
        name: driveNameFor(readFileName(req) || 'homepage-banner', type.ext), mimeType: type.mime, buffer
      });
      const fileName = `${result.id}.${type.ext}`;
      await writeCache(fileName, buffer).catch(() => {});
      cache.value = null;
      res.status(201).json({ ok: true, image: { id: result.id, url: `/media/${encodeURIComponent(fileName)}` } });
    }));

  router.put('/schedule', jsonOnly, express.json({ limit: '4kb' }), handle(async (req, res) => {
    const every = Number(req.body?.every);
    const unit = req.body?.unit;
    const anchor = req.body?.anchor;
    if (!Number.isInteger(every) || every < 1 || every > 999 || !['minutes', 'hours', 'days', 'weeks'].includes(unit)
      || !anchor || Number.isNaN(new Date(anchor).getTime())) return res.status(400).json({ error: 'invalid_schedule' });
    await saveHeroRotation({ every, unit, anchor: new Date(anchor).toISOString(), time: req.body?.time, weekday: req.body?.weekday });
    cache.value = null;
    res.json({ ok: true });
  }));

  router.delete('/:id', handle(async (req, res) => {
    await trashHeroBanner(req.params.id);
    cache.value = null;
    res.json({ ok: true });
  }));
  return router;
}

module.exports = { createPublicHeroBannersRouter, createAdminHeroBannersRouter };
