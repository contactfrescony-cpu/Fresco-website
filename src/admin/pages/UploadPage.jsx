import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

// Must match the server (server/uploads.js): accepted types and the per-photo size limit.
const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif';
const EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 50;
const PREVIEWABLE = ['image/jpeg', 'image/png', 'image/webp'];

const ERRORS = {
  drive_not_configured: 'Google Drive is not connected yet. Ask an administrator.',
  unsupported_type: 'Not a JPG, PNG, WebP or HEIC photo.',
  too_large: 'Larger than 25 MB.',
  empty_file: 'The file is empty.',
  rate_limited: 'Upload limit reached. Please try again in an hour.',
  unauthenticated: 'Your session has ended. Please sign in again.',
  forbidden: 'Your role cannot upload photos.',
  drive_exists: 'A photo with this name is already in Drive.',
  network: 'Connection problem. Please try again.'
};
const errorText = (code) => ERRORS[code] || (code?.startsWith('drive_')
  ? 'Google Drive did not accept the photo. Please try again.'
  : 'Upload failed. Please try again.');

// Problems with the file itself: retrying the same file cannot help.
const PERMANENT = ['unsupported_type', 'too_large', 'empty_file', 'drive_exists'];

// Live pipeline stage of an upload (worked out by the server from Google Drive).
const STAGES = {
  waiting: { label: 'Unprocessed', badge: 'is-pending' },
  processed: { label: 'Processed', badge: 'is-active' },
  failed: { label: 'Failed', badge: 'is-disabled' },
  upload_failed: { label: 'Not sent', badge: 'is-disabled' }
};
const HISTORY_FILTERS = [
  ['all', 'All', () => true],
  ['waiting', 'Unprocessed', (row) => row.stage === 'waiting'],
  ['processed', 'Processed', (row) => row.stage === 'processed'],
  ['failed', 'Failed', (row) => row.stage === 'failed' || row.stage === 'upload_failed']
];
const REFRESH_MS = 60 * 1000;
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const STATUS_LABELS = { waiting: 'Ready', uploading: 'Uploading…', done: 'In Drive', failed: 'Failed' };
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const formatDate = (value) => dateTimeFormat.format(new Date(value));

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Checks a file in the browser first, so obvious problems show before anything is sent. */
function precheck(file) {
  if (!EXTENSIONS.test(file.name)) return 'unsupported_type';
  if (file.size === 0) return 'empty_file';
  if (file.size > MAX_BYTES) return 'too_large';
  return null;
}

let nextKey = 1;

