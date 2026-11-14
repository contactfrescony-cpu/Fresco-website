import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { jsonBody, requestJson } from '../requestJson.js';
import EnquiryEmailSettings from './EnquiryEmailSettings.jsx';

// Customer enquiries from the Contact page. Saved in the database (this page), emailed to the inbox,
// and copied to the Google Sheet. Staff follow them up here: status, who handles it, internal notes.

const STATUS_TABS = [
  { key: 'new', label: 'New' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'closed', label: 'Closed' },
  { key: 'spam', label: 'Spam' },
  { key: 'all', label: 'All' }
];
const STATUS_LABELS = { new: 'New', contacted: 'Contacted', closed: 'Closed', spam: 'Spam' };
const STATUS_OPTIONS = ['new', 'contacted', 'closed', 'spam'];
const EMAIL_LABELS = { sent: 'Email sent', failed: 'Email failed', pending: 'Email sending…', off: 'Email not set up' };

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (value) => (value ? dateTimeFormat.format(new Date(value)) : '—');
const waitingHours = (enquiry) => Math.floor(Math.max(0, Date.now() - new Date(enquiry.createdAt).getTime()) / 360000) / 10;
const isOverdue = (enquiry, settings) => settings?.alertsEnabled && enquiry.status === 'new'
  && Date.now() - new Date(enquiry.createdAt).getTime() >= settings.responseHours * 3600000;
const THANKYOU_LABELS = { sent: 'Thank-you email sent', failed: 'Thank-you email failed (will retry)', pending: 'Thank-you email queued', unavailable: 'No thank-you email recorded' };

