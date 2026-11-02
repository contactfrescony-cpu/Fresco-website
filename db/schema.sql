-- Fresco NY back-office database (MySQL 8+).
-- Applied by `npm run db:setup`, which creates the database named in DB_NAME first and then
-- runs the column migrations in scripts/db-setup.js for databases created by an older version.
-- Safe to re-run: every statement is idempotent.

-- The four access levels.
CREATE TABLE IF NOT EXISTS roles (
  id          TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  name        VARCHAR(20)  NOT NULL UNIQUE,
  label       VARCHAR(40)  NOT NULL,
  description VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (id, name, label, description) VALUES
  (1, 'admin',       'Administrator', 'Full access: users, settings and all content.'),
  (2, 'approver',    'Approver',      'Reviews and publishes content submitted by contributors.'),
  (3, 'contributor', 'Contributor',   'Uploads photographs and drafts content for approval.'),
  (4, 'viewer',      'Viewer',        'Read-only access to dashboards and reports.')
ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);

-- Staff accounts. Sign-up creates a user with role_id NULL ("awaiting role");
-- they can sign in only after an administrator assigns a role.
-- Sign in with the username (login ID). Passwords are bcrypt hashes: change one with npm run db:set-password.
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(40)  NOT NULL UNIQUE,     -- login ID chosen at sign-up (lowercase)
  name          VARCHAR(120) NOT NULL,
  date_of_birth DATE         NULL,
  gender        VARCHAR(20)  NULL,                -- male | female | other | undisclosed
  password_hash VARCHAR(100) NOT NULL,            -- bcrypt
  role_id       TINYINT UNSIGNED NULL,            -- NULL = awaiting an administrator
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Login sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash CHAR(64)     NOT NULL PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME     NOT NULL,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Raw garment photos uploaded by contributors. Each photo is sent to the Google Drive input folder
-- ("Unprocessed Garment Images") for the image pipeline; this table is the audit trail of who sent what.
CREATE TABLE IF NOT EXISTS image_uploads (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NULL,                 -- NULL once the uploader's account is deleted
  original_name VARCHAR(255) NOT NULL,             -- file name on the contributor's device
  drive_name    VARCHAR(255) NOT NULL,             -- unique name given in Drive, e.g. 2026-11-02_a1b2c3_IMG_0412.jpg
  mime_type     VARCHAR(40)  NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  drive_file_id VARCHAR(128) NULL,
  status        VARCHAR(16)  NOT NULL,             -- uploaded | failed
  error         VARCHAR(255) NULL,
  pipeline_location VARCHAR(12) NULL,             -- where Drive last said the original was: input | done | failed | missing | elsewhere
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uploads_user (user_id, id),
  CONSTRAINT fk_uploads_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Website product categories (the folders on the Approver's "Website Images" page).
-- The set is fixed: approvers can rename, describe, reorder and show/hide them, but not create new ones.
-- slug is the permanent key used in URLs (/portfolio#tshirts); drive_folder is the matching
-- category folder the image pipeline writes to inside "Processed Images" (used for suggestions).
CREATE TABLE IF NOT EXISTS product_categories (
  id               TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  slug             VARCHAR(40)  NOT NULL UNIQUE,
  name             VARCHAR(60)  NOT NULL,
  description      VARCHAR(255) NOT NULL,
  home_tagline     VARCHAR(120) NOT NULL,
  drive_folder     VARCHAR(80)  NOT NULL,
  drive_folder_id  VARCHAR(128) NULL,                -- this category's folder in Drive "Fresco Website Images"
  position         TINYINT UNSIGNED NOT NULL,
  show_on_products TINYINT(1)   NOT NULL DEFAULT 1,
  show_on_home     TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seeded once; INSERT IGNORE never overwrites what an approver has changed.
INSERT IGNORE INTO product_categories (id, slug, name, description, home_tagline, drive_folder, position, show_on_products, show_on_home) VALUES
  (1, 'tshirts',   'T-shirts',              'Core essentials, long sleeves, graphics, jacquards and surface treatments.',            'Everyday, elevated.',        'T-shirts',              1, 1, 1),
  (2, 'polos',     'Polo shirts',           'Piqué, knitted and printed polos with tipped collars and refined branding.',             'Classic, refined.',          'Polo shirts',           2, 1, 0),
  (3, 'hoodies',   'Sweatshirts & hoodies', 'Fleece, brushed and textured surfaces with considered finishing.',                       'Comfort with character.',    'Sweatshirts & hoodies', 3, 1, 1),
  (4, 'shirts',    'Shirts & overshirts',   'Woven structures, prints, checks, trims and distinctive construction.',                  'Structure and style.',       'Shirts & overshirts',   4, 1, 1),
  (5, 'outerwear', 'Outerwear',             'Denim jackets and fleece layers with considered materials and functional detailing.',    'Built for every season.',    'Outerwear',             5, 1, 1),
  (6, 'denim',     'Denim',                 'Five-pocket jeans across washes, fits and finishes.',                                    'Washes with depth.',         'Denim',                 6, 1, 0),
  (7, 'trousers',  'Trousers',              'Chinos, joggers and utility trousers with clean, considered construction.',              'Clean, considered fits.',    'Trousers',              7, 1, 0),
  (8, 'shorts',    'Shorts',                'Terry, printed and woven shorts for warm-season and leisure ranges.',                    'Made for warm seasons.',     'Shorts',                8, 1, 0);

-- Product photos. Google Drive stores the files; this table holds their order and status.
-- Finished images from the Drive pipeline arrive as 'pending' (waiting for approval);
-- an approver publishes each into a category, where position 1 is shown first. Each category shows
-- at most 20: publishing into a full category removes its last image. Rows are kept after rejection or
-- removal (status 'rejected' / 'removed') so the same Drive file is never imported twice.
CREATE TABLE IF NOT EXISTS product_images (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  status                VARCHAR(12)  NOT NULL,           -- pending | published | rejected | removed
  category_id           TINYINT UNSIGNED NULL,           -- set when published
  position              SMALLINT UNSIGNED NULL,          -- 1 = first; published images only
  source                VARCHAR(12)  NOT NULL,           -- drive (published, stored in Drive) | pipeline (waiting) | legacy (gallery/ file not moved yet)
  file_name             VARCHAR(255) NOT NULL,           -- drive: <driveFileId>.<ext> (URL /media/...); pipeline: cache file; legacy: gallery/<slug>/<file>
  suggested_category_id TINYINT UNSIGNED NULL,           -- from the pipeline's classification
  drive_file_id         VARCHAR(128) NULL UNIQUE,
  drive_name            VARCHAR(255) NULL,
  drive_folder          VARCHAR(80)  NULL,
  website_file_id       VARCHAR(128) NULL UNIQUE,      -- the published photo's file in Drive "Fresco Website Images"
  reviewed_by           INT UNSIGNED NULL,
  reviewed_at           DATETIME     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_images_folder (status, category_id, position),
  CONSTRAINT fk_images_category  FOREIGN KEY (category_id) REFERENCES product_categories (id),
  CONSTRAINT fk_images_suggested FOREIGN KEY (suggested_category_id) REFERENCES product_categories (id),
  CONSTRAINT fk_images_reviewer  FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
