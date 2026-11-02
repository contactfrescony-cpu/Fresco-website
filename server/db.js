'use strict';

// MySQL connection pool, configured from DB_* environment variables (see .env.example).
// The pool is created lazily, so the public website keeps working when MySQL is not configured or is down;
// only the /api/auth endpoints report the database as unavailable.

const mysql = require('mysql2/promise');

let pool = null;

function isConfigured(env = process.env) {
  return Boolean(env.DB_HOST && env.DB_USER && env.DB_NAME);
}

function getPool(env = process.env) {
  if (!isConfigured(env)) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      port: Number.parseInt(env.DB_PORT || '3306', 10),
      user: env.DB_USER,
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME,
      connectionLimit: Number.parseInt(env.DB_POOL_SIZE || '10', 10),
      waitForConnections: true,
      // Everything is stored in UTC; DB_TIMEZONE (IST) is only for display and reports.
      timezone: 'Z',
      // Dates of birth come back as plain "YYYY-MM-DD" text, so no time zone can shift them by a day.
      dateStrings: ['DATE'],
      charset: 'utf8mb4'
    });
    // The server's own time zone is SYSTEM, so pin each connection to UTC (affects CURRENT_TIMESTAMP defaults).
    pool.pool.on('connection', (connection) => connection.query("SET time_zone = '+00:00'"));
  }
  return pool;
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getPool, isConfigured, closePool };
