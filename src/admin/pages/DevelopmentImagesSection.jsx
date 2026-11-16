import { useCallback, useEffect, useRef, useState } from 'react';
import '../development-images.css';
import { clearGalleryCache } from '../../lib/gallery.js';

/*
 * "Development page photos" section of the approver's Website Images page: the photos of the four Development page sections
 * (01 Measuring tape, 02 Sewing thread, 03 Needles, 04 Pattern pieces). Each section shows up to 3 photos
 * as a swipeable carousel on the website. Photos are uploaded straight into Google Drive (they do not go
 * through the garment image pipeline) and appear on the website at once.
 * The browser shrinks each photo to web size before sending it, so phone photos upload quickly.
 */

/** Sections are titled by their order on the Development page: "1st image", "2nd image", … */
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const titled = (sections) => sections.map((section, i) => ({ ...section, name: `${ORDINALS[i] || `${i + 1}th`} image` }));

const MAX_EDGE = 2000;           // longest side of the uploaded photo, in pixels
export const WEBSITE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

const ERRORS = {
  drive_not_configured: 'Google Drive is not connected yet, so photos cannot be uploaded.',
  drive_forbidden: 'Google Drive refused the request: the secret in .env does not match the Apps Script.',
  drive_unreachable: 'Could not reach Google Drive. Try again in a moment.',
  drive_unknown_action: 'Uploading needs the latest Google Apps Script: paste the new google/drive-upload.gs and deploy a new version.',
  section_full: 'This section already has 3 photos. Replace or remove one first.',
  order_out_of_date: 'Someone else changed this section at the same time. The page has been refreshed; please try again.',
  unsupported_type: 'Only JPG, PNG and WebP photos can be used.',
  empty_file: 'The photo was empty. Please choose it again.',
  too_large: 'The photo is too large. Please choose a smaller one.',
  not_found: 'That photo or section no longer exists. The page has been refreshed.',
  unauthenticated: 'Your session has ended. Please sign in again.',
  forbidden: 'Your role cannot manage website images.'
};
const errorText = (code) => ERRORS[code] || (code?.startsWith('drive_') ? 'Google Drive did not answer properly. Try again shortly.' : 'Something went wrong. Please try again.');

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(errorText(data.error || (response.status === 413 ? 'too_large' : undefined)));
    error.code = data.error;
    throw error;
  }
  return data;
}
const sendJson = (url, method, body) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

/** Shrinks a photo to at most MAX_EDGE pixels and re-encodes it as WebP (JPEG where WebP is unavailable). */
export async function prepareWebsiteImage(file, maxEdge = MAX_EDGE) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This browser cannot open that photo. Please use a JPG, PNG or WebP file (iPhone HEIC photos open in Safari).');
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await encode('image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.88);
  if (!blob) throw new Error('The photo could not be prepared for upload. Please try another one.');
  return blob;
}

