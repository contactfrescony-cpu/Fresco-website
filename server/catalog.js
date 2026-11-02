'use strict';

// Website product categories and their photos, managed by approvers on the "Website Images" page.
//
// Flow: contributor upload -> Drive pipeline -> "Processed Images/<category>/" -> sync() lists each new
// finished image as 'pending' -> an approver drags it onto a category -> Drive copies it into
// "Fresco Website Images/<category>/" and it is published at position 1.
// A category shows at most MAX_PER_CATEGORY photos; publishing into a full one removes its last photo
// (its Drive file goes to the Drive trash). Google Drive is the storage for every website photo; this
// server keeps only a disposable cache (server/media.js). MySQL holds the order, names and settings.
//
// Image sources: 'drive' = published photo stored in Drive (file_name "<driveId>.<ext>", served at /media);
// 'pipeline' = finished image waiting for approval; 'legacy' = an original gallery/ file not yet moved
// to Drive (npm run media:migrate moves them).
//
// Approver API (/api/admin/review, approvers and administrators):
//   GET    /                          -> { drive, limits, pending, categories (with their images) }
//   POST   /sync                      -> fetch new finished images from Drive
//   GET    /pending/:id/image         -> the pending image itself (never public)
//   POST   /pending/:id/publish       { categoryId } -> { removed: [...] } (photos rotated out)
//   POST   /pending/:id/reject
//   POST   /images/:id/remove
//   POST   /images/:id/move           { categoryId } -> goes first in that folder; { removed: [...] }
//   PUT    /categories/order          { ids: [...] }   every category, in the new order
//   PUT    /categories/:id/images     { ids: [...] }   every photo of the category, in the new order
//   PATCH  /categories/:id            { name?, description?, homeTagline?, showOnHome?, showOnProducts? }
//
// Public API: GET /api/products/categories, and publishedImagesFor(slug) for /api/gallery/:slug.

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const { getPool } = require('./db.js');
const { requireRole, jsonOnly } = require('./auth.js');
const {
  isDriveConfigured, listProcessed, downloadProcessed, ensureWebsiteFolder, copyToWebsite, trashWebsiteFile, moveWebsiteFile
} = require('./drive.js');
const { sniffImage } = require('./uploads.js');
const { PENDING_DIR, writeCache, removeCached } = require('./media.js');

const MAX_PER_CATEGORY = 20;
const MAX_ON_HOME = 4;
const SYNC_BATCH = 20;           // finished images copied per sync
const SYNC_MIN_INTERVAL = 20 * 1000;

const publicUrl = (row) => (row.source === 'legacy'
  ? `/${row.file_name.split('/').map(encodeURIComponent).join('/')}`
  : `/media/${encodeURIComponent(row.file_name)}`);
const bool = (value) => Boolean(Number(value));

async function removeFileQuietly(file) {
  try { await fs.unlink(file); } catch { /* already gone */ }
}

/** Sets position 1..n in the given order with one statement. */
async function setPositions(conn, table, ids, start = 1) {
  if (!ids.length) return;
  const cases = ids.map(() => 'WHEN ? THEN ?').join(' ');
  const params = ids.flatMap((id, index) => [id, start + index]);
  await conn.query(`UPDATE ${table} SET position = CASE id ${cases} END WHERE id IN (?)`, [...params, ids]);
}