export default function UploadPage() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [items, setItems] = useState([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [statusInfo, setStatusInfo] = useState({ fromDrive: true, checkedAt: null });
  const [historyFilter, setHistoryFilter] = useState('all');
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [checking, setChecking] = useState(false);
  const loadHistory = useCallback(async (quick = false) => {
    if (!quick) setChecking(true);
    try {
      const response = await fetch(`/api/admin/uploads${quick ? '?quick=1' : ''}`, { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      setConfigured(data.configured);
      setHistory(data.uploads);
      if (data.live) setStatusInfo({ fromDrive: data.statusFromDrive !== false, checkedAt: data.checkedAt || null });
    } catch { /* the list is optional; uploading still works */ } finally {
      if (!quick) setChecking(false);
    }
  }, []);

  // Live status: refresh every minute while the page is visible, and when the tab comes back.
  useEffect(() => {
    loadHistory(true).then(() => loadHistory());   // show the list at once, then ask Drive
    const timer = setInterval(() => { if (!document.hidden) loadHistory(); }, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) loadHistory(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadHistory]);

  // Free the thumbnail previews when leaving the page.
  useEffect(() => () => itemsRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)), []);

  // Warn before closing the tab in the middle of an upload.
  useEffect(() => {
    if (!running) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const addFiles = (fileList) => {
    setNotice('');
    const files = Array.from(fileList || []);
    const room = MAX_FILES - itemsRef.current.filter((item) => item.status !== 'done').length;
    if (files.length > room) setNotice(`You can add up to ${MAX_FILES} photos at a time; ${files.length - Math.max(room, 0)} were left out.`);
    const added = files.slice(0, Math.max(room, 0)).map((file) => {
      const problem = precheck(file);
      return {
        key: nextKey++,
        file,
        preview: PREVIEWABLE.includes(file.type) && !problem ? URL.createObjectURL(file) : null,
        status: problem ? 'failed' : 'waiting',
        code: problem,
        error: problem ? errorText(problem) : ''
      };
    });
    setItems((current) => [...current, ...added]);
  };

  const removeItem = (key) => setItems((current) => current.filter((item) => {
    if (item.key === key && item.preview) URL.revokeObjectURL(item.preview);
    return item.key !== key;
  }));

  const setItem = (key, change) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const uploadAll = async () => {
    const queue = itemsRef.current.filter((item) => item.status === 'waiting');
    if (!queue.length || running) return;
    setRunning(true);
    setNotice('');
    let sent = 0;
    // One photo at a time: a failure only affects that photo, and the rest carry on.
    for (const item of queue) {
      setItem(item.key, { status: 'uploading', code: null, error: '' });
      let code = null;
      try {
        const response = await fetch('/api/admin/uploads', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(item.file.name) },
          body: item.file
        });
        if (!response.ok) code = (await response.json().catch(() => ({}))).error || (response.status === 413 ? 'too_large' : 'failed');
      } catch {
        code = 'network';
      }
      if (code) {
        setItem(item.key, { status: 'failed', code, error: errorText(code) });
        // No point continuing if the session ended or Drive is not connected.
        if (['unauthenticated', 'drive_not_configured', 'rate_limited', 'forbidden'].includes(code)) {
          setNotice(errorText(code));
          break;
        }
      } else {
        sent += 1;
        setItem(item.key, { status: 'done' });
      }
    }
    setRunning(false);
    if (sent) setNotice(`${sent} photo${sent === 1 ? '' : 's'} sent to Google Drive. The pipeline will process ${sent === 1 ? 'it' : 'them'} on its next run.`);
    loadHistory();
  };

  const retryFailed = () => setItems((current) => current.map((item) => (
    item.status === 'failed' && !PERMANENT.includes(item.code) ? { ...item, status: 'waiting', code: null, error: '' } : item
  )));
  const clearFinished = () => setItems((current) => current.filter((item) => {
    const keep = item.status === 'waiting' || item.status === 'uploading';
    if (!keep && item.preview) URL.revokeObjectURL(item.preview);
    return keep;
  }));

  const waiting = items.filter((item) => item.status === 'waiting').length;
  const retryable = items.filter((item) => item.status === 'failed' && !PERMANENT.includes(item.code)).length;
  const finished = items.filter((item) => item.status === 'done' || item.status === 'failed').length;

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!running && configured) addFiles(event.dataTransfer.files);
  };

  return (
    <>
      <header className="admin-page-head">
        <div className="eyebrow">UPLOAD PHOTOS</div>
        <h1>Upload garment photos</h1>
        <p className="muted">Photos go straight to the Fresco NY Google Drive. The image pipeline works out each garment&apos;s category and turns it into a website product image, so you don&apos;t need to sort them.</p>
      </header>

      {!configured && (
        <p className="admin-alert" role="alert">The Google Drive connection is not set up yet, so photos cannot be sent. Ask an administrator.</p>
      )}

      <label
        className={`upload-drop${dragging ? ' is-dragging' : ''}${!configured || running ? ' is-disabled' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file" multiple accept={ACCEPT} disabled={!configured || running}
          onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
        />
        <span className="upload-drop-title">Drag photos here, or <u>choose photos</u></span>
        <span className="upload-drop-note">JPG, PNG, WebP or HEIC · up to 25 MB each · up to {MAX_FILES} at a time</span>
      </label>

      <ul className="upload-tips">
        <li>One garment per photo, with the whole garment in view.</li>
        <li>Good, even light; the true colour matters more than the background.</li>
        <li>Make sure prints, logos, buttons and zips are clearly visible.</li>
      </ul>

      {notice && <p className="admin-success" role="status">{notice}</p>}

      {items.length > 0 && (
        <section className="admin-panel upload-queue" aria-label="Photos to upload">
          <ul>
            {items.map((item) => (
              <li key={item.key} className={`upload-item is-${item.status}`}>
                <div className="upload-thumb">
                  {item.preview ? <img src={item.preview} alt="" onError={() => setItem(item.key, { preview: null })} /> : <span>{item.file.name.split('.').pop().toUpperCase()}</span>}
                </div>
                <div className="upload-info">
                  <strong title={item.file.name}>{item.file.name}</strong>
                  <span className="muted">{formatSize(item.file.size)}{item.error ? ` · ${item.error}` : ''}</span>
                </div>
                <span className={`admin-status is-${item.status === 'done' ? 'active' : item.status === 'failed' ? 'disabled' : 'pending'}`}>
                  {STATUS_LABELS[item.status]}
                </span>
                {item.status !== 'uploading' && !running && (
                  <button type="button" className="admin-link-button" onClick={() => removeItem(item.key)} aria-label={`Remove ${item.file.name}`}>Remove</button>
                )}
              </li>
            ))}
          </ul>
          <div className="upload-actions">
            {(waiting > 0 || running) && (
              <button type="button" className="button" onClick={uploadAll} disabled={running || !configured}>
                {running ? 'Uploading…' : `Upload ${waiting} photo${waiting === 1 ? '' : 's'}`}
              </button>
            )}
            {retryable > 0 && !running && <button type="button" className="admin-link-button" onClick={retryFailed}>Retry failed ({retryable})</button>}
            {finished > 0 && !running && <button type="button" className="admin-link-button" onClick={clearFinished}>Clear finished</button>}
          </div>
        </section>
      )}

      <section className="upload-history">
        <div className="upload-history-head">
          <h2>{isAdmin ? 'Recent uploads (everyone)' : 'Your recent uploads'}</h2>
          {history && history.length > 0 && (
            <span className="muted upload-live" aria-live="polite">
              <span className={`upload-live-dot${checking ? ' is-checking' : ''}`} aria-hidden="true" />
              {checking ? 'Checking Google Drive…' : statusInfo.checkedAt ? `Live status · updated ${clock.format(new Date(statusInfo.checkedAt))}` : 'Live status'}
              <button type="button" className="admin-link-button" onClick={() => loadHistory()} disabled={checking}>Refresh</button>
            </span>
          )}
        </div>
        {history && history.length > 0 && (
          <div className="review-filter upload-filter" role="group" aria-label="Show uploads">
            {HISTORY_FILTERS.map(([key, label, test]) => (
              <button type="button" key={key} className={historyFilter === key ? 'is-active' : undefined} aria-pressed={historyFilter === key} onClick={() => setHistoryFilter(key)}>
                {label} <span>{history.filter(test).length}</span>
              </button>
            ))}
          </div>
        )}
        {!statusInfo.fromDrive && configured && (
          <p className="upload-note">Google Drive could not be asked just now, or its script is older than version 5, so "Failed" cannot be shown yet. Photos still waiting are listed as Unprocessed.</p>
        )}
        {history === null ? (
          <p className="muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="muted">Nothing uploaded yet.</p>
        ) : (() => {
          const [, , test] = HISTORY_FILTERS.find(([key]) => key === historyFilter);
          const rows = history.filter(test);
          if (!rows.length) return <p className="muted">No uploads in this list.</p>;
          return (
            <div className="admin-table-wrap">
              <table className="admin-table upload-table">
                <thead>
                  <tr><th>Sent</th><th>Photo</th>{isAdmin && <th>Uploaded by</th>}<th>Size</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const stage = STAGES[row.stage] || STAGES.waiting;
                    return (
                      <tr key={row.id}>
                        <td data-label="Sent">{formatDate(row.created_at)}</td>
                        <td data-label="Photo"><div className="upload-name">{row.original_name}</div><div className="muted upload-name">{row.drive_name}</div></td>
                        {isAdmin && <td data-label="Uploaded by">{row.uploaded_by || '—'}</td>}
                        <td data-label="Size">{formatSize(row.size_bytes)}</td>
                        <td data-label="Status">
                          <div className="upload-stage">
                            <span className={`admin-status ${stage.badge}`}>{stage.label}</span>
                            <span className="muted">{row.detail}{row.aiCategory && row.stage === 'processed' && !/website/.test(row.detail) ? ` · AI: ${row.aiCategory}` : ''}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </section>
    </>
  );
}
