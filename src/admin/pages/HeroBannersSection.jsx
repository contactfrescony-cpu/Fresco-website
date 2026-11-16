import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareWebsiteImage, WEBSITE_IMAGE_ACCEPT } from './DevelopmentImagesSection.jsx';
import '../hero-banners.css';

const displayTime = (value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const nextAnchor = ({ every, unit, time, weekday }) => {
  const now = new Date();
  if (unit === 'minutes') return new Date(now.getTime() + every * 60_000);
  if (unit === 'hours') return new Date(now.getTime() + every * 3_600_000);
  const [hour, minute] = (time || '00:00').split(':').map(Number);
  const next = new Date(now); next.setHours(hour, minute, 0, 0);
  if (unit === 'days') {
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  const delta = (Number(weekday) - now.getDay() + 7) % 7;
  next.setDate(next.getDate() + delta);
  if (next <= now) next.setDate(next.getDate() + 7);
  return next;
};

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error === 'drive_unknown_action'
    ? 'Deploy the latest google/drive-upload.gs as a new Apps Script version.'
    : 'The banner change could not be saved. Please try again.');
  return data;
}

export default function HeroBannersSection() {
  const [data, setData] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [schedule, setSchedule] = useState({ every: 1, unit: 'weeks', time: '10:00', weekday: 1 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const input = useRef(null);

  const load = useCallback(() => request('/api/admin/hero-banners').then((result) => {
    setData(result);
    if (result.schedule) setSchedule((current) => ({ ...current, ...result.schedule }));
  }).catch((error) => setMessage(error.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choose = (selected) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(selected ? URL.createObjectURL(selected) : '');
    setMessage('');
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true); setMessage('');
    try {
      const blob = await prepareWebsiteImage(file, 2400);
      await request('/api/admin/hero-banners', {
        method: 'POST', body: blob,
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }
      });
      choose(null);
      setMessage('Banner uploaded to the Google Drive rotation library.');
      await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  const saveSchedule = async () => {
    setBusy(true); setMessage('');
    try {
      const anchor = nextAnchor(schedule);
      await request('/api/admin/hero-banners/schedule', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...schedule, every: Number(schedule.every), anchor: anchor.toISOString() })
      });
      setMessage(`Rotation schedule saved. The next change is ${displayTime(anchor)}.`); await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  const remove = async (image) => {
    if (!window.confirm(`Remove ${image.name} from the banner schedule and move it to Drive Trash?`)) return;
    setBusy(true); setMessage('');
    try {
      await request(`/api/admin/hero-banners/${encodeURIComponent(image.id)}`, { method: 'DELETE' });
      setMessage('Banner moved to Google Drive Trash.'); await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  return (
    <section className="hero-banners" aria-labelledby="hero-banners-title">
      <div className="dev-images-intro">
        <div className="eyebrow">HOMEPAGE</div>
        <h2 id="hero-banners-title">Front banner schedule</h2>
        <p className="muted">Upload any number of banners to Google Drive, then choose one recurring rotation schedule. The homepage cycles through the Drive images in upload order.</p>
      </div>
      {message && <p className="dev-images-notice" role="status">{message}</p>}
      {data && !data.configured && <p className="admin-alert">Google Drive is not connected.</p>}

      <section className="admin-panel hero-upload">
        <div className="hero-upload-preview">
          {preview ? <img src={preview} alt="Selected banner preview" /> : <button type="button" onClick={() => input.current?.click()} disabled={busy}>+ Choose banner</button>}
        </div>
        <div className="hero-upload-form">
          <p><strong>Perfect size: 1600 × 2400 px</strong> (2:3 portrait).</p>
          <p className="muted">Keep faces and important details near the centre. This preview uses the same portrait crop as the homepage banner.</p>
          <button type="button" className="admin-link-button" onClick={() => input.current?.click()} disabled={busy}>{file ? 'Choose another image' : 'Choose image'}</button>
          <input ref={input} type="file" accept={WEBSITE_IMAGE_ACCEPT} hidden onChange={(event) => { choose(event.target.files?.[0] || null); event.target.value = ''; }} />
          <button type="button" className="button" onClick={upload} disabled={!file || busy}>{busy ? 'Uploading…' : 'Upload to banner library'}</button>
        </div>
      </section>

      <section className="admin-panel hero-schedule">
        <div><strong>Rotation schedule</strong><p className="muted">Cron-style recurring timing. No individual dates are needed.</p></div>
        <label>Every<input type="number" min="1" max="999" value={schedule.every} onChange={(event) => setSchedule({ ...schedule, every: event.target.value })} /></label>
        <label>Period<select value={schedule.unit} onChange={(event) => setSchedule({ ...schedule, unit: event.target.value })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></label>
        {schedule.unit === 'weeks' && <label>On<select value={schedule.weekday} onChange={(event) => setSchedule({ ...schedule, weekday: Number(event.target.value) })}><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select></label>}
        {['days', 'weeks'].includes(schedule.unit) && <label>At<input type="time" value={schedule.time} onChange={(event) => setSchedule({ ...schedule, time: event.target.value })} /></label>}
        <button type="button" className="button" disabled={busy} onClick={saveSchedule}>Save rotation</button>
      </section>

      {!data ? <p className="muted">Loading banners…</p> : (
        <div className="hero-banner-grid">
          {data.images.map((image) => (
            <article className={`admin-panel hero-banner-card${image.id === data.activeId ? ' is-active' : ''}`} key={image.id}>
              <img src={image.url} alt="" />
              <div className="hero-banner-card-body">
                <strong>{image.id === data.activeId ? 'Live now' : 'In rotation'}</strong>
                <span className="muted">Uploaded {displayTime(image.created)}</span>
                <div className="hero-banner-actions">
                  <a className="admin-link-button" href={`/?heroPreview=${encodeURIComponent(image.url)}`} target="_blank" rel="noopener noreferrer">Preview on homepage ↗</a>
                  <button type="button" className="admin-link-button is-danger" disabled={busy} onClick={() => remove(image)}>Remove</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