async function withTransaction(work) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/** Trashes the Drive files of photos that left the website, and drops them from the cache. Never throws. */
async function retireFromDrive(rows) {
  for (const row of rows) {
    if (row.source !== 'drive') continue;
    await removeCached(row.file_name);
    try {
      await trashWebsiteFile(row.website_file_id);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] could not trash Drive file ${row.website_file_id}:`, error.message);
    }
  }
}

/** The category's folder in "Fresco Website Images", created on first use and remembered. */
async function categoryFolder(categoryId) {
  const pool = getPool();
  const [[category]] = await pool.query('SELECT id, name, drive_folder_id FROM product_categories WHERE id = ?', [categoryId]);
  if (!category) throw new HttpError(400, 'invalid_category');
  if (category.drive_folder_id) return category.drive_folder_id;
  const folderId = await ensureWebsiteFolder({ name: category.name });
  await pool.query('UPDATE product_categories SET drive_folder_id = ? WHERE id = ? AND drive_folder_id IS NULL', [folderId, categoryId]);
  const [[saved]] = await pool.query('SELECT drive_folder_id FROM product_categories WHERE id = ?', [categoryId]);
  return saved.drive_folder_id;
}

/* ---------- Drive sync ---------- */

let syncRunning = null;
let lastSync = { at: 0, result: null };

/** Copies new finished images from Drive as 'pending'. Never changes anything in Drive. */
async function sync({ force = false } = {}) {
  if (syncRunning) return syncRunning;
  if (!force && Date.now() - lastSync.at < SYNC_MIN_INTERVAL && lastSync.result) return { ...lastSync.result, cached: true };
  syncRunning = (async () => {
    const pool = getPool();
    const files = await listProcessed();
    const known = new Set();
    if (files.length) {
      const [rows] = await pool.query('SELECT drive_file_id FROM product_images WHERE drive_file_id IN (?)', [files.map((f) => f.id)]);
      rows.forEach((row) => known.add(row.drive_file_id));
    }
    const fresh = files.filter((file) => !known.has(file.id));
    const [categories] = await pool.query('SELECT id, drive_folder FROM product_categories');
    const byFolder = new Map(categories.map((c) => [c.drive_folder.toLowerCase(), c.id]));

    await fs.mkdir(PENDING_DIR, { recursive: true });
    let imported = 0;
    const errors = [];
    for (const file of fresh.slice(0, SYNC_BATCH)) {
      let target = null;
      try {
        const { buffer } = await downloadProcessed(file.id);
        const type = sniffImage(buffer);
        if (!type || !['image/webp', 'image/jpeg', 'image/png'].includes(type.mime)) throw new Error('not a web image');
        const fileName = `${crypto.randomBytes(9).toString('base64url')}.${type.ext}`;
        target = path.join(PENDING_DIR, fileName);
        await fs.writeFile(target, buffer, { flag: 'wx' });
        await pool.query(
          `INSERT INTO product_images (status, source, file_name, suggested_category_id, drive_file_id, drive_name, drive_folder)
           VALUES ('pending', 'pipeline', ?, ?, ?, ?, ?)`,
          [fileName, byFolder.get(String(file.folder).toLowerCase()) ?? null, file.id, String(file.name).slice(0, 255), String(file.folder).slice(0, 80)]
        );
        imported += 1;
      } catch (error) {
        if (target) await removeFileQuietly(target);
        if (error.code === 'ER_DUP_ENTRY') continue;   // imported by a parallel sync
        errors.push(`${file.name}: ${error.message}`);
        console.error(`[${new Date().toISOString()}] review sync: ${file.name}:`, error.message);
      }
    }
    const result = { imported, remaining: Math.max(0, fresh.length - SYNC_BATCH), errors: errors.length };
    lastSync = { at: Date.now(), result };
    return result;
  })();
  try {
    return await syncRunning;
  } finally {
    syncRunning = null;
  }
}

/* ---------- Reads ---------- */

async function loadReviewState() {
  const pool = getPool();
  const [categories] = await pool.query(
    `SELECT id, slug, name, description, home_tagline, position, show_on_home, show_on_products
       FROM product_categories ORDER BY position, id`
  );
  const [images] = await pool.query(
    `SELECT id, category_id, position, source, file_name FROM product_images
      WHERE status = 'published' ORDER BY position, id`
  );
  const [pending] = await pool.query(
    `SELECT id, suggested_category_id, drive_name, drive_folder, created_at FROM product_images
      WHERE status = 'pending' ORDER BY created_at DESC, id DESC`
  );
  return {
    drive: { configured: isDriveConfigured(), lastSyncAt: lastSync.at ? new Date(lastSync.at).toISOString() : null },
    limits: { perCategory: MAX_PER_CATEGORY, onHome: MAX_ON_HOME },
    pending: pending.map((row) => ({
      id: row.id,
      url: `/api/admin/review/pending/${row.id}/image`,
      suggestedCategoryId: row.suggested_category_id,
      driveName: row.drive_name,
      driveFolder: row.drive_folder,
      createdAt: row.created_at
    })),
    categories: categories.map((c) => ({
      id: c.id, slug: c.slug, name: c.name, description: c.description, homeTagline: c.home_tagline,
      showOnHome: bool(c.show_on_home), showOnProducts: bool(c.show_on_products),
      images: images.filter((img) => img.category_id === c.id).map((img) => ({ id: img.id, url: publicUrl(img), source: img.source }))
    }))
  };
}

/** Public: categories in display order (also used by the homepage and Products page). */
async function publicCategories() {
  const [rows] = await getPool().query(
    `SELECT slug, name, description, home_tagline, show_on_home, show_on_products
       FROM product_categories ORDER BY position, id`
  );
  return rows.map((r) => ({
    slug: r.slug, name: r.name, description: r.description, homeTagline: r.home_tagline,
    showOnHome: bool(r.show_on_home), showOnProducts: bool(r.show_on_products)
  }));
}

/**
 * Published photo URLs of a category, in order. Returns null when the database is not available
 * or the slug is not a product category, so the caller can fall back to the gallery/ folders.
 */
async function publishedImagesFor(slug) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const [[category]] = await pool.query('SELECT id FROM product_categories WHERE slug = ?', [slug]);
    if (!category) return null;
    const [rows] = await pool.query(
      "SELECT source, file_name FROM product_images WHERE status = 'published' AND category_id = ? ORDER BY position, id",
      [category.id]
    );
    return rows.map(publicUrl);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] gallery from database failed, using folders:`, error.message);
    return null;
  }
}

