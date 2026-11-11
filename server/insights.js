'use strict';

// Public Insights feed: blogs the team keeps in Google Drive (one folder per tab, max 20 each), read through
// the Apps Script bridge google/insights-feed.gs. The result is cached in memory so Drive is read at most once a minute.
//
//   INSIGHTS_FEED_URL     the Apps Script web-app URL (ends in /exec)
//   INSIGHTS_FEED_SECRET  shared secret; the same value is the script's INSIGHTS_SECRET property

const express = require('express');

const TIMEOUT_MS = 30 * 1000;
const FRESH_MS = 60 * 1000;            // a page load re-reads Drive when the copy is over a minute old (at most one Drive read a minute, however busy the site)
const MAX_PER_TAB = 20;

let cache = null;                      // { at: ms, insights: [...] }
let inflight = null;

const isInsightsConfigured = (env = process.env) => Boolean(env.INSIGHTS_FEED_URL && env.INSIGHTS_FEED_SECRET);

class InsightsError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

async function callScript(payload, env = process.env) {
  if (!isInsightsConfigured(env)) throw new InsightsError('insights_not_configured');
  let response;
  try {
    response = await fetch(env.INSIGHTS_FEED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, secret: env.INSIGHTS_FEED_SECRET }),
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new InsightsError('insights_unreachable', error.name === 'TimeoutError' ? 'timed out' : error.message);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new InsightsError('insights_bad_response', `HTTP ${response.status}`);
  if (!result.ok) throw new InsightsError(`insights_${result.error || 'error'}`, result.detail);
  return result;
}

const pingInsights = (env = process.env) => callScript({ action: 'ping' }, env);

// Only web links may be followed from a card (blocks javascript: and similar).
const safeUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch { return ''; }
};

/** Cleans what the script returned: valid links only, newest first, at most 20 per tab. */
function normalise(list) {
  const perTab = new Map();
  const items = (Array.isArray(list) ? list : [])
    .map((item) => ({
      id: String(item.id || '').slice(0, 120),
      tab: String(item.tab || ''),
      title: String(item.title || '').trim().slice(0, 300),
      description: String(item.description || '').trim().slice(0, 1200),
      image: safeUrl(item.image),
      link: safeUrl(item.link),
      sort: String(item.sort || '')
    }))
    .filter((item) => item.id && item.tab && item.title && item.link)
    .sort((a, b) => b.sort.localeCompare(a.sort));
  return items.filter((item) => {
    const count = (perTab.get(item.tab) || 0) + 1;
    perTab.set(item.tab, count);
    return count <= MAX_PER_TAB;
  });
}

function refresh(env = process.env) {
  if (!inflight) {
    inflight = callScript({ action: 'list' }, env)
      .then((result) => { cache = { at: Date.now(), insights: normalise(result.insights) }; return cache; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * The list plus whether a Drive re-read is still running. Reading Drive takes several seconds, so a stale copy
 * (over a minute old) is returned at once while a refresh starts in the background; with wait=true the call
 * waits for that refresh and returns the new list. If Drive cannot be reached, the last good copy is kept.
 */
async function getInsights(env = process.env, { wait = false } = {}) {
  if (!cache) return { insights: (await refresh(env)).insights, refreshing: false };
  if (Date.now() - cache.at < FRESH_MS) return { insights: cache.insights, refreshing: false };
  const pending = refresh(env).catch((error) => console.error('Insights refresh failed, keeping the last copy:', error.message));
  if (wait) { await pending; return { insights: cache.insights, refreshing: false }; }
  return { insights: cache.insights, refreshing: true };
}

function createInsightsRouter() {
  const router = express.Router();
  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');   // browsers must ask again on every refresh
    if (!isInsightsConfigured()) return res.json({ insights: [] });
    try {
      return res.json(await getInsights(process.env, { wait: req.query.wait === '1' }));
    } catch (error) {
      console.error('Insights feed failed:', error.message);
      return res.set('Cache-Control', 'no-store').status(503).json({ error: 'insights_unavailable', insights: [] });
    }
  });
  return router;
}

module.exports = { createInsightsRouter, isInsightsConfigured, pingInsights, InsightsError };
