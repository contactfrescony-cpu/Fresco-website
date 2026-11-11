'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const express = require('express');
const geoip = require('geoip-lite');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const { GoogleAuth, JWT } = require('google-auth-library');
const { getPool } = require('./db.js');
const { requireRole, jsonOnly, rateLimiter } = require('./auth.js');

const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const REALTIME_CACHE_TTL_MS = 30 * 1000;
const VISIT_LOG_RETENTION_DAYS = 30;

const cache = new Map();
let gaClient = null;
let gaClientKeyFile = null;

/* ------------------------------------------------------------------ */
/* Google Analytics 4 Data API                                         */
/* ------------------------------------------------------------------ */

/**
 * Returns { client, property } when GA4 is usable, or { problem } explaining
 * exactly what is missing so the dashboard can say so instead of showing zeros.
 */
function getGa() {
  const propertyId = (process.env.GA4_PROPERTY_ID || '').trim();
  const keySetting = (process.env.GA4_KEY_FILE || '').trim();
  if (!propertyId) return { problem: 'GA4_PROPERTY_ID is not set in .env.' };
  if (!/^\d+$/.test(propertyId)) return { problem: 'GA4_PROPERTY_ID must be the numeric GA4 property ID (not the G-… measurement ID).' };
  if (!keySetting) return { problem: 'GA4_KEY_FILE is not set in .env.' };

  const keyFile = path.resolve(process.cwd(), keySetting);
  if (!fs.existsSync(keyFile)) return { problem: `GA4 key file not found at ${keySetting}.` };

  if (!gaClient || gaClientKeyFile !== keyFile) {
    try {
      const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      if (key.type !== 'service_account' || !key.client_email || !key.private_key) {
        return { problem: 'GA4 key file is not a valid Google service-account key.' };
      }
      const authClient = new JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly']
      });
      const auth = new GoogleAuth({ authClient });
      gaClient = new BetaAnalyticsDataClient({ auth });
      gaClientKeyFile = keyFile;
    } catch (err) {
      return { problem: `GA4 key file could not be read: ${err.message}` };
    }
  }
  return { client: gaClient, property: `properties/${propertyId}` };
}

/** Ranges include today, and "7 days" really means 7 calendar days. */
const RANGES = {
  today: { startDate: 'today', endDate: 'today' },
  yesterday: { startDate: 'yesterday', endDate: 'yesterday' },
  '7d': { startDate: '6daysAgo', endDate: 'today' },
  '30d': { startDate: '29daysAgo', endDate: 'today' },
  '90d': { startDate: '89daysAgo', endDate: 'today' }
};

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache(key, data, ttl) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
}

const num = (v) => Number(v?.value || 0);
const dim = (v) => v?.value ?? '';

/** Google's gRPC errors start with a status code ("7 PERMISSION_DENIED: …"); keep the readable part. */
function gaErrorMessage(err) {
  const message = String(err?.details || err?.message || 'Unknown Google Analytics error');
  if (/PERMISSION_DENIED/i.test(message)) {
    return `Google denied access to the GA4 property. Add the service account as a Viewer in GA4 Admin → Property access management. (${message})`;
  }
  return message;
}

function sendGaProblem(res, problem) {
  res.status(503).json({ success: false, configured: false, error: problem });
}

function sendGaError(res, err) {
  console.error('[GA4 Analytics]', err?.message || err);
  res.status(502).json({ success: false, configured: true, error: gaErrorMessage(err) });
}