export default function DevelopmentImagesSection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);        // `${sectionId}` while uploading/reordering, or `img-${id}`

  const load = useCallback(async () => {
    try {
      setData(await api('/api/admin/development-images'));
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (key, work, success) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await work();
      clearGalleryCache();          // the website shows the change without a reload
      if (success) setNotice(success);
    } catch (err) {
      setError(err.message);
    } finally {
      await load();
      setBusy(null);
    }
  };

  const upload = (section, file, replace) => run(`${section.id}`, async () => {
    const blob = await prepareWebsiteImage(file);
    await api(`/api/admin/development-images/sections/${section.id}/images${replace ? `?replace=${replace.id}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      body: blob
    });
  }, replace ? `Photo replaced in the ${section.name} section. It is on the website now.` : `Photo added to the ${section.name} section. It is on the website now.`);

  const remove = (section, image, position) => {
    const last = section.images.length === 1;
    const message = last
      ? `Remove photo ${position} from the ${section.name} section? This is its only photo, so the section will be empty on the website until a new photo is added.`
      : `Remove photo ${position} from the ${section.name} section?`;
    if (!window.confirm(`${message} The file goes to the Google Drive trash.`)) return;
    run(`img-${image.id}`, () => sendJson(`/api/admin/development-images/images/${image.id}/remove`, 'POST'), `Photo removed from the ${section.name} section.`);
  };

  const move = (section, index, step) => {
    const ids = section.images.map((img) => img.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + step, 0, id);
    run(`${section.id}`, () => sendJson(`/api/admin/development-images/sections/${section.id}/order`, 'PUT', { ids }));
  };

  return (
    <section id="development-photos" className="dev-images" aria-labelledby="dev-images-title">
      <div className="dev-images-intro">
        <div className="eyebrow">DEVELOPMENT PAGE</div>
        <h2 id="dev-images-title">Development page photos</h2>
        <p className="muted">
          The photos in the four sections of the <a href="/development" target="_blank" rel="noopener noreferrer">Development page ↗</a>.
          Each section shows up to 3 photos that visitors can swipe through. Upload them here directly (they do not go
          through the approval list above); they are stored in Google Drive and go live straight away.
        </p>
      </div>

      {(error || notice) && (
        <p className={error ? 'admin-alert' : 'dev-images-notice'} role={error ? 'alert' : 'status'}>{error || notice}</p>
      )}

      {!data ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <>
          {!data.drive.configured && <p className="admin-alert">{ERRORS.drive_not_configured}</p>}
          {data.sections.length === 0 && (
            <p className="admin-alert">The Development page sections are not in the database yet. Run <code>npm run db:setup</code> on the server.</p>
          )}
          <p className="dev-images-tip muted">Tip: landscape photos (4:3) at least 1600 pixels wide look best. Large photos are made smaller automatically before uploading.</p>
          <div className="dev-images-list">
            {titled(data.sections).map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                limit={data.limit}
                disabled={!data.drive.configured || busy !== null}
                uploading={busy === `${section.id}`}
                busyImage={busy}
                onUpload={upload}
                onRemove={remove}
                onMove={move}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function SectionCard({ section, limit, disabled, uploading, busyImage, onUpload, onRemove, onMove }) {
  const free = Math.max(0, limit - section.images.length);
  return (
    <section className="admin-panel dev-images-section" aria-labelledby={`dev-section-${section.id}`}>
      <div className="dev-images-head">
        <h3 id={`dev-section-${section.id}`}>{section.name}</h3>
        <span className="muted">{section.images.length}/{limit} photos{uploading ? ' · working…' : ''}</span>
      </div>
      {section.images.length === 0 && (
        <p className="muted dev-images-empty">No photos yet — this section is empty on the website. Add a photo.</p>
      )}
      <ol className="dev-images-slots">
        {section.images.map((image, index) => (
          <li key={image.id} className={busyImage === `img-${image.id}` ? 'dev-images-slot is-busy' : 'dev-images-slot'}>
            <img src={image.url} alt={`${section.name}, photo ${index + 1}`} loading="lazy" />
            <span className="dev-images-pos" aria-hidden="true">{index + 1}</span>
            <div className="dev-images-actions">
              <button type="button" className="dev-images-icon" onClick={() => onMove(section, index, -1)} disabled={disabled || index === 0}
                aria-label={`Move photo ${index + 1} earlier`} title="Move earlier">←</button>
              <button type="button" className="dev-images-icon" onClick={() => onMove(section, index, 1)} disabled={disabled || index === section.images.length - 1}
                aria-label={`Move photo ${index + 1} later`} title="Move later">→</button>
              <FilePick label="Replace" disabled={disabled} onFile={(file) => onUpload(section, file, image)}
                aria={`Replace photo ${index + 1} in the ${section.name} section`} />
              <button type="button" className="admin-link-button is-danger" onClick={() => onRemove(section, image, index + 1)} disabled={disabled}>Remove</button>
            </div>
          </li>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <li key={`free-${i}`} className="dev-images-slot is-empty">
            {i === 0 ? (
              <DropZone disabled={disabled} uploading={uploading} onFile={(file) => onUpload(section, file)} sectionName={section.name} />
            ) : (
              <span className="dev-images-free muted">Free slot</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** "Add photo" slot: click to choose a photo, or drop one onto it. */
function DropZone({ disabled, uploading, onFile, sectionName }) {
  const [over, setOver] = useState(false);
  const accept = (event) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (file && !disabled) onFile(file);
  };
  return (
    <label
      className={`dev-images-add${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={accept}
    >
      <span className="dev-images-plus" aria-hidden="true">{uploading ? '…' : '+'}</span>
      <span>{uploading ? 'Uploading…' : 'Add photo'}</span>
      <span className="muted">{uploading ? 'Sending to Google Drive' : 'Click or drop a photo here'}</span>
      <input
        type="file" accept={WEBSITE_IMAGE_ACCEPT} disabled={disabled} className="sr-only"
        aria-label={`Add a photo to ${sectionName}`}
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file); }}
      />
    </label>
  );
}

function FilePick({ label, disabled, onFile, aria }) {
  const input = useRef(null);
  return (
    <>
      <button type="button" className="admin-link-button" disabled={disabled} onClick={() => input.current?.click()} aria-label={aria}>{label}</button>
      <input
        ref={input} type="file" accept={WEBSITE_IMAGE_ACCEPT} hidden
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file); }}
      />
    </>
  );
}
