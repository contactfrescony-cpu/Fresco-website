import { useEffect, useState } from 'react';
import { jsonBody, requestJson } from '../requestJson.js';

const API = '/api/admin/enquiries/email-settings';

export default function EnquiryEmailSettings({ onSave }) {
  const [settings, setSettings] = useState(null);
  const [hours, setHours] = useState('4');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    requestJson(API).then((result) => {
      if (!result.ok) { setError(result.error); return; }
      setSettings(result.body.settings);
      setHours(String(result.body.settings.responseHours));
      setEnabled(result.body.settings.alertsEnabled);
    });
  }, []);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    const result = await requestJson(API, jsonBody('PUT', { responseHours: Number(hours), alertsEnabled: enabled }));
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setSettings((current) => ({ ...current, ...result.body.settings }));
    setMessage('Response deadline saved. It applies to all waiting enquiries.');
    onSave();
  }

  return (
    <details className="admin-panel enquiry-email-settings">
      <summary>Email notifications and response deadline</summary>
      <p>New enquiries notify the team and receive an automatic thank-you email.</p>
      {settings && <>
        <p>Team inbox: <strong>{settings.inbox}</strong></p>
        {!settings.smtpConfigured && <p className="admin-alert" role="status">Email sending is not configured. Enquiries and outgoing emails are saved, but notifications, thank-you emails and reminders cannot be delivered until SMTP is configured.</p>}
        <form onSubmit={save}>
          <label className="enquiry-deadline-label">Response deadline (elapsed hours)
            <input type="number" min="0.25" max="720" step="0.01" required value={hours}
              disabled={!settings.canEdit || busy} onChange={(event) => setHours(event.target.value)} />
          </label>
          <label className="enquiry-alert-toggle"><input type="checkbox" checked={enabled} disabled={!settings.canEdit || busy}
            onChange={(event) => setEnabled(event.target.checked)} /> Enable overdue email and red alerts</label>
          <p className="muted">Checks run every minute while the server is running. One overdue email is sent per enquiry. After replying by email, mark it Contacted to clear its alert. Gmail replies are not detected automatically.</p>
          {settings.canEdit ? <button className="button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save deadline'}</button>
            : <p className="muted">An administrator can change these settings.</p>}
        </form>
        {settings.deliveries?.some((item) => Number(item.failed) > 0) && <p className="admin-alert">Some emails could not be delivered. The server retries them every 15 minutes.</p>}
      </>}
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
    </details>
  );
}
