'use strict';

// Daily analytics email.
//
// Administrators set the recipients and send time on the back-office Analytics page; the settings live in
// MySQL (analytics_email_settings, a single row). A one-minute scheduler inside this server sends the email
// once a day at that time (REPORT_TIME_ZONE, default India time):
//   - Catch-up: if the server was down or asleep at the send time, it sends as soon as it is back that day.
//   - No duplicates: each day is "claimed" in the database before sending, so a restart or a second
//     server instance can never send the same day twice.
//   - Retry: if sending fails (e.g. SMTP down), it tries again every 15 minutes for the rest of the day.
//
// The email holds yesterday's figures from Google Analytics 4 (the same queries as the Analytics page).

const express = require('express');
const { getPool } = require('./db.js');
const { requireRole, jsonOnly, rateLimiter } = require('./auth.js');
const { createMailTransport, mailFromAddress, EMAIL_PATTERN } = require('./mailer.js');
const { getGa, runMainReport, gaErrorMessage } = require('./analytics.js');

const TIME_ZONE = process.env.REPORT_TIME_ZONE || 'Asia/Kolkata';
const SITE_URL = (process.env.SITE_URL || 'https://frescony.uk').replace(/\/+$/, '');
const MAX_RECIPIENTS = 10;
const TICK_MS = 60 * 1000;
const RETRY_MINUTES = 15;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ------------------------------------------------------------------ */
/* Dates in the report time zone                                       */
/* ------------------------------------------------------------------ */

/** { date: 'YYYY-MM-DD', time: 'HH:MM' } for a moment, in TIME_ZONE. */
function localNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(at).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function prettyDate(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  });
}

function timeZoneLabel() {
  return TIME_ZONE === 'Asia/Kolkata' || TIME_ZONE === 'Asia/Calcutta' ? 'IST' : TIME_ZONE;
}

/* ------------------------------------------------------------------ */
/* Settings (one row in MySQL)                                         */
/* ------------------------------------------------------------------ */

let tableReady = null;

