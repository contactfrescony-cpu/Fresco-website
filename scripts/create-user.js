'use strict';

// npm run db:create-user -- --username loginid --name "Full Name" --role admin
//
// Creates a back-office user, or updates the name/role/password of the existing user with that login ID.
// Staff can also sign up themselves at /admin/signup; an administrator then assigns their role in the back office.
// Roles: admin, approver, contributor, viewer. To change only a password, use: npm run db:set-password
// The password is asked for on the terminal (hidden). For automation, set FRESCO_USER_PASSWORD instead.

const path = require('path');
const bcrypt = require('bcryptjs');
const { getPool, closePool } = require('../server/db.js');
const { ROLES, USERNAME_PATTERN } = require('../server/auth.js');
const { parseArgs, askHidden } = require('./cli.js');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = (args.username || '').trim().toLowerCase();
  const name = (args.name || '').trim();
  const role = (args.role || '').trim().toLowerCase();

  if (!USERNAME_PATTERN.test(username)) throw new Error('--username must be 3–40 characters: a–z, 0–9, dot, dash or underscore.');
  if (!name) throw new Error('Give a --name.');
  if (!ROLES.includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}.`);

  const password = process.env.FRESCO_USER_PASSWORD || await askHidden('Password (min 10 characters): ');
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');

  const pool = getPool();
  if (!pool) throw new Error('Set the DB_* settings in .env and run "npm run db:setup" first.');

  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    `INSERT INTO users (username, name, password_hash, role_id)
     VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = ?))
     ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash),
                             role_id = VALUES(role_id), is_active = 1`,
    [username, name, hash, role]
  );
  // affectedRows: 1 = inserted, 2 = updated an existing row.
  console.log(`${result.affectedRows === 1 ? 'Created' : 'Updated'} ${role} user "${username}".`);
}

main()
  .catch((error) => { console.error(`Could not save user: ${error.message}`); process.exitCode = 1; })
  .finally(() => closePool());
