'use strict';

// Contact-page enquiries: stored in MySQL (the master copy), copied to a Google Sheet, and managed on the
// back-office "Enquiries" page.
//
//   GET   /api/admin/enquiries            ?status=all|new|contacted|closed|spam &q=search &page=1
//                                         -> { enquiries, total, page, pageSize, counts, staff, sheet }
//   GET   /api/admin/enquiries/summary    -> { newCount }   (sidebar badge)
//   GET   /api/admin/enquiries/export.csv ?status &q        -> CSV download of the same list
//   PATCH /api/admin/enquiries/:id        { status?, assignedTo?: userId|null, notes? }
//   POST  /api/admin/enquiries/sync-sheet -> sends every enquiry the Sheet is missing (or has out of date)
// Administrators and viewers may use these.
//
// Google Sheet copy, through the Apps Script bridge google/enquiries-sheet.gs:
//   SHEETS_WEBHOOK_URL     the Apps Script web-app URL (ends in /exec)
//   SHEETS_WEBHOOK_SECRET  shared secret; the same value is the script's SHEET_SECRET property
// Every change bumps the row's revision; the Sheet is "up to date" once sheet_revision catches up.
// Failed copies are retried every few minutes and with the "Sync to Sheet" button, so none are lost.

const express = require('express');
const { getPool } = require('./db.js');
const { requireRole, jsonOnly } = require('./auth.js');

const STATUSES = ['new', 'contacted', 'closed', 'spam'];
const STATUS_LABELS = { new: 'New', contacted: 'Contacted', closed: 'Closed', spam: 'Spam' };
const PAGE_SIZE = 50;
const NOTES_MAX = 5000;
const SEARCH_MAX = 100;
const SHEET_BATCH = 100;
const SHEET_TIMEOUT_MS = 30 * 1000;
const RETRY_EVERY_MS = 10 * 60 * 1000;
const SITE_URL = () => (process.env.SITE_URL || 'https://frescony.uk').replace(/\/+$/, '');
const TIME_ZONE = () => process.env.REPORT_TIME_ZONE || 'Asia/Kolkata';

const adminLink = (id) => `${SITE_URL()}/admin/enquiries?id=${id}`;

