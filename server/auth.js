'use strict';

// Back-office accounts for the four staff roles (admin, approver, contributor, viewer).
//
//   POST /api/auth/signup  { username, password, name, dob, gender }
//                          -> creates an account with NO role; an administrator assigns the role later
//   POST /api/auth/login   { login, password }   (login = the login ID)
//                          -> sets the session cookie, returns { user }
//                             403 pending_approval until a role is assigned, 403 account_disabled if switched off
//   POST /api/auth/logout  -> clears the session
//   GET  /api/auth/me      -> { user } or 401
//
// Sessions live in the user_sessions table; the browser holds a random token in an HttpOnly cookie
// and only its SHA-256 hash is stored. Use requireRole(...) to protect admin API routes.

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { getPool } = require('./db.js');

const ROLES = ['admin', 'approver', 'contributor', 'viewer'];
const GENDERS = ['male', 'female', 'other', 'undisclosed'];
const COOKIE = 'fresco_session';
const SESSION_HOURS = 12;
const MIN_AGE = 18;
// Login IDs: 3–40 characters, lowercase letters, digits, dot, dash, underscore.
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const PASSWORD_MIN = 10;
// Compared against when the account is unknown, so response time doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('fresco-dummy-password', 10);

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const text = (value) => (typeof value === 'string' ? value.trim() : '');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > -1 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  };
}

const publicUser = (row) => ({ id: row.id, username: row.username, name: row.name, role: row.role });

/** Simple in-memory limiter: returns a function that is true once an IP exceeds `max` calls per window. */
function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const times = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    times.push(now);
    hits.set(ip, times);
    if (hits.size > 5000) hits.clear();
    return times.length > max;
  };
}

/** "YYYY-MM-DD" -> true when it is a real calendar date for someone aged MIN_AGE..100 today. */
function isValidBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  const today = new Date();
  const latest = Date.UTC(today.getUTCFullYear() - MIN_AGE, today.getUTCMonth(), today.getUTCDate());
  const earliest = Date.UTC(today.getUTCFullYear() - 100, today.getUTCMonth(), today.getUTCDate());
  return date.getTime() <= latest && date.getTime() >= earliest;
}

/** Loads the signed-in user (or null) from the session cookie. Users without a role never have a session. */
async function loadSessionUser(req) {
  const pool = getPool();
  const token = readCookie(req, COOKIE);
  if (!pool || !token || token.length > 128) return null;
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.name, r.name AS role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.is_active = 1`,
    [hashToken(token)]
  );
  return rows[0] ? publicUser(rows[0]) : null;
}

/**
 * Middleware: only signed-in users with one of the given roles may continue.
 * Administrators always pass. With no roles listed, any signed-in user passes.
 */
function requireRole(...allowed) {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!getPool()) return res.status(503).json({ error: 'db_unavailable' });
    try {
      const user = await loadSessionUser(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      if (allowed.length && user.role !== 'admin' && !allowed.includes(user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** JSON-only POSTs: a cross-site HTML form cannot send application/json, which blocks CSRF on these endpoints. */
function jsonOnly(req, res, next) {
  // Checks the header itself: req.is() returns null for a bodiless request such as logout.
  return /^application\/json\b/i.test(req.get('content-type') || '')
    ? next()
    : res.status(415).json({ error: 'json_required' });
}

function createAuthRouter() {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const loginLimited = rateLimiter(10, 15 * 60 * 1000);
  const signupLimited = rateLimiter(5, 60 * 60 * 1000);

  router.post('/signup', jsonOnly, express.json({ limit: '4kb' }), async (req, res, next) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'db_unavailable' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // Honeypot: real visitors never fill the hidden "website" field.
    if (text(body.website)) return res.json({ ok: true });

    const username = text(body.username).toLowerCase();
    const name = text(body.name);
    const dob = text(body.dob);
    const gender = text(body.gender).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    if (!name || name.length > 120) return res.status(400).json({ error: 'invalid', field: 'name' });
    if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ error: 'invalid', field: 'username' });
    if (!isValidBirthDate(dob)) return res.status(400).json({ error: 'invalid', field: 'dob' });
    if (!GENDERS.includes(gender)) return res.status(400).json({ error: 'invalid', field: 'gender' });
    if (password.length < PASSWORD_MIN || password.length > 200) return res.status(400).json({ error: 'invalid', field: 'password' });
    if (signupLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });

    try {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        'INSERT INTO users (username, name, date_of_birth, gender, password_hash, role_id) VALUES (?, ?, ?, ?, ?, NULL)',
        [username, name, dob, gender, hash]
      );
      return res.status(201).json({ ok: true });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'username_taken', field: 'username' });
      return next(error);
    }
  });

  router.post('/login', jsonOnly, express.json({ limit: '4kb' }), async (req, res, next) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'db_unavailable' });
    if (loginLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });

    const login = text(req.body?.login).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!login || !password || login.length > 200 || password.length > 200) {
      return res.status(400).json({ error: 'invalid_credentials' });
    }

    try {
      const [rows] = await pool.query(
        `SELECT u.id, u.username, u.name, u.password_hash, u.is_active, r.name AS role
           FROM users u LEFT JOIN roles r ON r.id = u.role_id
          WHERE u.username = ?`,
        [login]
      );
      const row = rows[0];
      const valid = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
      if (!row || !valid) return res.status(401).json({ error: 'invalid_credentials' });
      // Only reported after a correct password, so these never reveal anything to a stranger.
      if (!row.is_active) return res.status(403).json({ error: 'account_disabled' });
      if (!row.role) return res.status(403).json({ error: 'pending_approval' });

      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query(
        'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL ? HOUR)',
        [hashToken(token), row.id, SESSION_HOURS]
      );
      await pool.query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
      // Housekeeping: drop expired sessions.
      await pool.query('DELETE FROM user_sessions WHERE expires_at < UTC_TIMESTAMP()');

      res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: SESSION_HOURS * 3600 * 1000 });
      return res.json({ user: publicUser(row) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout', jsonOnly, async (req, res, next) => {
    const pool = getPool();
    const token = readCookie(req, COOKIE);
    try {
      if (pool && token) await pool.query('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(token)]);
    } catch (error) {
      return next(error);
    }
    res.clearCookie(COOKIE, cookieOptions());
    return res.json({ ok: true });
  });

  router.get('/me', requireRole(), (req, res) => res.json({ user: req.user }));

  return router;
}

module.exports = { createAuthRouter, requireRole, jsonOnly, ROLES, GENDERS, USERNAME_PATTERN };