/* ---------- Routers ---------- */

const idParam = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 && String(id) === String(value) ? id : null;
};
const idList = (value) => (Array.isArray(value) && value.length <= 200 && value.every((v) => Number.isInteger(v) && v > 0)
  && new Set(value).size === value.length ? value : null);

function createReviewRouter() {
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

  router.get('/', handle(async (req, res) => res.json(await loadReviewState())));

  router.post('/sync', ...json, handle(async (req, res) => {
    if (!isDriveConfigured()) throw new HttpError(503, 'drive_not_configured');
    res.json(await sync({ force: req.body?.force === true }));
  }));

  router.get('/pending/:id/image', handle(async (req, res) => {
    const id = idParam(req.params.id);
    const [[row]] = id ? await getPool().query("SELECT file_name, drive_file_id FROM product_images WHERE id = ? AND status = 'pending'", [id]) : [[]];
    if (!row) throw new HttpError(404, 'not_found');
    const file = path.join(PENDING_DIR, path.basename(row.file_name));
    // The local copy is only a cache of the Drive file; fetch it again if it was cleared.
    try { await fs.access(file); } catch {
      const { buffer } = await downloadProcessed(row.drive_file_id);
      await fs.mkdir(PENDING_DIR, { recursive: true });
      await fs.writeFile(file, buffer);
    }
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'not_found' });
    });
  }));

  router.post('/pending/:id/publish', ...json, handle(async (req, res) => {
    const id = idParam(req.params.id);
    const categoryId = Number.isInteger(req.body?.categoryId) ? req.body.categoryId : null;
    if (!id) throw new HttpError(404, 'not_found');
    if (!categoryId) throw new HttpError(400, 'invalid_category');

    const [[photo]] = await getPool().query(
      "SELECT id, file_name, drive_file_id, drive_name FROM product_images WHERE id = ? AND status = 'pending'", [id]
    );
    if (!photo) throw new HttpError(409, 'not_pending');
    const folderId = await categoryFolder(categoryId);
    const ext = path.extname(photo.file_name).slice(1).toLowerCase();

    // 1. Drive copies the finished image into the website folder (Processed Images is left untouched).
    const copy = await copyToWebsite({ fileId: photo.drive_file_id, folderId, name: photo.drive_name || photo.file_name });
    const fileName = `${copy.id}.${ext}`;

    // 2. Record it. If that fails (e.g. another approver published it first), the Drive copy is trashed again.
    let removed;
    try {
      removed = await withTransaction(async (conn) => {
        const [[image]] = await conn.query("SELECT id FROM product_images WHERE id = ? AND status = 'pending' FOR UPDATE", [id]);
        if (!image) throw new HttpError(409, 'not_pending');
        // Locking the category row makes simultaneous publishes into one category take turns.
        await conn.query('SELECT id FROM product_categories WHERE id = ? FOR UPDATE', [categoryId]);
        const [current] = await conn.query(
          "SELECT id, source, file_name, website_file_id FROM product_images WHERE status = 'published' AND category_id = ? ORDER BY position, id FOR UPDATE",
          [categoryId]
        );
        const keep = current.slice(0, MAX_PER_CATEGORY - 1);
        const out = current.slice(MAX_PER_CATEGORY - 1);
        if (out.length) {
          await conn.query(
            "UPDATE product_images SET status = 'removed', position = NULL, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id IN (?)",
            [req.user.id, out.map((r) => r.id)]
          );
        }
        await conn.query(
          `UPDATE product_images SET status = 'published', source = 'drive', category_id = ?, position = 1, file_name = ?,
                  website_file_id = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?`,
          [categoryId, fileName, copy.id, req.user.id, id]
        );
        await setPositions(conn, 'product_images', keep.map((r) => r.id), 2);
        return out;
      });
    } catch (error) {
      await trashWebsiteFile(copy.id).catch(() => {});
      throw error;
    }

    // 3. Warm the cache with the copy already here, so visitors never wait for Drive.
    const pendingFile = path.join(PENDING_DIR, path.basename(photo.file_name));
    try {
      await writeCache(fileName, await fs.readFile(pendingFile));
      await removeFileQuietly(pendingFile);
    } catch { /* not cached locally: /media fetches it from Drive on first view */ }

    await retireFromDrive(removed);
    res.json({ ok: true, removed: removed.map((row) => ({ id: row.id, url: publicUrl(row) })) });
  }));

  router.post('/pending/:id/reject', ...json, handle(async (req, res) => {
    const id = idParam(req.params.id);
    const [[row]] = id ? await getPool().query("SELECT file_name FROM product_images WHERE id = ? AND status = 'pending'", [id]) : [[]];
    if (!row) throw new HttpError(404, 'not_found');
    await getPool().query(
      "UPDATE product_images SET status = 'rejected', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'",
      [req.user.id, id]
    );
    await removeFileQuietly(path.join(PENDING_DIR, path.basename(row.file_name)));
    res.json({ ok: true });
  }));

  // Moving a published photo to another folder: it goes first there (a full folder drops its last photo),
  // and its Drive file moves to that folder's Drive folder.
  router.post('/images/:id/move', ...json, handle(async (req, res) => {
    const id = idParam(req.params.id);
    const categoryId = Number.isInteger(req.body?.categoryId) ? req.body.categoryId : null;
    if (!id) throw new HttpError(404, 'not_found');
    if (!categoryId) throw new HttpError(400, 'invalid_category');
    const [[photo]] = await getPool().query(
      "SELECT id, category_id, source, website_file_id FROM product_images WHERE id = ? AND status = 'published'", [id]
    );
    if (!photo) throw new HttpError(404, 'not_found');
    if (photo.category_id === categoryId) throw new HttpError(400, 'same_folder');

    const toFolder = await categoryFolder(categoryId);
    const fromFolder = photo.source === 'drive' ? await categoryFolder(photo.category_id) : null;
    if (photo.source === 'drive') await moveWebsiteFile(photo.website_file_id, toFolder);

    let removed;
    try {
      removed = await withTransaction(async (conn) => {
        const [[still]] = await conn.query(
          "SELECT id FROM product_images WHERE id = ? AND status = 'published' AND category_id = ? FOR UPDATE", [id, photo.category_id]
        );
        if (!still) throw new HttpError(409, 'order_out_of_date');
        // Lock both folders in id order so two simultaneous moves cannot deadlock.
        await conn.query('SELECT id FROM product_categories WHERE id IN (?) ORDER BY id FOR UPDATE', [[photo.category_id, categoryId]]);
        const [target] = await conn.query(
          "SELECT id, source, file_name, website_file_id FROM product_images WHERE status = 'published' AND category_id = ? ORDER BY position, id FOR UPDATE",
          [categoryId]
        );
        const keep = target.slice(0, MAX_PER_CATEGORY - 1);
        const out = target.slice(MAX_PER_CATEGORY - 1);
        if (out.length) {
          await conn.query(
            "UPDATE product_images SET status = 'removed', position = NULL, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id IN (?)",
            [req.user.id, out.map((r) => r.id)]
          );
        }
        await conn.query(
          'UPDATE product_images SET category_id = ?, position = 1, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?',
          [categoryId, req.user.id, id]
        );
        await setPositions(conn, 'product_images', keep.map((r) => r.id), 2);
        const [rest] = await conn.query(
          "SELECT id FROM product_images WHERE status = 'published' AND category_id = ? ORDER BY position, id FOR UPDATE",
          [photo.category_id]
        );
        await setPositions(conn, 'product_images', rest.map((r) => r.id));
        return out;
      });
    } catch (error) {
      if (fromFolder) await moveWebsiteFile(photo.website_file_id, fromFolder).catch(() => {});
      throw error;
    }
    await retireFromDrive(removed);
    res.json({ ok: true, removed: removed.map((row) => ({ id: row.id, url: publicUrl(row) })) });
  }));

  router.post('/images/:id/remove', ...json, handle(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) throw new HttpError(404, 'not_found');
    const row = await withTransaction(async (conn) => {
      const [[image]] = await conn.query("SELECT id, category_id, source, file_name, website_file_id FROM product_images WHERE id = ? AND status = 'published' FOR UPDATE", [id]);
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

  router.put('/categories/order', ...json, handle(async (req, res) => {
    const ids = idList(req.body?.ids);
    if (!ids) throw new HttpError(400, 'invalid_order');
    await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT id FROM product_categories FOR UPDATE');
      if (rows.length !== ids.length || !rows.every((r) => ids.includes(r.id))) throw new HttpError(409, 'order_out_of_date');
      await setPositions(conn, 'product_categories', ids);
    });
    res.json({ ok: true });
  }));

  router.put('/categories/:id/images', ...json, handle(async (req, res) => {
    const categoryId = idParam(req.params.id);
    const ids = idList(req.body?.ids);
    if (!categoryId || !ids) throw new HttpError(400, 'invalid_order');
    await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        "SELECT id FROM product_images WHERE status = 'published' AND category_id = ? FOR UPDATE",
        [categoryId]
      );
      if (rows.length !== ids.length || !rows.every((r) => ids.includes(r.id))) throw new HttpError(409, 'order_out_of_date');
      await setPositions(conn, 'product_images', ids);
    });
    res.json({ ok: true });
  }));

  router.patch('/categories/:id', ...json, handle(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) throw new HttpError(404, 'not_found');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sets = [];
    const values = [];
    const textField = (key, column, max, required) => {
      if (body[key] === undefined) return;
      const value = typeof body[key] === 'string' ? body[key].trim() : '';
      if ((required && !value) || value.length > max) throw new HttpError(400, `invalid_${key}`);
      sets.push(`${column} = ?`);
      values.push(value);
    };
    textField('name', 'name', 60, true);
    textField('description', 'description', 255, true);
    textField('homeTagline', 'home_tagline', 120, true);
    for (const [key, column] of [['showOnHome', 'show_on_home'], ['showOnProducts', 'show_on_products']]) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'boolean') throw new HttpError(400, `invalid_${key}`);
      sets.push(`${column} = ?`);
      values.push(body[key] ? 1 : 0);
    }
    if (!sets.length) throw new HttpError(400, 'nothing_to_change');

    await withTransaction(async (conn) => {
      if (body.showOnHome === true) {
        const [[{ count }]] = await conn.query(
          'SELECT COUNT(*) AS count FROM product_categories WHERE show_on_home = 1 AND id <> ? FOR UPDATE', [id]
        );
        if (count >= MAX_ON_HOME) throw new HttpError(400, 'home_limit');
      }
      const [result] = await conn.query(`UPDATE product_categories SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
      if (!result.affectedRows) throw new HttpError(404, 'not_found');
    });
    // Keep the Drive folder's name in step with the website (best effort; the folder id never changes).
    if (body.name !== undefined && isDriveConfigured()) {
      const [[category]] = await getPool().query('SELECT name, drive_folder_id FROM product_categories WHERE id = ?', [id]);
      if (category.drive_folder_id) {
        await ensureWebsiteFolder({ id: category.drive_folder_id, name: category.name })
          .catch((error) => console.error(`[${new Date().toISOString()}] Drive folder rename failed:`, error.message));
      }
    }
    res.json({ ok: true });
  }));

  return router;
}

function createCatalogRouter() {
  const router = express.Router();
  router.get('/categories', async (req, res, next) => {
    if (!getPool()) return res.status(503).json({ error: 'db_unavailable' });
    try {
      res.set('Cache-Control', 'no-cache');
      return res.json({ categories: await publicCategories() });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = { createReviewRouter, createCatalogRouter, publishedImagesFor, sync, categoryFolder, MAX_PER_CATEGORY };