let regionNames = null;
function countryName(code) {
  if (!code) return '';
  try {
    regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

/* ---------------------------------------------------------------- saving */

/** Stores a validated enquiry and returns its id. emailStatus: 'pending' (will be emailed) or 'off'. */
async function saveEnquiry(data, { countryCode = null, emailStatus = 'pending' } = {}) {
  const [result] = await getPool().query(
    `INSERT INTO enquiries (company, email, phone, purpose, message, country_code, email_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.company, data.email, data.phone, data.purpose, data.message || null,
      /^[A-Z]{2}$/.test(countryCode || '') ? countryCode : null, emailStatus]
  );
  return result.insertId;
}

async function setEmailStatus(id, status) {
  // "updated_at = updated_at" keeps the timestamp for staff changes only.
  await getPool().query('UPDATE enquiries SET email_status = ?, updated_at = updated_at WHERE id = ?', [status, id]);
}

/* ---------------------------------------------------------- Google Sheet */

function isSheetConfigured(env = process.env) {
  return Boolean(env.SHEETS_WEBHOOK_URL && env.SHEETS_WEBHOOK_SECRET);
}

class SheetError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

async function callSheet(payload, env = process.env) {
  if (!isSheetConfigured(env)) throw new SheetError('sheet_not_configured');
  let response;
  try {
    // Apps Script answers a POST with a redirect to the result; fetch follows it automatically.
    response = await fetch(env.SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, secret: env.SHEETS_WEBHOOK_SECRET }),
      redirect: 'follow',
      signal: AbortSignal.timeout(SHEET_TIMEOUT_MS)
    });
  } catch (error) {
    throw new SheetError('sheet_unreachable', error.name === 'TimeoutError' ? 'timed out' : error.message);
  }
  const result = await response.json().catch(() => null);
  // A non-JSON answer usually means the web app is not deployed with access "Anyone".
  if (!response.ok || !result) throw new SheetError('sheet_bad_response', `HTTP ${response.status}`);
  if (!result.ok) throw new SheetError(`sheet_${result.error || 'error'}`, result.detail);
  return result;
}

/** Checks the connection: { spreadsheetName, sheetName, rows, version }. */
async function pingSheet(env = process.env) {
  const result = await callSheet({ action: 'ping' }, env);
  return { spreadsheetName: result.spreadsheetName, sheetName: result.sheetName, rows: result.rows, version: result.version };
}

const sheetRow = (row) => ({
  id: row.id,
  receivedAt: new Date(row.created_at).toISOString(),
  company: row.company,
  email: row.email,
  phone: row.phone,
  purpose: row.purpose,
  message: row.message || '',
  country: countryName(row.country_code),
  status: STATUS_LABELS[row.status] || row.status,
  assignedTo: row.assigned_name || '',
  link: adminLink(row.id)
});

/** Sends every row whose Sheet copy is missing or out of date, in batches. */
async function pushPending() {
  const pool = getPool();
  if (!pool || !isSheetConfigured()) return { synced: 0, error: null };
  let synced = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const [rows] = await pool.query(
      `SELECT e.*, u.name AS assigned_name
         FROM enquiries e LEFT JOIN users u ON u.id = e.assigned_to
        WHERE e.sheet_revision < e.revision
        ORDER BY e.id LIMIT ?`,
      [SHEET_BATCH]
    );
    if (!rows.length) break;
    let written;
    try {
      const result = await callSheet({ action: 'upsert', rows: rows.map(sheetRow) });
      written = new Set((result.ids || []).map(Number));
    } catch (error) {
      await pool.query('UPDATE enquiries SET sheet_error = ?, updated_at = updated_at WHERE id IN (?)',
        [error.message.slice(0, 255), rows.map((row) => row.id)]);
      return { synced, error: error.message };
    }
    for (const row of rows) {
      if (!written.has(row.id)) continue;
      // Only the revision that was sent counts: a change made meanwhile stays pending.
      await pool.query(
        'UPDATE enquiries SET sheet_revision = GREATEST(sheet_revision, ?), sheet_error = NULL, updated_at = updated_at WHERE id = ?',
        [row.revision, row.id]
      );
      synced += 1;
    }
    if (written.size < rows.length) return { synced, error: 'The Sheet did not accept every row.' };
  }
  return { synced, error: null };
}

// One sync at a time; a request that arrives during a sync makes it run once more afterwards.
let syncing = null;
let syncAgain = false;
let lastLoggedError = null;

function syncSheetNow() {
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    let result;
    do {
      syncAgain = false;
      result = await pushPending();
    } while (syncAgain && !result.error);
    if (result.error && result.error !== lastLoggedError) {
      console.error(`[${new Date().toISOString()}] enquiries -> Google Sheet failed (will retry): ${result.error}`);
    }
    lastLoggedError = result.error;
    return result;
  })().catch((error) => {
    console.error(`[${new Date().toISOString()}] enquiries -> Google Sheet failed:`, error.message);
    return { synced: 0, error: error.message };
  }).finally(() => { syncing = null; });
  return syncing;
}

/** Fire-and-forget: used after a new enquiry or a staff change. */
function queueSheetSync() {
  if (getPool() && isSheetConfigured()) syncSheetNow();
}

let retryTimer = null;
function startEnquirySheetSync() {
  if (retryTimer || !isSheetConfigured()) return;
  queueSheetSync();   // catch up on anything missed while the server was down
  retryTimer = setInterval(queueSheetSync, RETRY_EVERY_MS);
  retryTimer.unref();
}
function stopEnquirySheetSync() {
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
}

/* --------------------------------------------------------------- admin API */

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const escapeLike = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** WHERE clause for the list and the CSV export. "all" means everything except spam. */
function listFilter(query) {
  const status = STATUSES.includes(query.status) ? query.status : 'all';
  const search = text(query.q).slice(0, SEARCH_MAX);
  const where = [status === 'all' ? "e.status <> 'spam'" : 'e.status = ?'];
  const values = status === 'all' ? [] : [status];
  if (search) {
    where.push('(e.company LIKE ? OR e.email LIKE ? OR e.phone LIKE ? OR e.message LIKE ? OR e.purpose LIKE ?)');
    const like = `%${escapeLike(search)}%`;
    values.push(like, like, like, like, like);
  }
  if (/^\d{1,10}$/.test(text(query.id))) { where.push('e.id = ?'); values.push(Number(query.id)); }
  return { status, search, sql: where.join(' AND '), values };
}

const publicEnquiry = (row) => ({
  id: row.id,
  company: row.company,
  email: row.email,
  phone: row.phone,
  purpose: row.purpose,
  message: row.message || '',
  countryCode: row.country_code,
  country: countryName(row.country_code),
  status: row.status,
  assignedTo: row.assigned_to,
  assignedName: row.assigned_name || null,
  notes: row.notes || '',
  emailStatus: row.email_status,
  inSheet: row.sheet_revision >= row.revision,
  sheetError: row.sheet_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const SELECT_ENQUIRY = `SELECT e.*, u.name AS assigned_name FROM enquiries e LEFT JOIN users u ON u.id = e.assigned_to`;

const fail = (res, status, error) => res.status(status).json({ success: false, error });

/** CSV cell: quoted, and text a spreadsheet would run as a formula is prefixed with an apostrophe. */
function csvCell(value) {
  let cell = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

function localDateTime(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function createEnquiriesRouter() {
  const router = express.Router();
  router.use(requireRole('viewer'));

  router.get('/summary', async (req, res, next) => {
    try {
      const [[{ newCount }]] = await getPool().query("SELECT COUNT(*) AS newCount FROM enquiries WHERE status = 'new'");
      return res.json({ success: true, newCount: Number(newCount) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    const pool = getPool();
    const filter = listFilter(req.query);
    const page = Math.max(1, Math.min(Number.parseInt(req.query.page, 10) || 1, 10000));
    try {
      const [rows] = await pool.query(
        `${SELECT_ENQUIRY} WHERE ${filter.sql} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
        [...filter.values, PAGE_SIZE, (page - 1) * PAGE_SIZE]
      );
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM enquiries e WHERE ${filter.sql}`, filter.values);
      const [countRows] = await pool.query('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status');
      const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      for (const { status, n } of countRows) counts[status] = Number(n);
      counts.all = STATUSES.filter((s) => s !== 'spam').reduce((sum, s) => sum + counts[s], 0);
      const [staff] = await pool.query(
        'SELECT u.id, u.name FROM users u WHERE u.is_active = 1 AND u.role_id IS NOT NULL ORDER BY u.name'
      );
      const [[sheet]] = await pool.query(
        `SELECT SUM(sheet_revision < revision) AS pending,
                (SELECT sheet_error FROM enquiries WHERE sheet_error IS NOT NULL ORDER BY id DESC LIMIT 1) AS lastError
           FROM enquiries`
      );
      return res.json({
        success: true,
        enquiries: rows.map(publicEnquiry),
        total: Number(total),
        page,
        pageSize: PAGE_SIZE,
        counts,
        staff,
        sheet: { configured: isSheetConfigured(), pending: Number(sheet.pending || 0), lastError: sheet.lastError || null }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/export.csv', async (req, res, next) => {
    const filter = listFilter(req.query);
    try {
      const [rows] = await getPool().query(
        `${SELECT_ENQUIRY} WHERE ${filter.sql} ORDER BY e.created_at DESC, e.id DESC LIMIT 20000`, filter.values
      );
      const header = ['ID', `Received (${TIME_ZONE()})`, 'Company', 'Email', 'Phone', 'Purpose', 'Message', 'Country', 'Status', 'Assigned to', 'Notes'];
      const lines = [header.map(csvCell).join(',')];
      for (const row of rows) {
        lines.push([
          row.id, localDateTime(row.created_at), row.company, row.email, row.phone, row.purpose, row.message,
          countryName(row.country_code), STATUS_LABELS[row.status] || row.status, row.assigned_name, row.notes
        ].map(csvCell).join(','));
      }
      const day = localDateTime(new Date()).slice(0, 10);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="fresco-enquiries-${filter.status}-${day}.csv"`);
      // The byte-order mark makes Excel read the file as UTF-8.
      return res.send(`﻿${lines.join('\r\n')}\r\n`);
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', jsonOnly, express.json({ limit: '16kb' }), async (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return fail(res, 404, 'This enquiry no longer exists.');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const pool = getPool();

    const sets = [];
    const values = [];
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return fail(res, 400, 'Unknown status.');
      sets.push('status = ?'); values.push(body.status);
    }
    if (body.assignedTo !== undefined) {
      if (body.assignedTo === null) {
        sets.push('assigned_to = NULL');
      } else {
        const userId = Number(body.assignedTo);
        if (!Number.isInteger(userId) || userId < 1) return fail(res, 400, 'Choose someone from the list.');
        const [[user]] = await pool.query('SELECT id FROM users WHERE id = ? AND is_active = 1 AND role_id IS NOT NULL', [userId]);
        if (!user) return fail(res, 400, 'That person cannot be assigned (their account is disabled or has no role).');
        sets.push('assigned_to = ?'); values.push(userId);
      }
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string' || body.notes.length > NOTES_MAX) {
        return fail(res, 400, `Notes can be at most ${NOTES_MAX} characters.`);
      }
      sets.push('notes = ?'); values.push(body.notes.trim() || null);
    }
    if (!sets.length) return fail(res, 400, 'Nothing to change.');

    try {
      const [result] = await pool.query(
        `UPDATE enquiries SET ${sets.join(', ')}, revision = revision + 1 WHERE id = ?`, [...values, id]
      );
      if (!result.affectedRows) return fail(res, 404, 'This enquiry no longer exists.');
      const [[row]] = await pool.query(`${SELECT_ENQUIRY} WHERE e.id = ?`, [id]);
      queueSheetSync();
      return res.json({ success: true, enquiry: publicEnquiry(row) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sync-sheet', jsonOnly, async (req, res, next) => {
    if (!isSheetConfigured()) {
      return fail(res, 503, 'The Google Sheet is not connected. Set SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET on the server.');
    }
    try {
      const result = await syncSheetNow();
      const [[{ pending }]] = await getPool().query('SELECT COUNT(*) AS pending FROM enquiries WHERE sheet_revision < revision');
      if (result.error) return fail(res, 502, `Google Sheet sync failed: ${result.error}`);
      return res.json({ success: true, synced: result.synced, pending: Number(pending) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createEnquiriesRouter,
  saveEnquiry,
  setEmailStatus,
  queueSheetSync,
  syncSheetNow,
  startEnquirySheetSync,
  stopEnquirySheetSync,
  isSheetConfigured,
  pingSheet,
  adminLink,
  STATUSES
};
