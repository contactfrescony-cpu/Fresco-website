'use strict';

const express = require('express');
const path = require('node:path');
const { getPool } = require('./db.js');
const { requireRole, jsonOnly } = require('./auth.js');
const { createMailTransport, mailFromAddress } = require('./mailer.js');

const INBOX = () => process.env.CONTACT_TO || 'connectfrescony@gmail.com';
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (value) => String(value).replace(/[\r\n\t]+/g, ' ');
const linkFor = (id) => `${(process.env.SITE_URL || 'https://frescony.uk').replace(/\/+$/, '')}/admin/enquiries?id=${id}`;
let ready;

function ensureEmailTables(pool) {
  if (!ready) ready = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS enquiry_email_settings (
      id TINYINT UNSIGNED PRIMARY KEY,
      response_hours DECIMAL(7,2) NOT NULL DEFAULT 4,
      alerts_enabled TINYINT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query('INSERT IGNORE INTO enquiry_email_settings (id) VALUES (1)');
    await pool.query(`CREATE TABLE IF NOT EXISTS enquiry_email_jobs (
      enquiry_id INT UNSIGNED NOT NULL,
      kind VARCHAR(16) NOT NULL,
      sent_at DATETIME NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error VARCHAR(500) NULL,
      PRIMARY KEY (enquiry_id, kind),
      INDEX due_jobs (sent_at, next_attempt_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

async function emailSettings(pool = getPool()) {
  await ensureEmailTables(pool);
  const [[row]] = await pool.query('SELECT * FROM enquiry_email_settings WHERE id = 1');
  return { responseHours: Number(row.response_hours), alertsEnabled: Boolean(row.alerts_enabled) };
}

// Called in the same transaction that saves the enquiry, so a restart cannot lose its emails.
async function queueInitialEmails(connection, id) {
  await connection.query("INSERT INTO enquiry_email_jobs (enquiry_id, kind) VALUES (?, 'team'), (?, 'thankyou')", [id, id]);
}

function buildEnquiryEmail(kind, enquiry, waitingHours = 0) {
  const id = enquiry.id;
  const reference = id ? ` #${id}` : '';
  const company = oneLine(enquiry.company);
  const from = { name: 'Fresco NY', address: mailFromAddress() };
  if (kind === 'thankyou') {
    const text = `Thank you for contacting Fresco NY.\n\nWe have received your enquiry${reference} about ${enquiry.purpose}. Our team will get back to you shortly.\n\nYou can reply to this email if you would like to add anything.\n\nFresco NY team`;
    return {
      from, to: enquiry.email, replyTo: INBOX(),
      subject: `Thank you for your enquiry${reference} — Fresco NY`, text,
      attachments: [
        { filename: 'fresco-ny-logo-transparent.png', path: path.join(__dirname, '..', 'public', 'email', 'fresco-ny-logo-transparent.png'), cid: 'fresco-ny-logo@fresco', contentDisposition: 'inline' },
        { filename: 'fresco-thankyou-footer.png', path: path.join(__dirname, '..', 'src', 'assets', 'email', 'fresco-thankyou-footer.png'), cid: 'fresco-thankyou-footer@fresco', contentDisposition: 'inline' }
      ],
      html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" align="center" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border-collapse:collapse;background:#f5f1e7;border-top:5px solid #064b35"><tr><td style="padding:28px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:28px"><tr><td align="left"><img src="cid:fresco-ny-logo@fresco" width="160" height="33" alt="Fresco NY — Designing, Development, Sourcing" style="display:block;width:160px;max-width:100%;height:auto;border:0"></td></tr></table><h1 style="color:#064b35;font-size:24px">Thank you for contacting Fresco NY</h1><p>We have received your enquiry${reference} about ${escapeHtml(enquiry.purpose)}.</p><p>Our team will get back to you shortly. You can reply to this email if you would like to add anything.</p><p style="margin-bottom:0">Fresco NY team</p></td></tr><tr><td style="padding:0;font-size:0;line-height:0"><img src="cid:fresco-thankyou-footer@fresco" width="600" alt="Apparel photograph with three red dots" style="display:block;width:100%;max-width:600px;height:auto;margin:0;padding:0;border:0"></td></tr></table>`
    };
  }
  const overdue = kind === 'overdue';
  const heading = overdue
    ? `This enquiry has been waiting for ${waitingHours} hours. Please reply ASAP.`
    : `New enquiry${reference} from the Fresco NY website.`;
  const details = `Company: ${company}\nBusiness email: ${enquiry.email}\nPhone: ${enquiry.phone}\nPurpose: ${enquiry.purpose}`;
  const url = id ? linkFor(id) : '';
  return {
    from, to: INBOX(), replyTo: { name: company, address: enquiry.email },
    subject: `${overdue ? '[ACTION REQUIRED] Waiting ' + waitingHours + ' hours — enquiry' : 'New enquiry'}${reference} — ${company}`,
    text: `${heading}\n\n${details}\n\nMessage:\n${enquiry.message || '(none)'}\n\n${url ? `View and follow up: ${url}\n` : ''}Reply to this email to answer the customer directly.${id ? '\nAfter replying, mark the enquiry Contacted in admin to stop overdue alerts.' : ''}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;background:${overdue ? '#fff1f2' : '#f5f1e7'};border-top:5px solid ${overdue ? '#b91c1c' : '#064b35'}"><h1 style="font-size:23px;color:${overdue ? '#b91c1c' : '#064b35'}">${escapeHtml(heading)}</h1><p style="white-space:pre-line">${escapeHtml(details)}</p><h2 style="font-size:16px">Message</h2><p style="white-space:pre-wrap">${escapeHtml(enquiry.message || '(none)')}</p>${url ? `<p><a href="${escapeHtml(url)}">Open enquiry${reference}</a></p>` : ''}<p>Reply to this email to answer the customer directly.</p>${id ? '<p>After replying, mark the enquiry <strong>Contacted</strong> in admin.</p>' : ''}</div>`
  };
}

let running;
let timer;
async function processEmailJobs() {
  const pool = getPool();
  const transport = createMailTransport();
  if (!pool || !transport) return;
  await ensureEmailTables(pool);
  const connection = await pool.getConnection();
  let locked = false;
  try {
    // A connection-scoped lock prevents competing workers on different server instances.
    const [[lock]] = await connection.query("SELECT GET_LOCK(CONCAT(LEFT(DATABASE(), 35), ':enquiry-email'), 0) AS acquired");
    locked = Boolean(lock.acquired);
    if (!locked) return;
    const settings = await emailSettings(connection);
    if (settings.alertsEnabled) {
      await connection.query(`INSERT IGNORE INTO enquiry_email_jobs (enquiry_id, kind)
        SELECT id, 'overdue' FROM enquiries
        WHERE status = 'new' AND created_at <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP())`, [Math.round(settings.responseHours * 3600)]);
    }
    const [jobs] = await connection.query(`SELECT j.kind, e.*,
        TIMESTAMPDIFF(SECOND, e.created_at, UTC_TIMESTAMP()) / 3600 AS waiting_hours
      FROM enquiry_email_jobs j JOIN enquiries e ON e.id = j.enquiry_id
      WHERE j.sent_at IS NULL AND j.next_attempt_at <= UTC_TIMESTAMP()
        AND (j.kind <> 'overdue' OR (? = 1 AND e.status = 'new'
          AND e.created_at <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP())))
      ORDER BY j.next_attempt_at, j.enquiry_id, j.kind LIMIT 50`, [settings.alertsEnabled ? 1 : 0, Math.round(settings.responseHours * 3600)]);
    for (const job of jobs) {
      // Recheck immediately before an alert: staff may have replied while other jobs were sent.
      if (job.kind === 'overdue') {
        const [[current]] = await connection.query('SELECT status FROM enquiries WHERE id = ?', [job.id]);
        if (current?.status !== 'new') continue;
      }
      // Reserve a retry window before SMTP; a process crash won't cause an immediate resend loop.
      await connection.query(`UPDATE enquiry_email_jobs SET attempts = attempts + 1,
        next_attempt_at = TIMESTAMPADD(MINUTE, 15, UTC_TIMESTAMP()) WHERE enquiry_id = ? AND kind = ?`, [job.id, job.kind]);
      try {
        await transport.sendMail(buildEnquiryEmail(job.kind, job, Math.floor(Number(job.waiting_hours) * 10) / 10));
        await connection.query('UPDATE enquiry_email_jobs SET sent_at = UTC_TIMESTAMP(), last_error = NULL WHERE enquiry_id = ? AND kind = ?', [job.id, job.kind]);
        if (job.kind === 'team') await connection.query("UPDATE enquiries SET email_status = 'sent', updated_at = updated_at WHERE id = ?", [job.id]);
      } catch (error) {
        await connection.query('UPDATE enquiry_email_jobs SET last_error = ? WHERE enquiry_id = ? AND kind = ?', [error.message.slice(0, 500), job.id, job.kind]);
        if (job.kind === 'team') await connection.query("UPDATE enquiries SET email_status = 'failed', updated_at = updated_at WHERE id = ?", [job.id]);
        console.error(`Enquiry #${job.id} ${job.kind} email failed; will retry:`, error.message);
      }
    }
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT(LEFT(DATABASE(), 35), ':enquiry-email'))").catch(() => {});
    connection.release();
    transport.close();
  }
}

function wakeEnquiryEmailWorker() {
  if (!running) running = processEmailJobs()
    .catch((error) => console.error('Enquiry email worker:', error.message))
    .finally(() => { running = null; });
  return running;
}

/** Wait briefly for SMTP confirmation; the durable queue keeps working after this request ends. */
async function confirmTeamEmail(id, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  do {
    wakeEnquiryEmailWorker();
    const [[enquiry]] = await getPool().query('SELECT email_status FROM enquiries WHERE id = ?', [id]);
    if (enquiry?.email_status === 'sent') return true;
    if (!enquiry || enquiry.email_status === 'failed' || enquiry.email_status === 'off') return false;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  } while (Date.now() <= deadline);
  return false;
}
function startEnquiryEmailWorker() {
  if (timer) return;
  wakeEnquiryEmailWorker();
  timer = setInterval(wakeEnquiryEmailWorker, 60000);
  timer.unref();
}
function stopEnquiryEmailWorker() {
  clearInterval(timer);
  timer = null;
  return running || Promise.resolve();
}

function createEnquiryEmailRouter() {
  const router = express.Router();
  router.use(requireRole('admin', 'viewer'));
  router.get('/', async (req, res, next) => {
    try {
      const settings = await emailSettings();
      const [deliveries] = await getPool().query(`SELECT kind, COUNT(*) AS pending,
        SUM(last_error IS NOT NULL) AS failed FROM enquiry_email_jobs WHERE sent_at IS NULL GROUP BY kind`);
      res.json({ success: true, settings: { ...settings, inbox: INBOX(), smtpConfigured: Boolean(process.env.SMTP_HOST), canEdit: req.user.role === 'admin', deliveries } });
    } catch (error) { next(error); }
  });
  router.put('/', requireRole('admin'), jsonOnly, express.json({ limit: '2kb' }), async (req, res, next) => {
    const hours = req.body?.responseHours;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0.25 || hours > 720 || typeof req.body?.alertsEnabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Choose a response deadline between 0.25 and 720 hours and an alert setting.' });
    }
    try {
      await ensureEmailTables(getPool());
      await getPool().query('UPDATE enquiry_email_settings SET response_hours = ?, alerts_enabled = ? WHERE id = 1', [Math.round(hours * 100) / 100, req.body.alertsEnabled ? 1 : 0]);
      res.json({ success: true, settings: await emailSettings() });
      wakeEnquiryEmailWorker();
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { ensureEmailTables, emailSettings, queueInitialEmails, buildEnquiryEmail,
  createEnquiryEmailRouter, confirmTeamEmail, wakeEnquiryEmailWorker, startEnquiryEmailWorker, stopEnquiryEmailWorker };
