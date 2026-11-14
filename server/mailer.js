'use strict';

// One SMTP set-up for every email the site sends (contact enquiries, daily analytics report).
// Settings come from SMTP_* in .env; see .env.example.

const nodemailer = require('nodemailer');

/** Returns a nodemailer transport, or null when SMTP_HOST is not set. */
function createMailTransport(env = process.env) {
  if (!env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number.parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
  });
}

/** The address emails are sent from (must be one the SMTP account may send as). */
function mailFromAddress(env = process.env) {
  return env.CONTACT_FROM || env.SMTP_USER || env.CONTACT_TO || 'connectfrescony@gmail.com';
}

// Plain addresses only: no names, no lists, nothing that could inject extra headers.
const EMAIL_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

module.exports = { createMailTransport, mailFromAddress, EMAIL_PATTERN };
