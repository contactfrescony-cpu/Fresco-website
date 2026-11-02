'use strict';

// POST /api/contact — emails B2B enquiries from the Contact page to the Fresco NY inbox.
// Fields (per the brief, nothing more): company*, email*, phone* (with country code), purpose*, message.
//
// Configure with environment variables (or a .env file next to server.js):
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE ("true" for port 465),
//   SMTP_USER, SMTP_PASS, CONTACT_TO (default info@frescony.uk), CONTACT_FROM (default SMTP_USER)
// Without SMTP_HOST the endpoint answers 503 and the page falls back to opening an email draft.

const express = require('express');
const nodemailer = require('nodemailer');

const FIELD_LIMITS = { company: 160, email: 200, phone: 32, purpose: 80, message: 5000 };
const REQUIRED = ['company', 'email', 'phone', 'purpose'];
// Keep in sync with PURPOSES in src/data/site.js.
const PURPOSES = [
  'New product development',
  'Sampling',
  'Bulk manufacturing',
  'Fabric & material sourcing',
  'Dyeing, washing & finishing',
  'Supply chain & replenishment',
  'Partnership',
  'Other'
];
const EMAIL_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
// International format: "+" and country code, then digits with optional spaces, dots, dashes or brackets.
const PHONE_PATTERN = /^\+[0-9][0-9 ().-]{5,30}$/;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 5;

const oneLine = (value) => value.replace(/[\r\n\t]+/g, ' ');
const digitCount = (value) => value.replace(/\D/g, '').length;

function createContactRouter(env = process.env) {
  const router = express.Router();
  const to = env.CONTACT_TO || 'info@frescony.uk';
  const from = env.CONTACT_FROM || env.SMTP_USER || to;
  const transporter = env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number.parseInt(env.SMTP_PORT || '587', 10),
        secure: env.SMTP_SECURE === 'true',
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
      })
    : null;

  // Small in-memory limiter: at most RATE_MAX enquiries per IP per window.
  const recent = new Map();
  const isRateLimited = (ip) => {
    const now = Date.now();
    const times = (recent.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (times.length >= RATE_MAX) { recent.set(ip, times); return true; }
    times.push(now);
    recent.set(ip, times);
    if (recent.size > 5000) recent.clear();
    return false;
  };

  router.post('/', express.json({ limit: '32kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // Honeypot: real visitors never fill the hidden "website" field.
    if (typeof body.website === 'string' && body.website.trim()) return res.json({ ok: true });

    // Validate before anything else, so the visitor gets field errors even when email isn't configured.
    const data = {};
    for (const [field, max] of Object.entries(FIELD_LIMITS)) {
      const value = typeof body[field] === 'string' ? body[field].trim() : '';
      if (value.length > max) return res.status(400).json({ error: 'invalid', field });
      data[field] = value;
    }
    const missing = REQUIRED.find((field) => !data[field]);
    if (missing) return res.status(400).json({ error: 'invalid', field: missing });
    if (!EMAIL_PATTERN.test(data.email)) return res.status(400).json({ error: 'invalid', field: 'email' });
    const digits = digitCount(data.phone);
    if (!PHONE_PATTERN.test(data.phone) || digits < 7 || digits > 15) {
      return res.status(400).json({ error: 'invalid', field: 'phone' });
    }
    if (!PURPOSES.includes(data.purpose)) return res.status(400).json({ error: 'invalid', field: 'purpose' });

    if (!transporter) return res.status(503).json({ error: 'not_configured' });
    if (isRateLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });

    const text = [
      `Company: ${oneLine(data.company)}`,
      `Business email: ${data.email}`,
      `Phone: ${oneLine(data.phone)}`,
      `Purpose: ${data.purpose}`,
      '',
      'Message:',
      data.message || '(none)',
      '',
      'Sent from the Fresco NY website enquiry form.'
    ].join('\n');

    try {
      await transporter.sendMail({
        from: { name: 'Fresco NY website', address: from },
        to,
        replyTo: { name: oneLine(data.company), address: data.email },
        subject: `Fresco NY enquiry — ${oneLine(data.company)} — ${data.purpose}`,
        text
      });
      return res.json({ ok: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] contact email failed:`, error.message);
      return res.status(502).json({ error: 'send_failed' });
    }
  });

  return router;
}

module.exports = { createContactRouter, PURPOSES };
