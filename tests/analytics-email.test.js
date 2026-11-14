'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEmail, sendReport } = require('../server/analytics-email');
const sample = (users = 12) => ({
  timeZone: 'Asia/Calcutta',
  kpis: { activeUsers: users, newUsers: 8, sessions: 15, pageViews: 40, engagementRate: 0.6, avgEngagementSec: 90 },
  pages: [{ path: '/development', pageViews: 15, users: 5, avgEngagementSec: 125 }],
  countries: [{ country: 'India', users: 10, pageViews: 30 }],
  sources: [{ channel: 'Organic Search', sessions: 10, users: 8 }]
});
const input = () => ({ isoDate: '2026-11-13', report: sample(), weekReport: sample(63) });

test('both periods, data, inline logos and login link are present without long copy', () => {
  const email = buildEmail(input());
  for (const body of [email.html, email.text]) {
    for (const value of ['Yesterday', 'Last 7 Days', 'India', '/development', '2m 05s', 'Organic Search', '63']) assert.ok(body.toLowerCase().includes(value.toLowerCase()), value);
    assert.doesNotMatch(body, /Executive summary|See the full picture|This is a test email|You receive this because/);
    assert.match(body, /2026/);
    assert.match(body, /\/admin\/login/);
  }
  assert.doesNotMatch(email.html, /href="#(?:yesterday|last-7-days)"/);
  assert.match(email.html, /Data source: Google Analytics 4 \(GA4\)/);
  assert.match(email.text, /Data source: Google Analytics 4 \(GA4\)/);
  assert.match(email.html, /width="130" height="27"/);
  assert.equal(email.attachments[0].filename, 'fresco-ny-logo-transparent.png');
  assert.match(email.html, /id="yesterday"/);
  assert.match(email.html, /id="last-7-days"/);
  assert.equal((email.html.match(/src="cid:fresco-analytics-logo@fresco"/g) || []).length, 2);
  assert.equal(email.attachments[0].cid, 'fresco-analytics-logo@fresco');
  assert.ok(require('fs').existsSync(email.attachments[0].path));
  assert.doesNotMatch(email.html, /href="[^"]*\/admin\/analytics/);
});

test('test and scheduled email templates are identical', () => {
  assert.deepEqual(buildEmail({ ...input(), test: true }), buildEmail({ ...input(), test: false }));
});

test('period failures stay separate and analytics content is escaped', () => {
  const data = input();
  data.report = undefined; data.error = 'Daily unavailable <retry>';
  data.weekReport.pages[0].path = '/<script>alert(1)</script>';
  data.weekReport.thresholded = true;
  const email = buildEmail(data);
  assert.match(email.html, /Daily unavailable &lt;retry&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.text, /privacy thresholds/);
  assert.match(email.text, /63/);
  const empty = sample(0);
  empty.pages = []; empty.countries = []; empty.sources = [];
  assert.match(buildEmail({ ...input(), report: empty }).html, /No recorded data/);
});

test('sending fetches seven complete days ending yesterday for both send types', async () => {
  const messages = [];
  for (const test of [false, true]) {
    const calls = [];
    const result = await sendReport({ recipients: ['md@example.com'], isoDate: '2026-03-01', test,
      transport: { sendMail: async (mail) => messages.push(mail) },
      fetchReport: async (...args) => { calls.push(args); return { report: sample(args.length === 1 ? 12 : 63) }; }
    });
    assert.deepEqual(calls, [['2026-03-01'], ['2026-03-01', '2026-02-23']]);
    assert.equal(result.gaError, null);
  }
  assert.deepEqual(messages[0], messages[1]);
});

test('weekly failure is reported while successful daily data is still sent', async () => {
  let sent;
  const result = await sendReport({ recipients: ['md@example.com'], isoDate: '2026-11-13',
    transport: { sendMail: async (mail) => { sent = mail; } },
    fetchReport: async (end, start) => start ? { error: 'Weekly unavailable' } : { report: sample() }
  });
  assert.equal(result.gaError, 'Last 7 Days: Weekly unavailable');
  assert.match(sent.text, /Active visitors: 12/);
  assert.match(sent.text, /Weekly unavailable/);
});