async function runMainReport(client, property, dateRange) {
  const base = { dateRanges: [dateRange] };
  const [batch] = await client.batchRunReports({
    property,
    requests: [
      // 0 — totals
      {
        ...base,
        metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'userEngagementDuration']
          .map((name) => ({ name }))
      },
      // 1 — day by day
      {
        ...base,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 400
      },
      // 2 — acquisition channels
      {
        ...base,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      },
      // 3 — pages
      {
        ...base,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 25
      },
      // 4 — countries
      {
        ...base,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 15
      }
    ]
  });

  const [totalsRes, trendRes, sourcesRes, pagesRes, countriesRes] = batch.reports || [];
  const t = totalsRes?.rows?.[0]?.metricValues || [];
  const activeUsers = num(t[0]);
  const engagementSeconds = num(t[5]);

  return {
    timeZone: totalsRes?.metadata?.timeZone || null,
    currencyCode: totalsRes?.metadata?.currencyCode || null,
    // GA hides small numbers when Google signals thresholds apply; tell the UI so it can say so.
    thresholded: (batch.reports || []).some((r) => r?.metadata?.subjectToThresholding),
    kpis: {
      activeUsers,
      newUsers: num(t[1]),
      sessions: num(t[2]),
      pageViews: num(t[3]),
      engagementRate: num(t[4]),                       // 0..1
      avgEngagementSec: activeUsers ? engagementSeconds / activeUsers : 0
    },
    dailyTrend: (trendRes?.rows || []).map((r) => {
      const raw = dim(r.dimensionValues[0]);
      return {
        date: raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw,
        activeUsers: num(r.metricValues[0]),
        sessions: num(r.metricValues[1]),
        pageViews: num(r.metricValues[2])
      };
    }),
    sources: (sourcesRes?.rows || []).map((r) => ({
      channel: dim(r.dimensionValues[0]),
      sessions: num(r.metricValues[0]),
      users: num(r.metricValues[1]),
      engagementRate: num(r.metricValues[2])
    })),
    pages: (pagesRes?.rows || []).map((r) => {
      const users = num(r.metricValues[1]);
      return {
        path: dim(r.dimensionValues[0]),
        pageViews: num(r.metricValues[0]),
        users,
        avgEngagementSec: users ? num(r.metricValues[2]) / users : 0
      };
    }),
    countries: (countriesRes?.rows || []).map((r) => ({
      country: dim(r.dimensionValues[0]),
      users: num(r.metricValues[0]),
      sessions: num(r.metricValues[1]),
      pageViews: num(r.metricValues[2])
    }))
  };
}

async function runRealtime(client, property) {
  const [[totals], [pages]] = await Promise.all([
    client.runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] }),
    client.runRealtimeReport({
      property,
      dimensions: [{ name: 'unifiedScreenName' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 5
    })
  ]);
  return {
    activeUsers: num(totals?.rows?.[0]?.metricValues?.[0]),
    pages: (pages?.rows || []).map((r) => ({ title: dim(r.dimensionValues[0]), users: num(r.metricValues[0]) }))
  };
}

/* ------------------------------------------------------------------ */
/* Server-side visit log (our own database, not Google)                */
/* ------------------------------------------------------------------ */

const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|curl|wget|python-requests/i;

function parseUserAgent(uaString) {
  const ua = uaString || '';
  let deviceType = 'desktop';
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) deviceType = 'tablet';
  else if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) deviceType = 'mobile';

  let os = 'Unknown';
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/cros/i.test(ua)) os = 'ChromeOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/samsungbrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  return { deviceType, browser, os };
}

/** Uses Express's req.ip, which honours X-Forwarded-For only when TRUST_PROXY=true (so it can't be spoofed). */
function clientIp(req) {
  let ip = req.ip || req.socket?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function isPrivateIp(ip) {
  if (!ip || !net.isIP(ip)) return true;
  if (net.isIPv4(ip)) {
    return /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

let regionNames = null;
function countryName(code) {
  if (!code) return null;
  try {
    regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

async function ensureVisitorLogsTable() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS visitor_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        ip_address VARCHAR(64) NOT NULL,
        country VARCHAR(100) NULL,
        country_code VARCHAR(10) NULL,
        region VARCHAR(100) NULL,
        city VARCHAR(100) NULL,
        page_url VARCHAR(500) NOT NULL,
        referrer VARCHAR(500) NULL,
        user_agent VARCHAR(500) NULL,
        device_type VARCHAR(50) DEFAULT 'desktop',
        browser VARCHAR(50) NULL,
        os VARCHAR(50) NULL,
        session_id VARCHAR(100) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created_at (created_at),
        INDEX idx_ip (ip_address)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error('[Analytics] Could not ensure visitor_logs table:', err.message);
  }
}

/** Keeps the promise shown on the dashboard: visits are deleted after 30 days. */
async function purgeOldVisits() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `DELETE FROM visitor_logs
        WHERE created_at < NOW() - INTERVAL ? DAY
           OR country_code = 'LAN'`, // test hits from the office network logged by an earlier version
      [VISIT_LOG_RETENTION_DAYS]
    );
  } catch (err) {
    console.error('[Analytics] Could not purge old visitor_logs:', err.message);
  }
}