/** Full enquiry with follow-up controls, shown in a modal dialog. */
function EnquiryDetail({ enquiry, staff, busy, onChange, onClose, emailSettings }) {
  const [notes, setNotes] = useState(enquiry.notes);
  useEffect(() => { setNotes(enquiry.notes); }, [enquiry.id, enquiry.notes]);
  const notesDirty = notes.trim() !== enquiry.notes.trim();
  const replySubject = encodeURIComponent(`Re: your enquiry to Fresco NY — ${enquiry.purpose}`);

  return (
    <div className="admin-panel enquiry-detail">
      <div className="enquiry-detail-head">
        <div>
          <div className="eyebrow">ENQUIRY #{enquiry.id}</div>
          <h2>{enquiry.company}</h2>
          <p className="muted">Received {fmtDateTime(enquiry.createdAt)}{enquiry.country && ` · ${enquiry.country}`}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="admin-dialog-close">×</button>
      </div>

      {isOverdue(enquiry, emailSettings) && <p className="enquiry-overdue-alert" role="alert">This enquiry has been waiting for {waitingHours(enquiry)} hours. Please reply ASAP.</p>}
      <dl className="enquiry-facts">
        <div><dt>Email</dt><dd><a href={`mailto:${enquiry.email}?subject=${replySubject}`}>{enquiry.email}</a></dd></div>
        <div><dt>Phone</dt><dd><a href={`tel:${enquiry.phone.replace(/[^\d+]/g, '')}`}>{enquiry.phone}</a></dd></div>
        <div><dt>Purpose</dt><dd>{enquiry.purpose}</dd></div>
        <div>
          <dt>Delivery</dt>
          <dd className="muted">
            {EMAIL_LABELS[enquiry.emailStatus] || enquiry.emailStatus}
            {' · '}{THANKYOU_LABELS[enquiry.thankyouStatus]}
            {' · '}
            {enquiry.inSheet ? 'In Google Sheet' : enquiry.sheetError ? 'Not in Google Sheet yet (will retry)' : 'Google Sheet pending'}
          </dd>
        </div>
      </dl>

      <h3 className="enquiry-label">Message</h3>
      <div className="enquiry-message">{enquiry.message || <span className="muted">(no message)</span>}</div>

      <div className="enquiry-controls">
        <label>
          <span>Status</span>
          <select value={enquiry.status} disabled={busy} onChange={(e) => onChange({ status: e.target.value })}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label>
          <span>Assigned to</span>
          <select
            value={enquiry.assignedTo ?? ''}
            disabled={busy}
            onChange={(e) => onChange({ assignedTo: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— Nobody —</option>
            {enquiry.assignedTo && !staff.some((p) => p.id === enquiry.assignedTo) && (
              <option value={enquiry.assignedTo}>{enquiry.assignedName || 'Former staff member'}</option>
            )}
            {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
      </div>

      <label className="enquiry-notes">
        <span>Internal notes</span>
        <textarea
          value={notes}
          maxLength={5000}
          rows={4}
          placeholder="Calls, quotes sent, next steps… (staff only — never sent to the customer)"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="enquiry-actions">
        <button type="button" className="button" disabled={busy || !notesDirty} onClick={() => onChange({ notes })}>
          {busy ? 'Saving…' : 'Save notes'}
        </button>
        <a className="button light" href={`mailto:${enquiry.email}?subject=${replySubject}`}>Reply by email</a>
        {enquiry.status === 'new' && (
          <button type="button" className="admin-link-button" disabled={busy} onClick={() => onChange({ status: 'contacted' })}>
            Mark as contacted
          </button>
        )}
      </div>
    </div>
  );
}

export default function EnquiriesPage() {
  const [params, setParams] = useSearchParams();
  const status = STATUS_TABS.some((t) => t.key === params.get('status')) ? params.get('status') : 'all';
  const query = params.get('q') || '';
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);
  const onlyId = /^\d+$/.test(params.get('id') || '') ? params.get('id') : '';

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState(query);
  const [open, setOpen] = useState(null);   // the enquiry shown in the dialog
  const [busyId, setBusyId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const dialog = useRef(null);

  const updateParams = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value == null || (key === 'status' && value === 'all') || (key === 'page' && value === 1)) next.delete(key);
      else next.set(key, String(value));
    }
    setParams(next, { replace: true });
  };

  const listQuery = () => {
    const qs = new URLSearchParams();
    if (onlyId) qs.set('id', onlyId);
    else {
      if (status !== 'all') qs.set('status', status);
      if (query) qs.set('q', query);
    }
    return qs;
  };

  const load = useCallback(async () => {
    const qs = listQuery();
    if (!onlyId && page > 1) qs.set('page', String(page));
    const result = await requestJson(`/api/admin/enquiries?${qs}`);
    if (!result.ok) { setError(result.error); return; }
    setError('');
    setData(result.body);
    // A link from the "New enquiry" email (?id=12) opens that enquiry straight away.
    if (onlyId && result.body.enquiries[0]) setOpen(result.body.enquiries[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query, page, onlyId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  // Search as you type, after a short pause.
  useEffect(() => {
    if (search.trim() === query) return undefined;
    const timer = setTimeout(() => updateParams({ q: search.trim(), page: 1, id: '' }), 350);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openId = open?.id ?? null;
  useEffect(() => {
    if (openId && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!openId && dialog.current?.open) dialog.current.close();
  }, [openId]);

  const change = async (enquiry, patch) => {
    setBusyId(enquiry.id);
    setNotice('');
    const result = await requestJson(`/api/admin/enquiries/${enquiry.id}`, jsonBody('PATCH', patch));
    setBusyId(null);
    if (!result.ok) { setError(result.error); return; }
    setError('');
    const updated = result.body.enquiry;
    setData((current) => current && ({ ...current, enquiries: current.enquiries.map((e) => (e.id === updated.id ? updated : e)) }));
    setOpen((current) => (current?.id === updated.id ? updated : current));
    if (patch.notes !== undefined) setNotice(`Notes saved for enquiry #${updated.id}.`);
    // Status counts (and the list, if the enquiry left this tab) refresh in the background.
    load();
  };

  const syncSheet = async () => {
    setSyncing(true);
    setNotice('');
    const result = await requestJson('/api/admin/enquiries/sync-sheet', jsonBody('POST'));
    setSyncing(false);
    if (!result.ok) { setError(result.error); load(); return; }
    setError('');
    setNotice(result.body.synced ? `Sent ${result.body.synced} enquiries to the Google Sheet.` : 'The Google Sheet is already up to date.');
    load();
  };

  const enquiries = data?.enquiries || [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const exportQuery = listQuery().toString();

  return (
    <>
      <header className="admin-page-head">
        <div className="eyebrow">ENQUIRIES</div>
        <h1>Enquiries</h1>
        <p className="muted">Enquiries saved from the Contact page. Email notifications and Google Sheet copies are sent when those services are configured.</p>
      </header>
      <EnquiryEmailSettings onSave={load} />

      {data && (
        <div className={`enquiry-sheet-bar${data.sheet.configured && !data.sheet.lastError ? '' : ' is-warning'}`}>
          {!data.sheet.configured ? (
            <span>Google Sheet not connected: enquiries are saved here, but not copied to a Sheet yet.</span>
          ) : (
            <>
              <span>
                Google Sheet: {data.sheet.pending ? `${data.sheet.pending} enquiries waiting to be copied` : 'up to date'}
                {data.sheet.pending > 0 && data.sheet.lastError && <span className="muted"> — last error: {data.sheet.lastError}</span>}
              </span>
              <button type="button" className="admin-link-button" disabled={syncing} onClick={syncSheet}>
                {syncing ? 'Syncing…' : 'Sync to Sheet now'}
              </button>
            </>
          )}
        </div>
      )}

      <div className="admin-toolbar enquiry-toolbar">
        <div className="admin-tabs" role="group" aria-label="Filter enquiries by status">
          {STATUS_TABS.map((tab) => {
            const count = data?.counts?.[tab.key];
            const active = !onlyId && status === tab.key;
            return (
              <button key={tab.key} type="button" className={active ? 'is-active' : ''} aria-pressed={active}
                onClick={() => updateParams({ status: tab.key, page: 1, id: '' })}>
                {tab.label} {count > 0 && <span className={tab.key === 'new' || tab.key === 'overdue' ? 'is-alert' : undefined}>{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="enquiry-tools">
          <input type="search" value={search} placeholder="Search company, email, phone, message…" aria-label="Search enquiries"
            onChange={(e) => setSearch(e.target.value)} />
          <a className="button light" href={`/api/admin/enquiries/export.csv${exportQuery ? `?${exportQuery}` : ''}`}>Export CSV</a>
        </div>
      </div>

      {onlyId && (
        <p className="upload-note">
          Showing enquiry #{onlyId} only. <button type="button" className="admin-link-button" onClick={() => { setOpen(null); updateParams({ id: '' }); }}>Show all enquiries</button>
        </p>
      )}
      {notice && <p className="admin-success" role="status">{notice}</p>}
      {error && <p className="admin-alert" role="alert">{error}</p>}

      {!data && !error && <div className="admin-panel">Loading enquiries…</div>}
      {data && enquiries.length === 0 && (
        <div className="admin-panel admin-placeholder">
          {onlyId ? 'This enquiry was not found.' : query ? 'No enquiries match your search.' : status === 'all' ? 'No enquiries yet.' : status === 'overdue' ? 'No overdue enquiries.' : `No ${STATUS_LABELS[status].toLowerCase()} enquiries.`}
        </div>
      )}

      {enquiries.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table enquiry-table">
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Company</th>
                <th scope="col">Contact</th>
                <th scope="col">Purpose</th>
                <th scope="col">Status</th>
                <th scope="col">Assigned to</th>
                <th scope="col" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {enquiries.map((enquiry) => (
                <tr key={enquiry.id} className={isOverdue(enquiry, data.emailSettings) ? 'is-overdue' : enquiry.status === 'new' ? 'is-pending' : undefined}>
                  <td data-label="Received">
                    <div>{fmtDateTime(enquiry.createdAt)}</div>
                    <div className="muted">#{enquiry.id}{enquiry.country && ` · ${enquiry.country}`}</div>
                  </td>
                  <td data-label="Company">
                    <strong>{enquiry.company}</strong>
                    {isOverdue(enquiry, data.emailSettings) && <div className="enquiry-overdue-text">Waiting {waitingHours(enquiry)} hours — reply ASAP</div>}
                    {enquiry.message && <div className="muted enquiry-snippet">{enquiry.message}</div>}
                  </td>
                  <td data-label="Contact">
                    <div><a href={`mailto:${enquiry.email}`}>{enquiry.email}</a></div>
                    <div className="muted">{enquiry.phone}</div>
                  </td>
                  <td data-label="Purpose">{enquiry.purpose}</td>
                  <td data-label="Status">
                    <select aria-label={`Status of enquiry #${enquiry.id}`} value={enquiry.status} disabled={busyId === enquiry.id}
                      className={`enquiry-select is-${enquiry.status}`} onChange={(e) => change(enquiry, { status: e.target.value })}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <td data-label="Assigned to">{enquiry.assignedName || <span className="muted">—</span>}</td>
                  <td data-label="">
                    <button type="button" className="admin-link-button" onClick={() => setOpen(enquiry)} aria-haspopup="dialog">
                      Open
                    </button>
                    {enquiry.emailStatus === 'failed' && <div><span className="admin-status is-disabled" title="The notification email could not be sent">Email failed</span></div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && !onlyId && pages > 1 && (
        <nav className="enquiry-pager" aria-label="Pages">
          <button type="button" className="admin-link-button" disabled={page <= 1} onClick={() => updateParams({ page: page - 1 })}>← Newer</button>
          <span className="muted">Page {page} of {pages} · {data.total} enquiries</span>
          <button type="button" className="admin-link-button" disabled={page >= pages} onClick={() => updateParams({ page: page + 1 })}>Older →</button>
        </nav>
      )}

      <dialog ref={dialog} className="admin-dialog" aria-label="Enquiry details" onClose={() => setOpen(null)}
        onClick={(e) => { if (e.target === dialog.current) setOpen(null); }}>
        {open && (
          <EnquiryDetail enquiry={open} staff={data?.staff || []} busy={busyId === open.id}
            emailSettings={data?.emailSettings}
            onChange={(patch) => change(open, patch)} onClose={() => setOpen(null)} />
        )}
      </dialog>
    </>
  );
}
