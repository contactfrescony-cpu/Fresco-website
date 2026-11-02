'use strict';

// Website product photos are stored in Google Drive ("Fresco Website Images/<category>/").
// Visitors get them from /media/<driveFileId>.<ext>, served from a local cache that is filled from
// Drive on first request. The cache is disposable: delete it any time and photos are re-downloaded.
// Only photos that are currently published are served, so the route cannot fetch arbitrary Drive files.
//
//   MEDIA_DIR/cache    copies of published Drive photos (safe to delete)
//   MEDIA_DIR/pending  copies of finished pipeline images waiting for approval (never public)

const fs = require('fs/promises');
const path = require('path');
const { getPool } = require('./db.js');
const { downloadWebsiteFile } = require('./drive.js');
const { sniffImage } = require('./uploads.js');

const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, '..', 'media-library'));
const CACHE_DIR = path.join(MEDIA_DIR, 'cache');
const PENDING_DIR = path.join(MEDIA_DIR, 'pending');

// "<Drive file id>.<ext>" — Drive ids are letters, digits, "-" and "_".
const MEDIA_NAME = /^[A-Za-z0-9_-]{10,128}\.(?:webp|jpg|png)$/;
const CONTENT_TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

const cachePath = (fileName) => path.join(CACHE_DIR, path.basename(fileName));
const inFlight = new Map();

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

/** Puts bytes into the cache (atomic rename, so a half-written file is never served). */
async function writeCache(fileName, buffer) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const target = cachePath(fileName);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, buffer);
  await fs.rename(temp, target);
}

async function removeCached(fileName) {
  try { await fs.unlink(cachePath(fileName)); } catch { /* not cached */ }
}

/** Makes sure a published photo is in the cache, downloading it from Drive once if needed. */
async function ensureCached(fileName, driveId) {
  const target = cachePath(fileName);
  if (await exists(target)) return target;
  if (!inFlight.has(fileName)) {
    inFlight.set(fileName, (async () => {
      const { buffer } = await downloadWebsiteFile(driveId);
      const type = sniffImage(buffer);
      if (!type || !fileName.endsWith(`.${type.ext}`)) throw new Error(`unexpected file type for ${fileName}`);
      await writeCache(fileName, buffer);
      return target;
    })().finally(() => inFlight.delete(fileName)));
  }
  return inFlight.get(fileName);
}

/** Express handler for GET /media/:name */
async function serveMedia(req, res) {
  const name = req.params.name;
  if (!MEDIA_NAME.test(name)) return res.status(404).type('text').send('Not found');
  const pool = getPool();
  if (!pool) return res.status(404).type('text').send('Not found');
  try {
    const [[row]] = await pool.query(
      "SELECT website_file_id FROM product_images WHERE file_name = ? AND source = 'drive' AND status = 'published'",
      [name]
    );
    if (!row) return res.status(404).type('text').send('Not found');
    const file = await ensureCached(name, row.website_file_id);
    // The name contains the Drive id, which never changes for a photo, so it can be cached for a year.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(CONTENT_TYPES[name.split('.').pop()]);
    return res.sendFile(file);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] media ${name}:`, error.message);
    res.set('Cache-Control', 'no-store');
    return res.status(503).type('text').send('Photo temporarily unavailable');
  }
}

module.exports = { MEDIA_DIR, CACHE_DIR, PENDING_DIR, writeCache, removeCached, ensureCached, serveMedia, cachePath };