let maintenanceStarted = false;
function startVisitLogMaintenance() {
  if (maintenanceStarted) return;
  maintenanceStarted = true;
  void ensureVisitorLogsTable().then(purgeOldVisits);
  setInterval(purgeOldVisits, 24 * 60 * 60 * 1000).unref();
}

function createPublicAnalyticsRouter() {
  const router = express.Router();
  const tooManyHits = rateLimiter(120, 60 * 60 * 1000);
  startVisitLogMaintenance();

  router.post('/collect', jsonOnly, express.json({ limit: '4kb' }), async (req, res) => {
    res.status(204).end();
    try {
      const ip = clientIp(req);
      const userAgent = String(req.headers['user-agent'] || '');
      // Real visitors only: no local/office-network testing, no bots, no flooding.
      if (isPrivateIp(ip) || !userAgent || BOT_PATTERN.test(userAgent) || tooManyHits(ip)) return;

      const body = req.body || {};
      const pageUrl = String(body.pageUrl || '/').slice(0, 500);
      if (!pageUrl.startsWith('/') || pageUrl.startsWith('/admin')) return;
      const referrer = String(body.referrer || '').slice(0, 500) || null;
      const sessionId = String(body.sessionId || '').slice(0, 100) || null;

      const geo = geoip.lookup(ip);
      const { deviceType, browser, os } = parseUserAgent(userAgent);

      const pool = getPool();
      if (!pool) return;
      await pool.query(
        `INSERT INTO visitor_logs
           (ip_address, country, country_code, region, city, page_url, referrer, user_agent, device_type, browser, os, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ip, countryName(geo?.country), geo?.country || null, geo?.region || null, geo?.city || null,
          pageUrl, referrer, userAgent.slice(0, 500), deviceType, browser, os, sessionId
        ]
      );
    } catch (err) {
      console.error('[Analytics] Could not log visit:', err.message);
    }
  });

  return router;
}

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

function createAdminAnalyticsRouter() {
  const router = express.Router();
  router.use(requireRole('admin', 'viewer'));
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  /** Everything for the chosen date range, straight from GA4, in one batched call. */
  router.get('/report', async (req, res) => {
    const range = RANGES[req.query.range] ? req.query.range : '7d';
    const ga = getGa();
    if (ga.problem) return sendGaProblem(res, ga.problem);

    const cacheKey = `report:${range}`;
    const cached = getFromCache(cacheKey);
    if (cached) return res.json({ success: true, configured: true, data: cached });

    try {
      const report = await runMainReport(ga.client, ga.property, RANGES[range]);
      const data = { range, fetchedAt: new Date().toISOString(), ...report };
      setInCache(cacheKey, data, REPORT_CACHE_TTL_MS);
      return res.json({ success: true, configured: true, data });
    } catch (err) {
      return sendGaError(res, err);
    }
  });

  /** Users active in the last 30 minutes (GA4 Realtime API — not subject to processing delay). */
  router.get('/realtime', async (req, res) => {
    const ga = getGa();
    if (ga.problem) return sendGaProblem(res, ga.problem);

    const cached = getFromCache('realtime');
    if (cached) return res.json({ success: true, configured: true, data: cached });

    try {
      const data = { fetchedAt: new Date().toISOString(), ...(await runRealtime(ga.client, ga.property)) };
      setInCache('realtime', data, REALTIME_CACHE_TTL_MS);
      return res.json({ success: true, configured: true, data });
    } catch (err) {
      return sendGaError(res, err);
    }
  });

  router.get('/recent-visitors', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ success: false, error: 'Database is not configured.' });
    try {
      const [rows] = await pool.query(
        `SELECT id, ip_address AS ipAddress, country, country_code AS countryCode, region, city,
                page_url AS pageUrl, referrer, device_type AS deviceType, browser, os, session_id AS sessionId,
                created_at AS createdAt
           FROM visitor_logs
          ORDER BY created_at DESC
          LIMIT 100`
      );
      return res.json({ success: true, data: rows });
    } catch (err) {
      return res.status(500).json({ success: false, error: `Visit log could not be read: ${err.message}` });
    }
  });

  router.post('/clear-cache', jsonOnly, (req, res) => {
    cache.clear();
    res.json({ success: true });
  });

  return router;
}

module.exports = {
  createPublicAnalyticsRouter,
  createAdminAnalyticsRouter,
  // Used by the daily email report (server/analytics-email.js).
  getGa,
  runMainReport,
  gaErrorMessage,
  RANGES
};
