'use strict';

// npm run media:migrate — moves the website's original product photos (gallery/<folder>/) into Google Drive,
// "Fresco Website Images/<website folder>/", and switches the website to the Drive copies.
//
// - Creates the Drive folder for every website category (also empty ones).
// - Uploads each photo still served from gallery/, confirms Drive stored every byte, then records the
//   Drive file and puts a copy in the local cache so visitors never wait for Drive.
// - Safe to re-run: photos already moved are skipped. The gallery/ files are NOT deleted; they remain the
//   emergency fallback the website uses only if the database is unreachable.
// - Development page: each section (kind 'development') that has no photos yet gets the images in
//   development-images/<key>/ (up to 3), uploaded into its Drive folder. The website reads Development
//   page photos from Drive only, so after this the development-images/ folder is no longer used.
//
// Add --dry-run to list what would be moved without changing anything.

const fs = require('fs/promises');
const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

const { getPool, closePool } = require('../server/db.js');
const { isDriveConfigured, pingDrive, uploadWebsiteFile } = require('../server/drive.js');
const { sniffImage } = require('../server/uploads.js');
const { writeCache } = require('../server/media.js');
const { categoryFolder } = require('../server/catalog.js');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!getPool()) throw new Error('Set the DB_* values in .env first.');
  if (!isDriveConfigured()) throw new Error('Set DRIVE_UPLOAD_URL and DRIVE_UPLOAD_SECRET in .env first.');
  const { version } = await pingDrive();
  if (version < 3) {
    throw new Error('The Apps Script is an older version. Paste the new google/drive-upload.gs, then Deploy -> Manage deployments -> Edit -> New version.');
  }

  const pool = getPool();
  const [categories] = await pool.query('SELECT id, name FROM product_categories ORDER BY position, id');
  const [rows] = await pool.query(
    `SELECT i.id, i.file_name, c.name AS category
       FROM product_images i JOIN product_categories c ON c.id = i.category_id
      WHERE i.status = 'published' AND i.source = 'legacy'
      ORDER BY c.position, i.position`
  );
  console.log(`${rows.length} photo(s) to move into Google Drive "Fresco Website Images".`);
  if (dryRun) {
    rows.forEach((row) => console.log(`  ${row.category}: ${row.file_name}`));
    await migrateDevelopmentSections(pool);
    return;
  }

  for (const category of categories) await categoryFolder(category.id);
  console.log(`Drive folders ready for ${categories.length} website categories.`);

  let moved = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const buffer = await fs.readFile(path.join(__dirname, '..', row.file_name));
      const type = sniffImage(buffer);
      if (!type || !['image/webp', 'image/jpeg', 'image/png'].includes(type.mime)) throw new Error('not a web image');
      const [[{ category_id: categoryId }]] = await pool.query('SELECT category_id FROM product_images WHERE id = ?', [row.id]);
      const folderId = await categoryFolder(categoryId);
      const driveId = await uploadWebsiteFile({ folderId, name: path.basename(row.file_name), mimeType: type.mime, buffer });
      const fileName = `${driveId}.${type.ext}`;
      await writeCache(fileName, buffer);
      const [result] = await pool.query(
        "UPDATE product_images SET source = 'drive', file_name = ?, website_file_id = ?, drive_name = ? WHERE id = ? AND source = 'legacy'",
        [fileName, driveId, path.basename(row.file_name), row.id]
      );
      if (!result.affectedRows) throw new Error('changed by someone else while moving; check the Drive folder for a duplicate');
      moved += 1;
      console.log(`  moved  ${row.category}: ${path.basename(row.file_name)}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAILED ${row.category}: ${row.file_name} (${error.message})`);
    }
  }
  console.log(`Done: ${moved} moved, ${failed} failed.${failed ? ' Run the command again to retry the failed ones.' : ''}`);
  if (failed) process.exitCode = 1;
  await migrateDevelopmentSections(pool);
}

/** Development page sections with no photos: upload development-images/<key>/ (up to 3) into Drive. */
async function migrateDevelopmentSections(pool) {
  const [sections] = await pool.query(
    `SELECT c.id, c.slug, c.name,
            (SELECT COUNT(*) FROM product_images i WHERE i.category_id = c.id AND i.status = 'published') AS photos
       FROM product_categories c WHERE c.kind = 'development' ORDER BY c.position, c.id`
  );
  let uploaded = 0;
  let failed = 0;
  for (const section of sections) {
    if (Number(section.photos) > 0) continue;
    const dir = path.join(__dirname, '..', 'development-images', section.slug.replace(/^development-/, ''));
    let files = [];
    try { files = (await fs.readdir(dir)).filter((name) => /.(?:jpe?g|png|webp)$/i.test(name)).sort().slice(0, 3); } catch { /* no folder */ }
    if (!files.length) continue;
    console.log(`Development page, ${section.name}: ${files.length} photo(s) to move into Drive.`);
    if (dryRun) { files.forEach((name) => console.log(`  ${name}`)); continue; }
    for (const [index, name] of files.entries()) {
      try {
        const buffer = await fs.readFile(path.join(dir, name));
        const type = sniffImage(buffer);
        if (!type || !['image/webp', 'image/jpeg', 'image/png'].includes(type.mime)) throw new Error('not a web image');
        const folderId = await categoryFolder(section.id);
        const driveId = await uploadWebsiteFile({ folderId, name, mimeType: type.mime, buffer });
        const fileName = `${driveId}.${type.ext}`;
        await writeCache(fileName, buffer);
        await pool.query(
          `INSERT INTO product_images (status, source, category_id, position, file_name, website_file_id, drive_name, reviewed_at)
           VALUES ('published', 'drive', ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
          [section.id, index + 1, fileName, driveId, name]
        );
        uploaded += 1;
        console.log(`  moved  ${section.name}: ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`  FAILED ${section.name}: ${name} (${error.message})`);
      }
    }
  }
  if (!dryRun) console.log(`Development page: ${uploaded} photo(s) moved into Drive, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(`Media migration failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => closePool());
