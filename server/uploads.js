'use strict';

// Contributors upload raw garment photographs; each one is sent straight to the Google Drive
// input folder ("Unprocessed Garment Images") for the image pipeline, and recorded in image_uploads.
//
//   POST /api/admin/uploads   body: the photo bytes, Content-Type: application/octet-stream
//                             header X-File-Name: the original file name (URL-encoded)
//                             -> 201 { upload }   one photo per request (the page sends bulk uploads one by one)
//   GET  /api/admin/uploads   -> { configured, statusFromDrive, checkedAt, uploads }
//                             own uploads (administrators see everyone's), each with a live `stage`:
//                               waiting  - still in "Unprocessed Garment Images" (the AI has not run yet)
//                               processed - the AI made a product image; `detail` says whether it awaits
//                                           approval, is on the website (and in which folder) or was rejected
//                               failed   - the pipeline moved it to "_failed"
//                               upload_failed - it never reached Drive
//
// The Content-Type check also blocks cross-site form posts (a form cannot send application/octet-stream).

const crypto = require('crypto');
const express = require('express');
const { getPool } = require('./db.js');
const { requireRole } = require('./auth.js');
const { isDriveConfigured, uploadToDrive, listProcessed, locateFiles } = require('./drive.js');

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PER_HOUR = 300;

/** Identifies the real file type from its first bytes; the browser's name and type are not trusted. */
function sniffImage(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buffer.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buffer.toString('latin1', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return { mime: 'image/heic', ext: 'heic' };
    if (['mif1', 'msf1'].includes(brand)) return { mime: 'image/heif', ext: 'heif' };
  }
  return null;
}

/**
 * Drive file name: date + random id + the original name, e.g. "2026-11-02_a1b2c3_IMG_0412.jpg".
 * The pipeline skips outputs whose name already exists, so two phones' "IMG_0001.jpg" must not collide.
 */
function driveNameFor(originalName, ext) {
  const base = originalName.replace(/\.[^.]*$/, '').normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'photo';
  const date = new Date().toISOString().slice(0, 10);
  return `${date}_${crypto.randomBytes(3).toString('hex')}_${base}.${ext}`;
}

const baseName = (name) => String(name || '').replace(/\.[^.]*$/, '').toLowerCase();

// Drive is asked at most every 30 seconds, however many people have the page open.
const STATUS_TTL = 30 * 1000;
let processedCache = { at: 0, files: [] };
const locationCache = new Map();   // drive file id -> { at, where } for originals not yet final

async function processedOutputs() {
  if (Date.now() - processedCache.at > STATUS_TTL) {
    processedCache = { at: Date.now(), files: await listProcessed() };
  }
  return processedCache.files;
}

/** Live stage of each upload, worked out from Drive and the product_images table. */
async function withLiveStatus(rows, { askDrive = true } = {}) {
  const pool = getPool();
  const uploaded = rows.filter((row) => row.status === 'uploaded');
  const bases = [...new Set(uploaded.map((row) => baseName(row.drive_name)))];

  // 1. Pipeline output already known to the website (waiting for approval, published, rejected...).
  const outputs = new Map();
  if (bases.length) {
    const [images] = await pool.query(
      `SELECT i.drive_name, i.status, c.name AS category FROM product_images i
         LEFT JOIN product_categories c ON c.id = i.category_id
        WHERE i.source IN ('pipeline', 'drive') AND i.drive_name IS NOT NULL`
    );
    for (const image of images) outputs.set(baseName(image.drive_name), image);
  }

  // 2. Pipeline output in Drive "Processed Images/<category>/" (with the AI's category).
  let driveOk = true;
  const aiFolder = new Map();
  try {
    const files = askDrive ? await processedOutputs() : processedCache.files;
    for (const file of files) aiFolder.set(baseName(file.name), file.folder);
  } catch (error) {
    driveOk = false;
    console.error(`[${new Date().toISOString()}] upload status: listing Processed Images failed:`, error.message);
  }

  // 3. Where the originals are now (script version 5): only for uploads that are not settled yet.
  const unsettled = uploaded.filter((row) => row.drive_file_id && !outputs.has(baseName(row.drive_name))
    && !aiFolder.has(baseName(row.drive_name)) && !['failed', 'missing'].includes(row.pipeline_location));
  const stale = unsettled.filter((row) => Date.now() - (locationCache.get(row.drive_file_id)?.at || 0) > STATUS_TTL);
  let statusFromDrive = true;
  if (askDrive && stale.length && driveOk) {
    try {
      const found = await locateFiles(stale.map((row) => row.drive_file_id));
      if (found === null) statusFromDrive = false;
      else {
        for (const row of stale) {
          const where = found[row.drive_file_id] || 'missing';
          locationCache.set(row.drive_file_id, { at: Date.now(), where });
          if (where !== row.pipeline_location) {
            await pool.query('UPDATE image_uploads SET pipeline_location = ? WHERE id = ?', [where, row.id]);
            row.pipeline_location = where;
          }
        }
      }
    } catch (error) {
      driveOk = false;
      console.error(`[${new Date().toISOString()}] upload status: locating originals failed:`, error.message);
    }
  }

  const DETAIL = {
    pending: () => 'Waiting for approval',
    published: (o) => `On the website · ${o.category}`,
    rejected: () => 'Rejected by the approver',
    removed: () => 'Was on the website, now removed'
  };
  const uploads = rows.map(({ drive_file_id: ignored, pipeline_location: where, ...row }) => {
    const base = baseName(row.drive_name);
    let stage;
    let detail;
    if (row.status !== 'uploaded') {
      stage = 'upload_failed';
      detail = 'Did not reach Google Drive';
    } else if (outputs.has(base)) {
      const output = outputs.get(base);
      stage = 'processed';
      detail = (DETAIL[output.status] || (() => 'Processed'))(output);
    } else if (aiFolder.has(base)) {
      stage = 'processed';
      detail = 'Waiting for approval';
    } else if (where === 'failed') {
      stage = 'failed';
      detail = 'The AI pipeline could not process this photo';
    } else if (where === 'missing' || where === 'elsewhere') {
      stage = 'failed';
      detail = where === 'missing' ? 'Deleted from Google Drive' : 'Moved out of the upload folder in Drive';
    } else if (where === 'done') {
      stage = 'processed';
      detail = 'Processed';
    } else {
      stage = 'waiting';
      detail = 'Waiting for the AI pipeline';
    }
    return { ...row, stage, detail, aiCategory: aiFolder.get(base) || null };
  });
  return { uploads, statusFromDrive: statusFromDrive && driveOk };
}

