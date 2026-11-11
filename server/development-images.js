'use strict';

// Photos of the four Development page sections (01 Measuring tape, 02 Sewing thread, 03 Needles,
// 04 Pattern pieces). Each section shows up to MAX_PER_SECTION photos as a swipeable carousel.
//
// They are rows of product_categories with kind = 'development' (see db/schema.sql), so they share the
// product photos' storage: every photo is uploaded straight into Google Drive
// "Fresco Website Images/<section name>/" and served from /media like the product photos.
// Unlike product photos they do not go through the AI image pipeline (that is for garment shots).
// Google Drive is the only source of these photos; a section with no photos shows an empty frame.
// (npm run media:migrate moved the original four pictures into Drive.)
//
// Approver API (/api/admin/development-images, approvers and administrators):
//   GET  /                         -> { drive: { configured }, limit, sections: [{ id, slug, name, images }] }
//   POST /sections/:id/images      body: photo bytes (application/octet-stream), header X-File-Name
//                                  ?replace=<imageId> puts the new photo in that photo's place
//                                  -> 201 { image }   (409 section_full when the section already has 3)
//   PUT  /sections/:id/order       { ids: [...] } every photo of the section, in the new order
//   POST /images/:id/remove

const express = require('express');
const { getPool } = require('./db.js');
const { requireRole, jsonOnly } = require('./auth.js');
const { isDriveConfigured, uploadWebsiteFile, trashWebsiteFile } = require('./drive.js');
const { sniffImage, driveNameFor } = require('./uploads.js');
const { writeCache } = require('./media.js');
const {
  categoryFolder, HttpError, withTransaction, setPositions, retireFromDrive, publicUrl, idParam, idList
} = require('./catalog.js');

const MAX_PER_SECTION = 3;
const MAX_BYTES = 12 * 1024 * 1024;   // the back office resizes photos before sending, so this is generous
const WEB_TYPES = ['image/webp', 'image/jpeg', 'image/png'];

function readFileName(req) {
  try {
    return decodeURIComponent(req.get('x-file-name') || '').trim().replace(/[\u0000-\u001f\\/]/g, '').slice(0, 200);
  } catch {
    return '';
  }
}

async function loadSections() {
  const pool = getPool();
  const [sections] = await pool.query(
    "SELECT id, slug, name FROM product_categories WHERE kind = 'development' ORDER BY position, id"
  );
  const [images] = sections.length ? await pool.query(
    `SELECT id, category_id, source, file_name FROM product_images
      WHERE status = 'published' AND category_id IN (?) ORDER BY position, id`,
    [sections.map((s) => s.id)]
  ) : [[]];
  return sections.map((section) => ({
    id: section.id,
    slug: section.slug,
    name: section.name,
    images: images.filter((img) => img.category_id === section.id).map((img) => ({ id: img.id, url: publicUrl(img) }))
  }));
}

async function sectionById(id) {
  const [[section]] = id
    ? await getPool().query("SELECT id, name FROM product_categories WHERE id = ? AND kind = 'development'", [id])
    : [[]];
  if (!section) throw new HttpError(404, 'not_found');
  return section;
}