function ensureTable(pool) {
  if (!tableReady) {
    tableReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS analytics_email_settings (
          id              TINYINT UNSIGNED NOT NULL PRIMARY KEY,
          enabled         TINYINT(1)    NOT NULL DEFAULT 0,
          recipients      VARCHAR(2000) NOT NULL DEFAULT '',   -- comma-separated addresses
          send_time       CHAR(5)       NOT NULL DEFAULT '09:00', -- HH:MM in REPORT_TIME_ZONE
          handled_date    DATE          NULL,                  -- local day whose email is done (or skipped)
          last_sent_at    DATETIME      NULL,                  -- UTC
          last_attempt_at DATETIME      NULL,                  -- UTC
          last_error      VARCHAR(1000) NULL,
          updated_by      INT UNSIGNED  NULL,
          updated_at      DATETIME      NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await pool.query('INSERT IGNORE INTO analytics_email_settings (id) VALUES (1)');
    })().catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

async function readSettings(pool) {
  await ensureTable(pool);
  const [[row]] = await pool.query('SELECT * FROM analytics_email_settings WHERE id = 1');
  return row;
}

const recipientList = (row) => (row?.recipients ? row.recipients.split(',').filter(Boolean) : []);
const iso = (value) => (value instanceof Date ? value.toISOString() : value || null);

/** When the next daily email is due, or null if none is scheduled. */
function nextSend(row, now = localNow()) {
  if (!row?.enabled || recipientList(row).length === 0) return null;
  if (row.handled_date === now.date) return { date: addDays(now.date, 1), time: row.send_time, due: false };
  if (now.time < row.send_time) return { date: now.date, time: row.send_time, due: false };
  // Due today. After a failed attempt the scheduler waits RETRY_MINUTES before trying again.
  if (row.last_error && row.last_attempt_at instanceof Date) {
    const retryAt = new Date(row.last_attempt_at.getTime() + RETRY_MINUTES * 60 * 1000);
    if (retryAt > new Date()) return { date: now.date, time: row.send_time, due: false, retryAt: retryAt.toISOString() };
  }
  return { date: now.date, time: row.send_time, due: true };
}

function settingsForApi(row, user) {
  const ga = getGa();
  return {
    enabled: Boolean(row.enabled),
    recipients: recipientList(row),
    sendTime: row.send_time,
    timeZone: TIME_ZONE,
    timeZoneLabel: timeZoneLabel(),
    next: nextSend(row),
    lastSentAt: iso(row.last_sent_at),
    lastAttemptAt: iso(row.last_attempt_at),
    lastError: row.last_error || null,
    updatedAt: iso(row.updated_at),
    smtpConfigured: Boolean(process.env.SMTP_HOST),
    sender: mailFromAddress(),
    gaProblem: ga.problem || null,
    canEdit: user?.role === 'admin'
  };
}

/** Accepts an array or a comma/space/newline-separated string; returns { list } or { error }. */
function parseRecipients(input) {
  const raw = Array.isArray(input) ? input.join(',') : String(input || '');
  const list = [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const bad = list.find((addr) => addr.length > 200 || !EMAIL_PATTERN.test(addr));
  if (bad) return { error: `"${bad}" is not a valid email address.` };
  if (list.length > MAX_RECIPIENTS) return { error: `At most ${MAX_RECIPIENTS} email addresses.` };
  return { list };
}

/* ------------------------------------------------------------------ */
/* The email                                                           */
/* ------------------------------------------------------------------ */

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInt = (n) => Math.round(n).toLocaleString('en-GB');
const fmtPct = (r) => `${(r * 100).toFixed(1)}%`;
function fmtDuration(seconds) {
  const total = Math.round(seconds || 0);
  const m = Math.floor(total / 60);
  return m ? `${m}m ${String(total % 60).padStart(2, '0')}s` : `${total}s`;
}

/** Fetches the day's figures from GA4. Returns { report } or { error }. */
async function fetchDay(isoDate, startDate = isoDate) {
  const ga = getGa();
  if (ga.problem) return { error: `Google Analytics is not connected: ${ga.problem}` };
  try {
    return { report: await runMainReport(ga.client, ga.property, { startDate, endDate: isoDate }) };
  } catch (err) {
    return { error: `Google Analytics returned an error: ${gaErrorMessage(err)}` };
  }
}

/* ---- Email look: the same palette and type as the website / back office (src/styles.css :root). ---- */
const C = {
  green: '#064B35', green2: '#0A6044', gold: '#C99A27', ink: '#18231D', muted: '#687168',
  cream: '#F5F1E7', line: '#DDD7C8', rowLine: '#EEE9DC', white: '#FFFEFA', footer: '#111714', footerText: '#C2C8C1'
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Inter,Arial,Helvetica,sans-serif';
const LABEL = `font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase`;

function longDate(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

/** Pill button like the site's .button; built from a table cell so it also works in Outlook. */
function pillButton(href, label, { background, color }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
    <td align="center" bgcolor="${background}" style="background:${background};border-radius:999px">
      <a href="${href}" target="_blank" style="display:inline-block;padding:15px 30px;${LABEL};letter-spacing:.09em;color:${color};text-decoration:none;border-radius:999px">${label}</a>
    </td></tr></table>`;
}

// Both reporting periods use the same compact layout for test and scheduled sends.
function buildEmail({ isoDate, report, error, weekReport, weekError }) {
  const loginUrl = `${SITE_URL}/admin/login`;
  const logo = 'cid:fresco-analytics-logo@fresco';
  const subject = `Fresco NY | Daily analytics | ${prettyDate(isoDate)}`;
  const text = ['FRESCO NY | DAILY ANALYTICS', ''];
  const section = (title, headers, rows) => {
    text.push(title, headers.join(' | '), ...rows.map((row) => row.join(' | ')), '');
    return `<h3 style="font-family:${SERIF};font-size:21px;font-weight:400;color:${C.green};margin:22px 0 8px">${title}</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">
        <tr>${headers.map((h, i) => `<th align="${i ? 'right' : 'left'}" style="padding:9px 5px;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:11px;color:${C.muted};${i ? '' : 'width:40%'}">${h}</th>`).join('')}</tr>
        ${rows.length ? rows.map((row) => `<tr>${row.map((v, i) => `<td align="${i ? 'right' : 'left'}" style="padding:10px 5px;border-bottom:1px solid ${C.rowLine};font-family:${SANS};font-size:12px;color:${C.ink};overflow-wrap:anywhere;word-break:break-word">${escapeHtml(v)}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${headers.length}" style="padding:12px 5px;font-family:${SANS};font-size:12px;color:${C.muted}">No recorded data</td></tr>`}
      </table>`;
  };
  const period = (id, label, start, end, data, problem) => {
    const dates = start === end ? prettyDate(end) : `${prettyDate(start)} to ${prettyDate(end)}`;
    text.push(label.toUpperCase(), dates, '');
    let body = '';
    if (problem || !data) {
      const note = problem || 'Data unavailable';
      text.push(note, '');
      body = `<p style="font-family:${SANS};font-size:13px;color:#8E1D22">${escapeHtml(note)}</p>`;
    } else {
      const k = data.kpis;
      const metrics = [
        ['Active visitors', fmtInt(k.activeUsers)], ['New visitors', fmtInt(k.newUsers)],
        ['Sessions', fmtInt(k.sessions)], ['Page views', fmtInt(k.pageViews)],
        ['Engagement rate', fmtPct(k.engagementRate)], ['Avg engagement / user', fmtDuration(k.avgEngagementSec)]
      ];
      text.push(...metrics.map(([label, value]) => `${label}: ${value}`), '');
      const card = ([label, value]) => `<td width="33%" valign="top" style="padding:5px"><div style="background:${C.cream};padding:14px 8px"><div style="font-family:${SANS};font-size:10px;color:${C.muted}">${label}</div><div style="font-family:${SERIF};font-size:27px;color:${C.green};margin-top:7px">${value}</div></div></td>`;
      body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${metrics.slice(0, 3).map(card).join('')}</tr><tr>${metrics.slice(3).map(card).join('')}</tr></table>`;
      body += section('Visitor countries', ['Country', 'Visitors', 'Views'],
        data.countries.slice(0, 5).map((c) => [c.country === '(not set)' ? 'Unknown' : c.country, fmtInt(c.users), fmtInt(c.pageViews)]));
      body += section('Top pages', ['Page', 'Views', 'Visitors', 'Avg time / user'],
        data.pages.slice(0, 5).map((p) => [p.path, fmtInt(p.pageViews), fmtInt(p.users), fmtDuration(p.avgEngagementSec)]));
      body += section('Traffic sources', ['Source', 'Sessions', 'Visitors'],
        data.sources.slice(0, 5).map((s) => [s.channel, fmtInt(s.sessions), fmtInt(s.users)]));
      if (data.thresholded) {
        body += `<p style="font-family:${SANS};font-size:11px;color:${C.muted}">Some data withheld by Google privacy thresholds.</p>`;
        text.push('Some data withheld by Google privacy thresholds.', '');
      }
    }
    return `<tr><td class="px" id="${id}" style="padding:26px 30px;border-top:1px solid ${C.line}">
      <h2 style="font-family:${SERIF};font-size:28px;font-weight:400;color:${C.green};margin:0 0 6px">${label}</h2>
      <div style="font-family:${SANS};font-size:12px;color:${C.muted};margin-bottom:16px">${escapeHtml(dates)}</div>${body}</td></tr>`;
  };
  const yesterday = period('yesterday', 'Yesterday', isoDate, isoDate, report, error);
  // Seven complete days ending yesterday; excludes the partial sending day.
  const week = period('last-7-days', 'Last 7 Days', addDays(isoDate, -6), isoDate, weekReport, weekError);
  const source = 'Data source: Google Analytics 4 (GA4)';
  const note = `${report?.timeZone || weekReport?.timeZone || TIME_ZONE} | Recent data provisional. Avg time = active engagement/user. Locations approximate.`;
  text.splice(1, 0, source);
  text.push(note, '', `VIEW MORE: ${loginUrl}`);
  const logoImage = `<img src="${logo}" width="130" height="27" alt="Fresco NY" style="display:block;width:130px;max-width:100%;height:auto;border:0">`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fresco NY | Daily analytics</title>
    <style>@media(max-width:620px){.container{width:100%!important}.px{padding-left:16px!important;padding-right:16px!important}}</style></head>
    <body style="margin:0;background:${C.cream}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.cream}"><tr><td align="center" style="padding:20px 8px">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${C.white};border:1px solid ${C.line}">
      <tr><td class="px" style="padding:24px 30px"><a href="${escapeHtml(SITE_URL)}">${logoImage}</a></td></tr>
      <tr><td class="px" style="padding:0 30px 20px"><h1 style="font-family:${SERIF};font-weight:400;font-size:32px;color:${C.green};margin:0">Daily Analytics</h1>
        <p style="font-family:${SANS};font-size:12px;color:${C.muted};margin:8px 0 0">${source}</p></td></tr>
      ${yesterday}${week}
      <tr><td class="px" style="padding:12px 30px 22px;font-family:${SANS};font-size:10px;line-height:1.5;color:${C.muted}">${escapeHtml(note)}</td></tr>
      <tr><td align="center" bgcolor="${C.green}" style="padding:22px">${pillButton(escapeHtml(loginUrl), 'View more &rarr;', { background: C.white, color: C.green })}</td></tr>
      <tr><td class="px" bgcolor="${C.cream}" style="padding:24px 30px"><a href="${escapeHtml(SITE_URL)}">${logoImage}</a></td></tr>
    </table></td></tr></table></body></html>`;
  return { subject, html, text: text.join('\n'), attachments: [{
    filename: 'fresco-ny-logo-transparent.png', path: require('path').join(__dirname, '..', 'public', 'email', 'fresco-ny-logo-transparent.png'),
    cid: 'fresco-analytics-logo@fresco', contentDisposition: 'inline'
  }] };
}

/** Test and scheduled sends fetch the same periods and use the identical template. */
async function sendReport({ recipients, isoDate, transport = createMailTransport(), fetchReport = fetchDay }) {
  if (!transport) throw new Error('Email is not configured on the server (SMTP_HOST is empty in .env).');
  if (!recipients.length) throw new Error('No recipients are set.');
  const [daily, weekly] = await Promise.all([
    fetchReport(isoDate), fetchReport(isoDate, addDays(isoDate, -6))
  ]);
  const email = buildEmail({ isoDate, report: daily.report, error: daily.error, weekReport: weekly.report, weekError: weekly.error });
  await transport.sendMail({ from: mailFromAddress(), to: recipients.join(', '), ...email });
  const problems = [daily.error && `Yesterday: ${daily.error}`, weekly.error && `Last 7 Days: ${weekly.error}`].filter(Boolean);
  return { gaError: problems.join('; ') || null };
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

let timer = null;
let lastLoggedProblem = null;

function logOnce(message) {
  if (message === lastLoggedProblem) return;
  lastLoggedProblem = message;
  if (message) console.error(`[Analytics email] ${message}`);
}

async function tick() {
  const pool = getPool();
  if (!pool) return;
  const now = localNow();
  try {
    const row = await readSettings(pool);
    const recipients = recipientList(row);
    if (!row.enabled || !recipients.length || now.time < row.send_time || row.handled_date === now.date) {
      logOnce(null);
      return;
    }

    // Claim today atomically; also waits RETRY_MINUTES after a failed attempt.
    const [claim] = await pool.query(
      `UPDATE analytics_email_settings
          SET handled_date = ?, last_attempt_at = UTC_TIMESTAMP()
        WHERE id = 1 AND enabled = 1
          AND (handled_date IS NULL OR handled_date <> ?)
          AND (last_error IS NULL OR last_attempt_at IS NULL OR last_attempt_at < UTC_TIMESTAMP() - INTERVAL ? MINUTE)`,
      [now.date, now.date, RETRY_MINUTES]
    );
    if (claim.affectedRows !== 1) return;

    try {
      const { gaError } = await sendReport({ recipients, isoDate: addDays(now.date, -1) });
      await pool.query('UPDATE analytics_email_settings SET last_sent_at = UTC_TIMESTAMP(), last_error = ? WHERE id = 1',
        [gaError ? `Sent, but ${gaError}`.slice(0, 1000) : null]);
      console.log(`[Analytics email] Daily report for ${addDays(now.date, -1)} sent to ${recipients.length} recipient(s).`);
    } catch (err) {
      // Give the day back so the next attempt (after RETRY_MINUTES) can try again.
      await pool.query(
        'UPDATE analytics_email_settings SET handled_date = ?, last_error = ? WHERE id = 1',
        [row.handled_date, `Sending failed: ${err.message}`.slice(0, 1000)]
      );
      console.error('[Analytics email] Sending failed:', err.message);
    }
    logOnce(null);
  } catch (err) {
    logOnce(`Scheduler could not run: ${err.message}`);
  }
}

function startAnalyticsEmailScheduler() {
  if (timer || !getPool()) return;
  setTimeout(tick, 10 * 1000).unref();       // first check shortly after start-up (catch-up)
  timer = setInterval(tick, TICK_MS);
  timer.unref();
}

function stopAnalyticsEmailScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/* ------------------------------------------------------------------ */
/* Admin API: /api/admin/analytics/email                               */
/* ------------------------------------------------------------------ */

function createAnalyticsEmailRouter() {
  const router = express.Router();
  const tooManyTests = rateLimiter(5, 15 * 60 * 1000);
  router.use(requireRole('admin', 'viewer'));

  const adminOnly = (req, res, next) => (req.user?.role === 'admin'
    ? next()
    : res.status(403).json({ success: false, error: 'Only administrators can change the daily email.' }));

  const withPool = (handler) => async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ success: false, error: 'Database is not configured.' });
    try {
      return await handler(req, res, pool);
    } catch (err) {
      console.error('[Analytics email]', err.message);
      return res.status(500).json({ success: false, error: `Could not load or save the email settings: ${err.message}` });
    }
  };

  router.get('/', withPool(async (req, res, pool) => {
    const row = await readSettings(pool);
    res.json({ success: true, data: settingsForApi(row, req.user) });
  }));

  router.put('/', adminOnly, jsonOnly, express.json({ limit: '8kb' }), withPool(async (req, res, pool) => {
    const body = req.body || {};
    const enabled = body.enabled === true;
    const sendTime = String(body.sendTime || '');
    if (!TIME_PATTERN.test(sendTime)) return res.status(400).json({ success: false, error: 'Send time must be HH:MM (24-hour).' });
    const { list, error } = parseRecipients(body.recipients);
    if (error) return res.status(400).json({ success: false, error });
    if (enabled && list.length === 0) return res.status(400).json({ success: false, error: 'Add at least one email address.' });

    const before = await readSettings(pool);
    const now = localNow();
    const sentToday = before.last_sent_at instanceof Date && localNow(before.last_sent_at).date === now.date;
    let handledDate = before.handled_date;
    if (enabled && now.time >= sendTime && (!before.enabled || before.send_time !== sendTime)) {
      // Turning the email on (or moving the time) after today's send time starts tomorrow instead of
      // firing immediately. "Send test email now" is there for an email right away.
      handledDate = now.date;
    } else if (enabled && now.time < sendTime && handledDate === now.date && !sentToday) {
      // Today was only skipped, not sent, and the new time is still ahead: send today after all.
      handledDate = null;
    }

    await pool.query(
      `UPDATE analytics_email_settings
          SET enabled = ?, recipients = ?, send_time = ?, handled_date = ?,
              last_error = IF(?, NULL, last_error), updated_by = ?, updated_at = UTC_TIMESTAMP()
        WHERE id = 1`,
      [enabled ? 1 : 0, list.join(','), sendTime, handledDate, before.enabled && !enabled ? 1 : 0, req.user.id]
    );
    const row = await readSettings(pool);
    res.json({ success: true, data: settingsForApi(row, req.user) });
  }));

  router.post('/test', adminOnly, jsonOnly, withPool(async (req, res, pool) => {
    if (tooManyTests(String(req.user.id))) {
      return res.status(429).json({ success: false, error: 'Too many test emails; please wait a few minutes.' });
    }
    const row = await readSettings(pool);
    const recipients = recipientList(row);
    if (!recipients.length) return res.status(400).json({ success: false, error: 'Save at least one email address first.' });
    try {
      const { gaError } = await sendReport({ recipients, isoDate: addDays(localNow().date, -1), test: true });
      res.json({ success: true, data: { sentTo: recipients, gaError } });
    } catch (err) {
      res.status(502).json({ success: false, error: `The test email could not be sent: ${err.message}` });
    }
  }));

  return router;
}

module.exports = {
  createAnalyticsEmailRouter,
  startAnalyticsEmailScheduler,
  stopAnalyticsEmailScheduler,
  // exported for tests
  buildEmail, sendReport, localNow, addDays, nextSend, parseRecipients, tick
};
