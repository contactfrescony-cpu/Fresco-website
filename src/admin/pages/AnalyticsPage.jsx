import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { jsonBody, requestJson } from '../requestJson.js';
import AnalyticsEmailSettings from './AnalyticsEmailSettings.jsx';

const RANGES = [
  { id: 'today', label: 'Today', description: 'today' },
  { id: 'yesterday', label: 'Yesterday', description: 'yesterday' },
  { id: '7d', label: '7 Days', description: 'the last 7 days (including today)' },
  { id: '30d', label: '30 Days', description: 'the last 30 days (including today)' },
  { id: '90d', label: '90 Days', description: 'the last 90 days (including today)' }
];

const REALTIME_REFRESH_MS = 60 * 1000;
const EMPTY = '—';

const fmtInt = (n) => Math.round(n).toLocaleString();
const fmtPct = (ratio) => `${(ratio * 100).toFixed(1)}%`;

function fmtDuration(seconds) {
  const total = Math.round(seconds || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m === 0 ? `${s}s` : `${m}m ${String(s).padStart(2, '0')}s`;
}

function fmtDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtRelative(dateStr) {
  const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (Number.isNaN(diffSec)) return '';
  if (diffSec < 60) return 'Just now';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function KpiCard({ label, value, note }) {
  return (
    <div className="admin-card">
      <span className="admin-card-status">{label}</span>
      <h2 style={{ fontSize: '30px', margin: '8px 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</h2>
      <p className="muted">{note}</p>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <div className="admin-panel" style={{ padding: '20px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: 'var(--green)' }}>{title}</h3>
      {subtitle && <p className="muted" style={{ margin: '0 0 14px', fontSize: '12px' }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function EmptyRow({ colSpan, children }) {
  return (
    <tr><td colSpan={colSpan} className="muted" style={{ textAlign: 'center', padding: '16px' }}>{children}</td></tr>
  );
}

export default function AnalyticsPage() {
  // Links such as the daily email's "View more" can open a range directly: /admin/analytics?range=yesterday
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState(() => {
    const requested = searchParams.get('range');
    return RANGES.some((r) => r.id === requested) ? requested : '7d';
  });
  const [refreshing, setRefreshing] = useState(false);

  const [report, setReport] = useState({ loading: true, data: null, error: null, configured: true });
  const [realtime, setRealtime] = useState({ loading: true, data: null, error: null });
  const [visits, setVisits] = useState({ loading: true, rows: [], error: null });
  const [copiedIp, setCopiedIp] = useState(null);

  const reportRequest = useRef(0);

  const loadReport = useCallback(async (selectedRange) => {
    const id = ++reportRequest.current;
    setReport((prev) => ({ ...prev, loading: true }));
    const res = await requestJson(`/api/admin/analytics/report?range=${encodeURIComponent(selectedRange)}`);
    if (id !== reportRequest.current) return; // a newer range was selected meanwhile
    setReport(res.ok
      ? { loading: false, data: res.body.data, error: null, configured: true }
      : { loading: false, data: null, error: res.error, configured: res.configured !== false });
  }, []);

  const loadRealtime = useCallback(async () => {
    const res = await requestJson('/api/admin/analytics/realtime');
    setRealtime(res.ok
      ? { loading: false, data: res.body.data, error: null }
      : { loading: false, data: null, error: res.error });
  }, []);

  const loadVisits = useCallback(async () => {
    const res = await requestJson('/api/admin/analytics/recent-visitors');
    setVisits(res.ok
      ? { loading: false, rows: res.body.data || [], error: null }
      : { loading: false, rows: [], error: res.error });
  }, []);

  useEffect(() => { loadReport(range); }, [range, loadReport]);

  useEffect(() => {
    loadRealtime();
    loadVisits();
    const timer = setInterval(loadRealtime, REALTIME_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadRealtime, loadVisits]);

  async function handleRefresh() {
    setRefreshing(true);
    await requestJson('/api/admin/analytics/clear-cache', jsonBody('POST'));
    await Promise.all([loadReport(range), loadRealtime(), loadVisits()]);
    setRefreshing(false);
  }

  // Daily email settings open in a modal dialog (native <dialog>: Esc closes, focus stays inside).
  const emailDialog = useRef(null);
  const [emailOpen, setEmailOpen] = useState(false);
  function openEmailDialog() {
    setEmailOpen(true);
    emailDialog.current?.showModal();
  }
  const closeEmailDialog = () => emailDialog.current?.close();

  function handleCopyIp(ip) {
    navigator.clipboard?.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 2000);
  }

  const rangeInfo = RANGES.find((r) => r.id === range) || RANGES[2];
  const data = report.data;
  const k = data?.kpis;
  const show = (fn) => (report.loading ? '…' : k ? fn(k) : EMPTY);
  const noGaData = data && k.activeUsers === 0 && k.pageViews === 0 && k.sessions === 0;
  const topChannel = data?.sources?.[0];
  const maxCountryUsers = data?.countries?.[0]?.users || 1;

  return (
    <>
      <header className="admin-page-head">
        <div className="eyebrow">WEB INTELLIGENCE</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <h1>Analytics</h1>
              <button
                type="button"
                className="button light"
                onClick={openEmailDialog}
                aria-haspopup="dialog"
                style={{ padding: '9px 16px', fontSize: '11px' }}
              >
                <span aria-hidden="true">✉</span> Daily Email Report
              </button>
            </div>
            <p className="muted">
              Live figures from Google Analytics 4 for frescony.uk.
              {data && (
                <> Reported in {data.timeZone || 'the property time zone'} · fetched {fmtTime(data.fetchedAt)}.</>
              )}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="admin-tabs" style={{ background: 'var(--white)', padding: '2px', border: '1px solid var(--line)' }}>
              {RANGES.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRange(tab.id)}
                  className={range === tab.id ? 'is-active' : ''}
                  style={{ padding: '6px 12px', fontSize: '11px', border: 0 }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="button"
              onClick={handleRefresh}
              disabled={refreshing || report.loading}
              style={{ padding: '8px 14px', fontSize: '11px', background: 'var(--green)', borderColor: 'var(--green)' }}
            >
              {refreshing ? 'REFRESHING…' : 'REFRESH'}
            </button>
          </div>
        </div>
      </header>

      <dialog
        ref={emailDialog}
        className="admin-dialog"
        aria-label="Daily Email Report"
        onClose={() => setEmailOpen(false)}
        onClick={(e) => { if (e.target === emailDialog.current) closeEmailDialog(); }}
      >
        {emailOpen && <AnalyticsEmailSettings onClose={closeEmailDialog} />}
      </dialog>

      {report.error && (
        <div className="admin-alert" role="alert">
          <strong>{report.configured ? 'Google Analytics returned an error.' : 'Google Analytics is not connected.'}</strong>{' '}
          {report.error}
        </div>
      )}
      {!report.loading && noGaData && (
        <div className="admin-alert" role="status">
          Google Analytics has no processed data for {rangeInfo.description}. New visits usually take 24–48 hours to
          appear in these reports; “Active right now” below updates within seconds.
        </div>
      )}
      {data?.thresholded && (
        <div className="admin-alert" role="status">
          Google has withheld some small numbers in this period (data thresholding), so totals may be lower than actual.
        </div>
      )}

      {/* KPI cards — all from GA4 */}
      <div className="admin-card-grid" style={{ marginBottom: '28px' }}>
        <KpiCard
          label="ACTIVE RIGHT NOW"
          value={realtime.loading ? '…' : realtime.data ? fmtInt(realtime.data.activeUsers) : EMPTY}
          note={realtime.error ? realtime.error : 'Users in the last 30 minutes (real time)'}
        />
        <KpiCard label="USERS" value={show((x) => fmtInt(x.activeUsers))} note={`Active users in ${rangeInfo.description}`} />
        <KpiCard label="NEW USERS" value={show((x) => fmtInt(x.newUsers))} note="First-time visitors" />
        <KpiCard label="SESSIONS" value={show((x) => fmtInt(x.sessions))} note="Visits (a session ends after 30 min idle)" />
        <KpiCard label="PAGE VIEWS" value={show((x) => fmtInt(x.pageViews))} note="Pages viewed, including repeats" />
        <KpiCard label="ENGAGEMENT RATE" value={show((x) => fmtPct(x.engagementRate))} note="Sessions over 10s, 2+ pages, or a conversion" />
        <KpiCard label="AVG ENGAGEMENT TIME" value={show((x) => fmtDuration(x.avgEngagementSec))} note="Time the site was in focus, per user" />
        <KpiCard
          label="TOP CHANNEL"
          value={report.loading ? '…' : topChannel ? topChannel.channel : EMPTY}
          note={topChannel ? `${fmtInt(topChannel.sessions)} sessions` : 'No sessions recorded in this period'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginBottom: '28px' }}>
        <Panel title="Top Pages" subtitle="Google Analytics · page views and average engagement time per user">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th style={{ textAlign: 'right' }}>Views</th>
                  <th style={{ textAlign: 'right' }}>Users</th>
                  <th style={{ textAlign: 'right' }}>Avg time</th>
                </tr>
              </thead>
              <tbody>
                {report.loading ? <EmptyRow colSpan="4">Loading…</EmptyRow>
                  : !data ? <EmptyRow colSpan="4">{EMPTY}</EmptyRow>
                  : data.pages.length === 0 ? <EmptyRow colSpan="4">No page views recorded in this period.</EmptyRow>
                  : data.pages.slice(0, 10).map((p) => (
                    <tr key={p.path}>
                      <td style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>{p.path}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtInt(p.pageViews)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(p.users)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtDuration(p.avgEngagementSec)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Traffic Sources" subtitle="Google Analytics · default channel grouping">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th style={{ textAlign: 'right' }}>Sessions</th>
                  <th style={{ textAlign: 'right' }}>Users</th>
                  <th style={{ textAlign: 'right' }}>Engaged</th>
                </tr>
              </thead>
              <tbody>
                {report.loading ? <EmptyRow colSpan="4">Loading…</EmptyRow>
                  : !data ? <EmptyRow colSpan="4">{EMPTY}</EmptyRow>
                  : data.sources.length === 0 ? <EmptyRow colSpan="4">No sessions recorded in this period.</EmptyRow>
                  : data.sources.map((s) => (
                    <tr key={s.channel}>
                      <td style={{ fontWeight: 600 }}>{s.channel}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(s.sessions)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(s.users)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(s.engagementRate)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Visitor Countries" subtitle="Google Analytics · active users by country">
          {report.loading ? (
            <div className="muted" style={{ textAlign: 'center', padding: '24px' }}>Loading…</div>
          ) : !data ? (
            <div className="muted" style={{ textAlign: 'center', padding: '24px' }}>{EMPTY}</div>
          ) : data.countries.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: '24px', fontSize: '13px' }}>No visitors recorded in this period.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {data.countries.slice(0, 10).map((c) => (
                <div key={c.country}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600 }}>{c.country === '(not set)' ? 'Unknown (not set)' : c.country}</span>
                    <span className="muted">{fmtInt(c.users)} users · {fmtInt(c.pageViews)} views</span>
                  </div>
                  <div style={{ height: '4px', background: '#eee9dc', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round((c.users / maxCountryUsers) * 100)}%`, height: '100%', background: 'var(--green)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Day by Day" subtitle="Google Analytics · days with no recorded traffic are omitted by Google">
          <div className="admin-table-wrap" style={{ maxHeight: '360px', overflowY: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Users</th>
                  <th style={{ textAlign: 'right' }}>Sessions</th>
                  <th style={{ textAlign: 'right' }}>Views</th>
                </tr>
              </thead>
              <tbody>
                {report.loading ? <EmptyRow colSpan="4">Loading…</EmptyRow>
                  : !data ? <EmptyRow colSpan="4">{EMPTY}</EmptyRow>
                  : data.dailyTrend.length === 0 ? <EmptyRow colSpan="4">No traffic recorded in this period.</EmptyRow>
                  : [...data.dailyTrend].reverse().map((d) => (
                    <tr key={d.date}>
                      <td>{fmtDay(d.date)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(d.activeUsers)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(d.sessions)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(d.pageViews)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {realtime.data?.pages?.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <Panel title="Being Viewed Right Now" subtitle="Google Analytics real time · last 30 minutes">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Page title</th><th style={{ textAlign: 'right' }}>Users</th></tr></thead>
                <tbody>
                  {realtime.data.pages.map((p) => (
                    <tr key={p.title}>
                      <td>{p.title}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtInt(p.users)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* Our own server log — kept separate from the Google figures above. */}
      <Panel
        title="Recent Visits — Server Log"
        subtitle="Recorded by this website's own server (not Google): IP address, approximate location and device. Bots, staff pages and office-network visits are excluded; entries are deleted after 30 days."
      >
        {visits.error && <div className="admin-alert" role="alert">{visits.error}</div>}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Visitor IP</th>
                <th>Location</th>
                <th>Device / Browser</th>
                <th>Page</th>
                <th>Referrer</th>
                <th style={{ textAlign: 'right' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {visits.loading ? <EmptyRow colSpan="6">Loading…</EmptyRow>
                : visits.rows.length === 0 ? <EmptyRow colSpan="6">{visits.error ? EMPTY : 'No visits recorded yet.'}</EmptyRow>
                : visits.rows.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v.ipAddress}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyIp(v.ipAddress)}
                        title="Copy IP"
                        style={{
                          marginLeft: '6px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '11px',
                          color: copiedIp === v.ipAddress ? 'var(--green)' : 'var(--muted)'
                        }}
                      >
                        {copiedIp === v.ipAddress ? '✓' : '⧉'}
                      </button>
                    </td>
                    <td>{[v.city, v.country].filter(Boolean).join(', ') || 'Unknown'}</td>
                    <td><span style={{ textTransform: 'capitalize' }}>{v.deviceType}</span> · {v.browser} on {v.os}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{v.pageUrl}</span>
                    </td>
                    <td className="muted" style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.referrer || 'Direct'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="muted" title={new Date(v.createdAt).toLocaleString()}>
                      {fmtRelative(v.createdAt)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
