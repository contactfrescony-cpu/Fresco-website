'use strict';

// npm run db:setup — creates the DB_NAME database (if missing) and applies db/schema.sql.
// Safe to run again: the schema only creates what is missing and refreshes the role list.

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { sslOptions } = require('../server/db.js');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

// Brings tables created by an older schema.sql up to date. Each step runs only when needed
// (MySQL 8.0 has no "ADD COLUMN IF NOT EXISTS"). Steps only add columns or relax NOT NULL — no data is removed.
const MIGRATIONS = [
  {
    name: 'users.username',
    needed: (cols) => !cols.username,
    sql: 'ALTER TABLE users ADD COLUMN username VARCHAR(40) NULL UNIQUE AFTER id'
  },
  {
    name: 'users.date_of_birth + gender',
    needed: (cols) => !cols.date_of_birth,
    sql: 'ALTER TABLE users ADD COLUMN date_of_birth DATE NULL AFTER email, ADD COLUMN gender VARCHAR(20) NULL AFTER date_of_birth'
  },
  {
    name: 'users.email nullable',
    needed: (cols) => cols.email && cols.email.IS_NULLABLE === 'NO',
    sql: 'ALTER TABLE users MODIFY email VARCHAR(200) NULL'
  },
  {
    name: 'users.role_id nullable (awaiting role)',
    needed: (cols) => cols.role_id && cols.role_id.IS_NULLABLE === 'NO',
    sql: 'ALTER TABLE users MODIFY role_id TINYINT UNSIGNED NULL'
  },
  {
    // Staff sign in with their login ID only; email is no longer kept.
    name: 'users.email removed',
    needed: (cols) => Boolean(cols.email),
    before: async (connection) => {
      const [rows] = await connection.query('SELECT name FROM users WHERE username IS NULL');
      if (rows.length) {
        throw new Error(`Give these users a login ID before email is removed (they sign in by email today): ${rows.map((r) => r.name).join(', ')}`);
      }
    },
    sql: 'ALTER TABLE users DROP COLUMN email'
  },
  {
    name: 'users.username required',
    needed: (cols) => cols.username && cols.username.IS_NULLABLE === 'YES',
    sql: 'ALTER TABLE users MODIFY username VARCHAR(40) NOT NULL'
  },
  {
    name: 'image_uploads.pipeline_location (live upload status)',
    table: 'image_uploads',
    needed: (cols) => !cols.pipeline_location,
    sql: 'ALTER TABLE image_uploads ADD COLUMN pipeline_location VARCHAR(12) NULL AFTER error'
  },
  {
    name: 'product_categories.drive_folder_id (Drive storage)',
    table: 'product_categories',
    needed: (cols) => !cols.drive_folder_id,
    sql: 'ALTER TABLE product_categories ADD COLUMN drive_folder_id VARCHAR(128) NULL AFTER drive_folder'
  },
  {
    name: 'product_images.website_file_id (Drive storage)',
    table: 'product_images',
    needed: (cols) => !cols.website_file_id,
    sql: 'ALTER TABLE product_images ADD COLUMN website_file_id VARCHAR(128) NULL UNIQUE AFTER drive_folder'
  },
  {
    name: 'product_categories.kind (Development page photo sections)',
    table: 'product_categories',
    needed: (cols) => !cols.kind,
    sql: "ALTER TABLE product_categories ADD COLUMN kind VARCHAR(12) NOT NULL DEFAULT 'product' AFTER id"
  }
];

/**
 * The four photo sections of the Development page (kind 'development'). The slug is the gallery key the
 * page asks for (/api/gallery/development-<key>). Added only when missing; names can be changed later.
 */
const DEVELOPMENT_SECTIONS = [
  [101, 'development-measuring', '01 · Measuring tape', 'Development – Measuring tape', 1],
  [102, 'development-thread', '02 · Sewing thread', 'Development – Sewing thread', 2],
  [103, 'development-needles', '03 · Needles', 'Development – Needles', 3],
  [104, 'development-patterns', '04 · Pattern pieces', 'Development – Pattern pieces', 4]
];

async function seedDevelopmentSections(connection) {
  for (const [id, slug, name, driveFolder, position] of DEVELOPMENT_SECTIONS) {
    const [result] = await connection.query(
      `INSERT IGNORE INTO product_categories
         (id, kind, slug, name, description, home_tagline, drive_folder, position, show_on_products, show_on_home)
       VALUES (?, 'development', ?, ?, 'Development page photo section.', '-', ?, ?, 0, 0)`,
      [id, slug, name, driveFolder, position]
    );
    if (result.affectedRows) console.log(`Added Development page photo section: ${name}`);
  }
}

async function migrate(connection, database) {
  for (const step of MIGRATIONS) {
    const [rows] = await connection.query(
      'SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [database, step.table || 'users']
    );
    const cols = Object.fromEntries(rows.map((row) => [row.COLUMN_NAME, row]));
    if (step.needed(cols)) {
      if (step.before) await step.before(connection);
      await connection.query(step.sql);
      console.log(`Migrated: ${step.name}`);
    }
  }
}

/**
 * First run only: copies the website's existing product photos (gallery/<slug>/) into product_images
 * as published, in file-name order, so approvers start with what the site already shows.
 */
async function importLegacyGallery(connection) {
  const [[{ count }]] = await connection.query('SELECT COUNT(*) AS count FROM product_images');
  if (count) return;
  const [categories] = await connection.query('SELECT id, slug FROM product_categories');
  let imported = 0;
  for (const { id, slug } of categories) {
    const dir = path.join(__dirname, '..', 'gallery', slug);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((name) => /\.(?:jpe?g|png|webp|avif)$/i.test(name)).sort().slice(0, 20);
    for (const [index, name] of files.entries()) {
      await connection.query(
        "INSERT INTO product_images (status, category_id, position, source, file_name) VALUES ('published', ?, ?, 'legacy', ?)",
        [id, index + 1, `gallery/${slug}/${name}`]
      );
      imported += 1;
    }
  }
  console.log(`Imported ${imported} existing website product photos.`);
}

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_NAME) throw new Error('Set DB_HOST, DB_USER and DB_NAME in .env first.');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(DB_NAME)) throw new Error('DB_NAME may only contain letters, digits and underscores.');

  const connection = await mysql.createConnection({
    host: DB_HOST, port: Number.parseInt(DB_PORT || '3306', 10),
    user: DB_USER, password: DB_PASSWORD || '', multipleStatements: true, ssl: sslOptions()
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${DB_NAME}\``);
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
    await migrate(connection, DB_NAME);
    await importLegacyGallery(connection);
    await seedDevelopmentSections(connection);

    const [roles] = await connection.query('SELECT name FROM roles ORDER BY id');
    const [[{ users }]] = await connection.query('SELECT COUNT(*) AS users FROM users');
    console.log(`Database "${DB_NAME}" ready on ${DB_HOST}.`);
    console.log(`Roles: ${roles.map((r) => r.name).join(', ')}`);
    console.log(`Users: ${users}${users ? '' : '  (create the first admin with: npm run db:create-user -- --username yourid --name "Your Name" --role admin)'}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Database setup failed: ${error.message}`);
  process.exit(1);
});
