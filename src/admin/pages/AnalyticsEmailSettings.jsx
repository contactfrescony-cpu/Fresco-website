import { useEffect, useState } from 'react';
import { jsonBody, requestJson } from '../requestJson.js';

const API = '/api/admin/analytics/email';

const inputStyle = {
  border: '1px solid var(--line)', background: '#fff', padding: '9px 10px', fontSize: '14px', width: '100%',
  fontFamily: 'inherit', boxSizing: 'border-box'
};
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, margin: '0 0 6px' };

function fmtDay(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function fmtDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Normalises the textarea into a comparable list (same rules as the server). */
const toList = (text) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];

export default function AnalyticsEmailSettings({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ enabled: false, recipients: '', sendTime: '09:00' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success' | 'error', text }

  function applySettings(data) {
    setSettings(data);
    setForm({ enabled: data.enabled, recipients: data.recipients.join('\n'), sendTime: data.sendTime });
  }

  useEffect(() => {
    requestJson(API).then((res) => (res.ok ? applySettings(res.body.data) : setLoadError(res.error)));
  }, []);

  const dirty = settings && (
    form.enabled !== settings.enabled ||
    form.sendTime !== settings.sendTime ||
    toList(form.recipients).join(',') !== settings.recipients.join(',')
  );

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await requestJson(API, jsonBody('PUT', {
      enabled: form.enabled, recipients: toList(form.recipients), sendTime: form.sendTime
    }));
    setSaving(false);
    if (!res.ok) return setMessage({ type: 'error', text: res.error });
    applySettings(res.body.data);
    setMessage({ type: 'success', text: 'Saved.' });
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    const res = await requestJson(`${API}/test`, jsonBody('POST'));
    setTesting(false);
    if (!res.ok) return setMessage({ type: 'error', text: res.error });
    const { sentTo, gaError } = res.body.data;
    setMessage({
      type: gaError ? 'error' : 'success',
      text: `Test email sent to ${sentTo.join(', ')}.${gaError ? ` It contains no figures because ${gaError}` : ''}`
    });
  }

  if (loadError) {
    return (
      <div className="admin-panel" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '18px', color: 'var(--green)' }}>Daily Email Report</h3>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="admin-dialog-close">×</button>
        )}
        </div>
        <div className="admin-alert" role="alert">{loadError}</div>
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="admin-panel muted" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between' }}>
        Loading email settings…
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="admin-dialog-close">×</button>
        )}
      </div>
    );
  }

  const readOnly = !settings.canEdit;
  const tz = settings.timeZoneLabel;
  const next = settings.next;

  return (
    <div className="admin-panel" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <div className="eyebrow">ANALYTICS</div>
          <h3 style={{ margin: '6px 0 4px', fontSize: '24px', color: 'var(--green)', fontFamily: 'var(--serif)', fontWeight: 400 }}>Daily Email Report</h3>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="admin-dialog-close">×</button>
        )}
      </div>
      <p className="muted" style={{ margin: '0 0 16px', fontSize: '12px' }}>
        Emails yesterday’s Google Analytics figures to the addresses below, once a day at the chosen time ({tz}).
        {readOnly && ' Only administrators can change these settings.'}
      </p>

      {!settings.smtpConfigured && (
        <div className="admin-alert" role="alert">
          Email sending is not set up on the server yet (SMTP settings in .env), so no emails can go out.
        </div>
      )}
      {settings.gaProblem && (
        <div className="admin-alert" role="alert">Google Analytics is not connected: {settings.gaProblem}</div>
      )}
      {message && (
        <div className={message.type === 'success' ? 'admin-success' : 'admin-alert'} role={message.type === 'success' ? 'status' : 'alert'}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '18px', alignItems: 'start' }}>
          <div>
            <label style={labelStyle} htmlFor="report-recipients">Send to (one email per line, up to 10)</label>
            <textarea
              id="report-recipients"
              rows={4}
              value={form.recipients}
              onChange={(e) => setForm({ ...form, recipients: e.target.value })}
              disabled={readOnly}
              placeholder="name@example.com"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="report-time">Send time ({tz})</label>
            <input
              id="report-time"
              type="time"
              value={form.sendTime}
              onChange={(e) => setForm({ ...form, sendTime: e.target.value })}
              disabled={readOnly}
              required
              style={{ ...inputStyle, maxWidth: '160px' }}
            />
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', marginTop: '14px', cursor: readOnly ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                disabled={readOnly}
              />
              Send the daily email
            </label>
          </div>

          <div style={{ fontSize: '13px', lineHeight: 1.7 }}>
            <div>
              <strong>Next email: </strong>
              {!next ? <span className="muted">not scheduled</span>
                : next.due ? <span>due now (sending within a minute)</span>
                : next.retryAt ? <span>retrying at {new Date(next.retryAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                : <span>{fmtDay(next.date)}, {next.time} {tz}</span>}
            </div>
            <div>
              <strong>Last sent: </strong>
              <span className="muted">{fmtDateTime(settings.lastSentAt) || 'never'}</span>
            </div>
            {settings.lastError && (
              <div style={{ color: '#8e1d22' }}><strong>Problem: </strong>{settings.lastError}</div>
            )}
          </div>
        </div>

        {!readOnly && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '18px', alignItems: 'center' }}>
            <button
              type="submit"
              className="button"
              disabled={saving || !dirty}
              style={{ padding: '8px 16px', fontSize: '11px', background: 'var(--green)', borderColor: 'var(--green)' }}
            >
              {saving ? 'SAVING…' : 'SAVE'}
            </button>
            <button
              type="button"
              className="button"
              onClick={handleTest}
              disabled={testing || dirty || settings.recipients.length === 0 || !settings.smtpConfigured}
              title={dirty ? 'Save your changes first' : undefined}
              style={{ padding: '8px 16px', fontSize: '11px' }}
            >
              {testing ? 'SENDING…' : 'SEND TEST EMAIL NOW'}
            </button>
            {dirty && <span className="muted" style={{ fontSize: '12px' }}>Unsaved changes</span>}
          </div>
        )}
      </form>
    </div>
  );
}
