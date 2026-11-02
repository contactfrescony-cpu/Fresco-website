'use strict';

// npm run db:set-password -- --username loginid
//
// Sets a new password for a back-office user and signs them out everywhere.
// Passwords are stored as bcrypt hashes, so they cannot be typed straight into the database: use this instead.
// The new password is asked for on the terminal (hidden). For automation, set FRESCO_USER_PASSWORD instead.

const path = require('path');
const bcrypt = require('bcryptjs');
const { getPool, closePool } = require('../server/db.js');
const { parseArgs, askHidden } = require('./cli.js');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

async function main() {
  const username = (parseArgs(process.argv.slice(2)).username || '').trim().toLowerCase();
  if (!username) throw new Error('Give the --username (login ID) of the user.');

  const pool = getPool();
  if (!pool) throw new Error('Set the DB_* settings in .env first.');
  const [[user]] = await pool.query('SELECT id, name FROM users WHERE username = ?', [username]);
  if (!user) throw new Error(`No user with login ID "${username}".`);

  const password = process.env.FRESCO_USER_PASSWORD || await askHidden(`New password for ${user.name} (min 10 characters): `);
  if (password.length < 10 || password.length > 200) throw new Error('Password must be 10–200 characters.');
  if (!process.env.FRESCO_USER_PASSWORD && password !== await askHidden('Type it again: ')) throw new Error('The two passwords do not match.');

  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 12), user.id]);
  const [ended] = await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);
  console.log(`Password changed for ${user.name} ("${username}").${ended.affectedRows ? ' They were signed out and must sign in again.' : ''}`);
}

main()
  .catch((error) => { console.error(`Could not change password: ${error.message}`); process.exitCode = 1; })
  .finally(() => closePool());