function readFileName(req) {
  try {
    const name = decodeURIComponent(req.get('x-file-name') || '').trim();
    return name.replace(/[\u0000-\u001f\\/]/g, '').slice(0, 200);
  } catch {
    return '';
  }
}

function createUploadsRouter() {
  const router = express.Router();
  const hits = new Map();
  const overLimit = (userId) => {
    const now = Date.now();
    const times = (hits.get(userId) || []).filter((t) => now - t < 3600 * 1000);
    times.push(now);
    hits.set(userId, times);
    return times.length > MAX_PER_HOUR;
  };

  router.get('/', requireRole('contributor'), async (req, res, next) => {
    try {
      const all = req.user.role === 'admin';
      const [rows] = await getPool().query(
        `SELECT up.id, up.original_name, up.drive_name, up.drive_file_id, up.size_bytes, up.status, up.error,
                up.pipeline_location, up.created_at, u.name AS uploaded_by
           FROM image_uploads up LEFT JOIN users u ON u.id = up.user_id
          ${all ? '' : 'WHERE up.user_id = ?'}
          ORDER BY up.id DESC LIMIT 100`,
        all ? [] : [req.user.id]
      );
      const configured = isDriveConfigured();
      // ?quick=1 answers from what is already known (no Drive call), so the list appears at once.
      const askDrive = req.query.quick !== '1';
      const live = configured ? await withLiveStatus(rows, { askDrive }) : { uploads: rows.map((r) => ({ ...r, stage: 'waiting' })), statusFromDrive: false };
      res.set('Cache-Control', 'no-store');
      return res.json({ configured, live: askDrive, statusFromDrive: live.statusFromDrive, checkedAt: askDrive ? new Date().toISOString() : null, uploads: live.uploads });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/',
    requireRole('contributor'),
    (req, res, next) => (/^application\/octet-stream\b/i.test(req.get('content-type') || '')
      ? next() : res.status(415).json({ error: 'binary_required' })),
    express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }),
    async (req, res, next) => {
      if (!isDriveConfigured()) return res.status(503).json({ error: 'drive_not_configured' });
      const originalName = readFileName(req);
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!originalName) return res.status(400).json({ error: 'missing_name' });
      if (!buffer.length) return res.status(400).json({ error: 'empty_file' });
      const type = sniffImage(buffer);
      if (!type) return res.status(400).json({ error: 'unsupported_type' });
      if (overLimit(req.user.id)) return res.status(429).json({ error: 'rate_limited' });

      const driveName = driveNameFor(originalName, type.ext);
      const who = req.user.username;
      const record = async (status, driveId, error) => {
        const [result] = await getPool().query(
          `INSERT INTO image_uploads (user_id, original_name, drive_name, mime_type, size_bytes, drive_file_id, status, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.user.id, originalName, driveName, type.mime, buffer.length, driveId, status, error]
        );
        return result.insertId;
      };

      try {
        const file = await uploadToDrive({
          name: driveName,
          mimeType: type.mime,
          buffer,
          description: `Uploaded by ${req.user.name} (${who}) from the Fresco NY back office on ${new Date().toISOString()}. Original file: ${originalName}`
        });
        const id = await record('uploaded', file.id, null);
        return res.status(201).json({ upload: { id, original_name: originalName, drive_name: driveName, status: 'uploaded' } });
      } catch (error) {
        if (!error.code || !error.code.startsWith('drive_')) return next(error);
        console.error(`[${new Date().toISOString()}] drive upload failed (${driveName}):`, error.message);
        try { await record('failed', null, error.message.slice(0, 255)); } catch (dbError) { console.error(dbError); }
        return res.status(502).json({ error: error.code });
      }
    });

  return router;
}

module.exports = { createUploadsRouter, sniffImage, driveNameFor };