function createDevelopmentImagesRouter() {
  const router = express.Router();
  router.use(requireRole('approver'));
  const json = [jsonOnly, express.json({ limit: '8kb' })];
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ error: error.code });
      if (error.code && String(error.code).startsWith('drive_')) return res.status(502).json({ error: error.code });
      return next(error);
    }
  };

  router.get('/', handle(async (req, res) => {
    res.json({ drive: { configured: isDriveConfigured() }, limit: MAX_PER_SECTION, sections: await loadSections() });
  }));

  router.post('/sections/:id/images',
    // The binary content type also blocks cross-site form posts (a form cannot send it).
    (req, res, next) => (/^application\/octet-stream\b/i.test(req.get('content-type') || '')
      ? next() : res.status(415).json({ error: 'binary_required' })),
    express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }),
    handle(async (req, res) => {
      if (!isDriveConfigured()) throw new HttpError(503, 'drive_not_configured');
      const section = await sectionById(idParam(req.params.id));
      const replaceId = req.query.replace === undefined ? null : idParam(String(req.query.replace));
      if (req.query.replace !== undefined && !replaceId) throw new HttpError(400, 'invalid_replace');

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buffer.length) throw new HttpError(400, 'empty_file');
      const type = sniffImage(buffer);
      if (!type || !WEB_TYPES.includes(type.mime)) throw new HttpError(400, 'unsupported_type');

      // Quick check before sending anything to Drive; the transaction below re-checks under a lock.
      const [current] = await getPool().query(
        "SELECT id FROM product_images WHERE status = 'published' AND category_id = ?", [section.id]
      );
      if (replaceId ? !current.some((row) => row.id === replaceId) : current.length >= MAX_PER_SECTION) {
        throw new HttpError(409, replaceId ? 'order_out_of_date' : 'section_full');
      }

      // 1. Drive stores the photo (the call resolves only once Drive confirms every byte).
      const folderId = await categoryFolder(section.id);
      const driveName = driveNameFor(readFileName(req) || 'photo', type.ext);
      const driveId = await uploadWebsiteFile({ folderId, name: driveName, mimeType: type.mime, buffer });
      const fileName = `${driveId}.${type.ext}`;

      // 2. Record it. If that fails (e.g. another approver filled the section first), the Drive file is trashed again.
      let result;
      try {
        result = await withTransaction(async (conn) => {
          await conn.query('SELECT id FROM product_categories WHERE id = ? FOR UPDATE', [section.id]);
          const [rows] = await conn.query(
            `SELECT id, source, file_name, website_file_id FROM product_images
              WHERE status = 'published' AND category_id = ? ORDER BY position, id FOR UPDATE`,
            [section.id]
          );
          let position = rows.length + 1;
          let replaced = [];
          if (replaceId) {
            const index = rows.findIndex((row) => row.id === replaceId);
            if (index < 0) throw new HttpError(409, 'order_out_of_date');
            position = index + 1;
            replaced = [rows[index]];
            await conn.query(
              "UPDATE product_images SET status = 'removed', position = NULL, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?",
              [req.user.id, replaceId]
            );
          } else if (rows.length >= MAX_PER_SECTION) {
            throw new HttpError(409, 'section_full');
          }
          const [insert] = await conn.query(
            `INSERT INTO product_images (status, source, category_id, position, file_name, website_file_id, drive_name, reviewed_by, reviewed_at)
             VALUES ('published', 'drive', ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
            [section.id, position, fileName, driveId, driveName, req.user.id]
          );
          return { id: insert.insertId, replaced };
        });
      } catch (error) {
        await trashWebsiteFile(driveId).catch(() => {});
        throw error;
      }

      // 3. Warm the cache with the bytes already here, so visitors never wait for Drive.
      await writeCache(fileName, buffer).catch(() => { /* /media fetches it from Drive on first view */ });
      await retireFromDrive(result.replaced);
      res.status(201).json({ ok: true, image: { id: result.id, url: publicUrl({ source: 'drive', file_name: fileName }) } });
    }));

  router.put('/sections/:id/order', ...json, handle(async (req, res) => {
    const section = await sectionById(idParam(req.params.id));
    const ids = idList(req.body?.ids);
    if (!ids) throw new HttpError(400, 'invalid_order');
    await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        "SELECT id FROM product_images WHERE status = 'published' AND category_id = ? FOR UPDATE", [section.id]
      );
      if (rows.length !== ids.length || !rows.every((r) => ids.includes(r.id))) throw new HttpError(409, 'order_out_of_date');
      await setPositions(conn, 'product_images', ids);
    });
    res.json({ ok: true });
  }));

  router.post('/images/:id/remove', ...json, handle(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) throw new HttpError(404, 'not_found');
    const row = await withTransaction(async (conn) => {
      const [[image]] = await conn.query(
        `SELECT i.id, i.category_id, i.source, i.file_name, i.website_file_id FROM product_images i
           JOIN product_categories c ON c.id = i.category_id AND c.kind = 'development'
          WHERE i.id = ? AND i.status = 'published' FOR UPDATE`,
        [id]
      );
      if (!image) throw new HttpError(404, 'not_found');
      await conn.query(
        "UPDATE product_images SET status = 'removed', position = NULL, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?",
        [req.user.id, id]
      );
      const [rest] = await conn.query(
        "SELECT id FROM product_images WHERE status = 'published' AND category_id = ? ORDER BY position, id FOR UPDATE",
        [image.category_id]
      );
      await setPositions(conn, 'product_images', rest.map((r) => r.id));
      return image;
    });
    await retireFromDrive([row]);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createDevelopmentImagesRouter, MAX_PER_SECTION };
