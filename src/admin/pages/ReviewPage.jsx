import { useCallback, useEffect, useRef, useState } from 'react';
import '../review.css';

/*
 * Approver's "Website Images" page — split screen.
 *   Left:  finished photos from the Drive pipeline waiting for approval, each with a suggested folder.
 *   Right: the website's product folders. Drag a photo onto a folder to publish it (it goes first; a full
 *          folder drops its last photo). Folders and the photos inside them are reordered by dragging, and a
 *          photo can be dragged from one folder onto another. A filter shows the homepage / Products folders.
 * Touch screens: tap a photo to pick its folder; arrow buttons reorder; "Move" sends a photo to another folder.
 */

const ERRORS = {
  drive_not_configured: 'Google Drive is not connected yet, so new photos cannot be fetched.',
  drive_processed_not_configured: 'Finished photos cannot be read yet: add the PROCESSED_FOLDER_ID script property in Apps Script and deploy a new version.',
  drive_forbidden: 'Google Drive refused the request: the secret in .env does not match the Apps Script.',
  drive_unreachable: 'Could not reach Google Drive. Try again in a moment.',
  not_pending: 'That photo was already handled (perhaps by another approver). The page has been refreshed.',
  same_folder: 'The photo is already in that folder.',
  drive_script_outdated: 'Moving photos needs the latest Google Apps Script: paste the new google/drive-upload.gs and deploy a new version.',
  order_out_of_date: 'Someone else changed this at the same time. The page has been refreshed; please try again.',
  home_limit: 'The homepage shows up to 4 folders. Turn one off first.',
  invalid_name: 'Folder name is required (up to 60 characters).',
  invalid_description: 'Products page text is required (up to 255 characters).',
  invalid_homeTagline: 'Homepage line is required (up to 120 characters).',
  unauthenticated: 'Your session has ended. Please sign in again.',
  forbidden: 'Your role cannot manage website images.'
};
const errorText = (code) => ERRORS[code] || (code?.startsWith('drive_') ? 'Google Drive did not answer properly. Try again shortly.' : 'Something went wrong. Please try again.');

async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(errorText(data.error));
    error.code = data.error;
    throw error;
  }
  return data;
}

/** Moves `id` to where `targetId` is: after it when moving down, before it when moving up. */
function moveTo(list, id, targetId) {
  const from = list.findIndex((item) => item.id === id);
  const to = list.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
function moveBy(list, id, step) {
  const from = list.findIndex((item) => item.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return list;
  return moveTo(list, id, list[to].id);
}

const FILTERS = [
  ['all', 'All folders', () => true],
  ['home', 'On homepage', (folder) => folder.showOnHome],
  ['products', 'On Products page', (folder) => folder.showOnProducts]
];
const EMPTY_FILTER = {
  home: 'No folder is on the homepage. Use Edit on a folder and tick "Show on homepage".',
  products: 'No folder is on the Products page. Use Edit on a folder and tick "Show on Products page".'
};

const timeFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function ReviewPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null);          // { type: 'pending'|'folder'|'image', id, folderId? }
  const [over, setOver] = useState(null);          // folder id or `img-<id>` under the pointer
  const [open, setOpen] = useState(() => new Set());
  const [editing, setEditing] = useState(null);    // folder id being edited
  const [picker, setPicker] = useState(null);      // { mode: 'publish', id } | { mode: 'move', id, folderId }
  const [filter, setFilter] = useState('all');
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api('/api/admin/review'));
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  const syncDrive = useCallback(async (force) => {
    setSyncing(true);
    try {
      const result = await api('/api/admin/review/sync', 'POST', { force });
      if (force && result.imported) setNotice(`${result.imported} new photo${result.imported === 1 ? '' : 's'} arrived for approval.`);
      else if (force) setNotice('No new finished photos in Google Drive.');
      if (result.remaining) setNotice(`${result.imported} new photos fetched; ${result.remaining} more will follow on the next check.`);
    } catch (syncError) {
      if (force || syncError.code !== 'drive_not_configured') setError(syncError.message);
    } finally {
      setSyncing(false);
      load();
    }
  }, [load]);

  // Fetch new photos on arrival and every 2 minutes while the page is visible.
  useEffect(() => {
    load().then(() => syncDrive(false));
    pollRef.current = setInterval(() => { if (!document.hidden) syncDrive(false); }, 120 * 1000);
    return () => clearInterval(pollRef.current);
  }, [load, syncDrive]);

  // While dragging, scroll the page when the pointer is near the top or bottom edge of the window,
  // so a folder further down (or up) can be reached.
  useEffect(() => {
    if (!drag) return undefined;
    const EDGE = 120;
    const MAX_SPEED = 24;
    let pointerY = null;
    let frame;
    const onDragOver = (event) => { pointerY = event.clientY; };
    const step = () => {
      if (pointerY !== null) {
        const height = window.innerHeight;
        let delta = 0;
        if (pointerY < EDGE) delta = -Math.ceil(((EDGE - pointerY) / EDGE) * MAX_SPEED);
        else if (pointerY > height - EDGE) delta = Math.ceil(((pointerY - (height - EDGE)) / EDGE) * MAX_SPEED);
        if (delta) window.scrollBy(0, delta);
      }
      frame = requestAnimationFrame(step);
    };
    document.addEventListener('dragover', onDragOver);
    frame = requestAnimationFrame(step);
    return () => { document.removeEventListener('dragover', onDragOver); cancelAnimationFrame(frame); };
  }, [drag]);

  // Success messages fade after a few seconds; errors stay until dismissed.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  const run = async (work, success) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (success) setNotice(typeof success === 'function' ? success(result) : success);
    } catch (runError) {
      setError(runError.message);
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (!data) {
    return (
      <>
        <PageHead />
        {error ? <p className="admin-alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </>
    );
  }

  const { categories, pending, limits } = data;
  const folderById = new Map(categories.map((c) => [c.id, c]));

  /* ----- actions ----- */
  const publish = (photo, folder) => {
    setPicker(null);
    const full = folder.images.length >= limits.perCategory;
    if (full && !window.confirm(`${folder.name} already has ${limits.perCategory} photos.\n\nPublishing this one puts it first and removes the last photo in ${folder.name}. Continue?`)) return;
    run(
      () => api(`/api/admin/review/pending/${photo.id}/publish`, 'POST', { categoryId: folder.id }),
      (result) => `Published in ${folder.name}${result.removed.length ? '; its last photo was removed to keep 20' : ''}. It is live on the website now.`
    );
  };
  const moveImage = (imageId, fromFolder, toFolder) => {
    setPicker(null);
    if (!fromFolder || fromFolder.id === toFolder.id) return;
    const full = toFolder.images.length >= limits.perCategory;
    if (full && !window.confirm(`${toFolder.name} already has ${limits.perCategory} photos.\n\nMoving this one there puts it first and removes the last photo in ${toFolder.name}. Continue?`)) return;
    run(
      () => api(`/api/admin/review/images/${imageId}/move`, 'POST', { categoryId: toFolder.id }),
      (result) => `Moved from ${fromFolder.name} to ${toFolder.name}, where it now shows first${result.removed.length ? '; the last photo there was removed to keep 20' : ''}.`
    );
  };
  const reject = (photo) => {
    if (!window.confirm('Reject this photo? It will not appear on the website.')) return;
    run(() => api(`/api/admin/review/pending/${photo.id}/reject`, 'POST', {}), 'Photo rejected.');
  };
  const removeImage = (folder, image) => {
    if (!window.confirm(`Remove this photo from ${folder.name}? It disappears from the website straight away.`)) return;
    run(() => api(`/api/admin/review/images/${image.id}/remove`, 'POST', {}), `Photo removed from ${folder.name}.`);
  };
  const saveFolderOrder = (next) => {
    setData((current) => ({ ...current, categories: next }));
    run(() => api('/api/admin/review/categories/order', 'PUT', { ids: next.map((c) => c.id) }));
  };
  const saveImageOrder = (folder, images) => {
    setData((current) => ({ ...current, categories: current.categories.map((c) => (c.id === folder.id ? { ...c, images } : c)) }));
    run(() => api(`/api/admin/review/categories/${folder.id}/images`, 'PUT', { ids: images.map((img) => img.id) }));
  };
  const toggleOpen = (id) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /* ----- drag and drop ----- */
  const startDrag = (event, payload) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${payload.type}:${payload.id}`);   // required by Firefox
    setDrag(payload);
    setNotice('');
  };
  const endDrag = () => { setDrag(null); setOver(null); };

  const folderDragOver = (event, folder) => {
    if (!drag) return;
    const accepts = drag.type === 'pending'
      || (drag.type === 'folder' && drag.id !== folder.id)
      || (drag.type === 'image' && drag.folderId !== folder.id);   // a photo from another folder
    if (accepts) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (over !== folder.id) setOver(folder.id);
    }
  };
  const folderDrop = (event, folder) => {
    if (!drag) return;
    event.preventDefault();
    const current = drag;
    endDrag();
    if (current.type === 'pending') {
      const photo = pending.find((p) => p.id === current.id);
      if (photo) publish(photo, folder);
    } else if (current.type === 'folder') {
      saveFolderOrder(moveTo(categories, current.id, folder.id));
    } else if (current.type === 'image' && current.folderId !== folder.id) {
      moveImage(current.id, folderById.get(current.folderId), folder);
    }
  };
  const imageDragOver = (event, folder, image) => {
    if (drag?.type !== 'image' || drag.folderId !== folder.id || drag.id === image.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (over !== `img-${image.id}`) setOver(`img-${image.id}`);
  };
  const imageDrop = (event, folder, image) => {
    if (drag?.type !== 'image' || drag.folderId !== folder.id) return;
    event.preventDefault();
    event.stopPropagation();
    const current = drag;
    endDrag();
    saveImageOrder(folder, moveTo(folder.images, current.id, image.id));
  };

  const pickerPhoto = picker?.mode === 'publish' && pending.find((p) => p.id === picker.id);
  const pickerImage = picker?.mode === 'move' && folderById.get(picker.folderId)?.images.find((img) => img.id === picker.id);
  const [, , filterTest] = FILTERS.find(([key]) => key === filter);
  const visible = categories.filter(filterTest);

  return (
    <>
      <PageHead>
        <div className="review-sync">
          <button type="button" className="button" onClick={() => syncDrive(true)} disabled={syncing || !data.drive.configured}>
            {syncing ? 'Checking…' : 'Check for new photos'}
          </button>
          {data.drive.lastSyncAt && <span className="muted">Last checked {timeFormat.format(new Date(data.drive.lastSyncAt))}</span>}
        </div>
      </PageHead>

      <div className="review-toasts">
        {error && (
          <p className="review-toast is-error" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setError('')}>×</button>
          </p>
        )}
        {notice && (
          <p className="review-toast" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}>×</button>
          </p>
        )}
      </div>

      <div className={`review-split${drag ? ' is-dragging' : ''}`}>
        {/* ---------- left: waiting for approval ---------- */}
        <section className="review-pane review-pending" aria-labelledby="review-pending-title">
          <div className="review-pane-head">
            <h2 id="review-pending-title">Waiting for approval</h2>
            <span className={`review-count${pending.length ? ' is-alert' : ''}`}>{pending.length}</span>
          </div>
          <p className="review-hint">
            <span className="for-pointer">Drag a photo onto a folder on the right to publish it.</span>
            <span className="for-touch">Tap a photo, then choose its folder.</span>
          </p>
          {pending.length === 0 ? (
            <div className="review-empty">
              <strong>Nothing waiting.</strong>
              <span>When contributors upload photos, the AI pipeline turns them into product images. They appear here for approval.</span>
            </div>
          ) : (
            <ul className="review-pending-grid">
              {pending.map((photo) => {
                const suggested = folderById.get(photo.suggestedCategoryId);
                return (
                  <li
                    key={photo.id}
                    className={`review-photo${drag?.type === 'pending' && drag.id === photo.id ? ' is-dragged' : ''}`}
                    draggable={!busy}
                    onDragStart={(event) => startDrag(event, { type: 'pending', id: photo.id, suggestedId: photo.suggestedCategoryId })}
                    onDragEnd={endDrag}
                  >
                    <button type="button" className="review-photo-img" onClick={() => setPicker({ mode: 'publish', id: photo.id })} aria-label={`Publish ${photo.driveName || 'photo'}: choose a folder`}>
                      <img src={photo.url} alt="" draggable="false" loading="lazy" />
                    </button>
                    <div className="review-photo-meta">
                      <span className={`review-suggest${suggested ? '' : ' is-none'}`}>
                        {suggested ? <>Suggested: <strong>{suggested.name}</strong></> : `AI folder: ${photo.driveFolder || 'unknown'}`}
                      </span>
                      <div className="review-photo-actions">
                        <button type="button" className="admin-link-button" onClick={() => setPicker({ mode: 'publish', id: photo.id })}>Publish…</button>
                        <button type="button" className="admin-link-button is-danger" onClick={() => reject(photo)}>Reject</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---------- right: website folders ---------- */}
        <section className="review-pane review-folders" aria-labelledby="review-folders-title">
          <div className="review-pane-head">
            <h2 id="review-folders-title">Website folders</h2>
            <span className="muted">Up to {limits.perCategory} photos each · newest first</span>
          </div>
          <p className="review-hint">
            <span className="for-pointer">Drag ⠿ to reorder folders. Drag any photo onto another folder to move it; open a folder to reorder or remove photos. Hold near the window edge to scroll.</span>
            <span className="for-touch">Use the arrows to reorder. Open a folder to reorder, move or remove its photos.</span>
          </p>

          <div className="review-filter" role="group" aria-label="Show folders">
            {FILTERS.map(([key, label, test]) => (
              <button type="button" key={key} className={filter === key ? 'is-active' : undefined} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label} <span>{categories.filter(test).length}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 && <p className="review-empty">{EMPTY_FILTER[filter]}</p>}

          <ol className="review-folder-list">
            {visible.map((folder, index) => {
              const isOpen = open.has(folder.id);
              const full = folder.images.length >= limits.perCategory;
              const dropping = over === folder.id && drag;
              const suggestedForDrag = drag?.type === 'pending' && drag.suggestedId === folder.id;
              return (
                <li
                  key={folder.id}
                  className={[
                    'review-folder',
                    isOpen && 'is-open',
                    dropping && (drag.type === 'pending' || drag.type === 'image') && 'is-drop',
                    dropping && drag.type === 'folder' && 'is-drop-line',
                    suggestedForDrag && 'is-suggested',
                    drag?.type === 'folder' && drag.id === folder.id && 'is-dragged'
                  ].filter(Boolean).join(' ')}
                  onDragOver={(event) => folderDragOver(event, folder)}
                  onDrop={(event) => folderDrop(event, folder)}
                >
                  <div className="review-folder-head">
                    <span
                      className="review-handle for-pointer" draggable={!busy} title="Drag to reorder folders" aria-hidden="true"
                      onDragStart={(event) => {
                        event.dataTransfer.setDragImage(event.currentTarget.closest('.review-folder'), 24, 24);
                        startDrag(event, { type: 'folder', id: folder.id });
                      }}
                      onDragEnd={endDrag}
                    >⠿</span>
                    <button type="button" className="review-folder-title" onClick={() => toggleOpen(folder.id)} aria-expanded={isOpen}>
                      <span className="review-folder-icon" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                      <strong>{folder.name}</strong>
                      <span className={`review-folder-count${full ? ' is-full' : ''}`}>{folder.images.length}/{limits.perCategory}</span>
                    </button>
                    <span className="review-badges">
                      {folder.showOnHome && <span className="review-badge">Homepage</span>}
                      {folder.showOnProducts ? <span className="review-badge">Products</span> : <span className="review-badge is-off">Hidden</span>}
                    </span>
                    <span className="review-move for-touch">
                      <button type="button" aria-label={`Move ${folder.name} up`} disabled={index === 0 || busy} onClick={() => saveFolderOrder(moveTo(categories, folder.id, visible[index - 1].id))}>↑</button>
                      <button type="button" aria-label={`Move ${folder.name} down`} disabled={index === visible.length - 1 || busy} onClick={() => saveFolderOrder(moveTo(categories, folder.id, visible[index + 1].id))}>↓</button>
                    </span>
                    <button type="button" className="admin-link-button" onClick={() => setEditing(editing === folder.id ? null : folder.id)}>
                      {editing === folder.id ? 'Close' : 'Edit'}
                    </button>
                  </div>

                  {dropping && (drag.type === 'pending' || drag.type === 'image') && (
                    <div className="review-drop-msg">
                      Drop to {drag.type === 'pending' ? 'publish' : 'move'} into <strong>{folder.name}</strong> (it goes first)
                      {full ? ' — its last photo will be removed' : ''}
                    </div>
                  )}

                  {editing === folder.id && (
                    <FolderEditor
                      folder={folder}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={(changes) => run(async () => {
                        await api(`/api/admin/review/categories/${folder.id}`, 'PATCH', changes);
                        setEditing(null);
                      }, `${changes.name || folder.name} saved. The website shows the change now.`)}
                    />
                  )}

                  {!isOpen && folder.images.length > 0 && (
                    // Click opens the folder; each thumbnail can also be dragged onto another folder.
                    <div className="review-strip" onClick={() => toggleOpen(folder.id)}>
                      {folder.images.slice(0, 7).map((image) => (
                        <img
                          key={image.id} src={image.url} alt="" loading="lazy" title="Drag onto another folder to move it"
                          className={drag?.type === 'image' && drag.id === image.id ? 'is-dragged' : undefined}
                          draggable={!busy}
                          onDragStart={(event) => { event.stopPropagation(); startDrag(event, { type: 'image', id: image.id, folderId: folder.id }); }}
                          onDragEnd={endDrag}
                        />
                      ))}
                      {folder.images.length > 7 && <span>+{folder.images.length - 7}</span>}
                    </div>
                  )}
                  {!isOpen && folder.images.length === 0 && <p className="review-folder-empty">No photos yet — the website shows its built-in picture.</p>}

                  {isOpen && (
                    <ol className="review-images">
                      {folder.images.map((image, imageIndex) => (
                        <li
                          key={image.id}
                          className={[
                            'review-image',
                            over === `img-${image.id}` && 'is-drop-line',
                            drag?.type === 'image' && drag.id === image.id && 'is-dragged'
                          ].filter(Boolean).join(' ')}
                          draggable={!busy}
                          onDragStart={(event) => { event.stopPropagation(); startDrag(event, { type: 'image', id: image.id, folderId: folder.id }); }}
                          onDragEnd={endDrag}
                          onDragOver={(event) => imageDragOver(event, folder, image)}
                          onDrop={(event) => imageDrop(event, folder, image)}
                        >
                          <img src={image.url} alt="" loading="lazy" draggable="false" />
                          <span className="review-image-pos">{imageIndex + 1}</span>
                          <button type="button" className="review-image-remove" aria-label={`Remove photo ${imageIndex + 1} from ${folder.name}`} title="Remove from website" onClick={() => removeImage(folder, image)}>×</button>
                          <button type="button" className="review-image-moveto" aria-label={`Move photo ${imageIndex + 1} to another folder`} title="Move to another folder" onClick={() => setPicker({ mode: 'move', id: image.id, folderId: folder.id })}>⇄</button>
                          <span className="review-image-move for-touch">
                            <button type="button" aria-label="Move earlier" disabled={imageIndex === 0 || busy} onClick={() => saveImageOrder(folder, moveBy(folder.images, image.id, -1))}>‹</button>
                            <button type="button" aria-label="Move later" disabled={imageIndex === folder.images.length - 1 || busy} onClick={() => saveImageOrder(folder, moveBy(folder.images, image.id, 1))}>›</button>
                          </span>
                        </li>
                      ))}
                      {folder.images.length === 0 && <li className="review-folder-empty">No photos yet.</li>}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      {pickerPhoto && (
        <FolderPicker
          title="Publish to which folder?"
          imageUrl={pickerPhoto.url}
          suggestedId={pickerPhoto.suggestedCategoryId}
          categories={categories}
          limit={limits.perCategory}
          onPick={(folder) => publish(pickerPhoto, folder)}
          onClose={() => setPicker(null)}
        />
      )}
      {pickerImage && (
        <FolderPicker
          title={`Move from ${folderById.get(picker.folderId).name} to…`}
          imageUrl={pickerImage.url}
          categories={categories.filter((c) => c.id !== picker.folderId)}
          limit={limits.perCategory}
          onPick={(folder) => moveImage(pickerImage.id, folderById.get(picker.folderId), folder)}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

function PageHead({ children }) {
  return (
    <header className="admin-page-head review-head">
      <div>
        <div className="eyebrow">WEBSITE IMAGES</div>
        <h1>Website images</h1>
        <p className="muted">Approve finished photos into the website&apos;s product folders, and choose what shows on the homepage and Products page.</p>
      </div>
      {children}
    </header>
  );
}

function FolderEditor({ folder, busy, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: folder.name, description: folder.description, homeTagline: folder.homeTagline,
    showOnHome: folder.showOnHome, showOnProducts: folder.showOnProducts
  });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    const changes = Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== folder[key]));
    if (!Object.keys(changes).length) return onCancel();
    return onSave(changes);
  };
  return (
    <form className="review-editor" onSubmit={submit}>
      <label>Folder name<input value={form.name} onChange={set('name')} maxLength={60} required /></label>
      <label>Homepage line<input value={form.homeTagline} onChange={set('homeTagline')} maxLength={120} required /></label>
      <label className="is-wide">Products page text<textarea value={form.description} onChange={set('description')} maxLength={255} rows={2} required /></label>
      <div className="review-editor-checks is-wide">
        <label><input type="checkbox" checked={form.showOnHome} onChange={set('showOnHome')} /> Show on homepage (up to 4 folders)</label>
        <label><input type="checkbox" checked={form.showOnProducts} onChange={set('showOnProducts')} /> Show on Products page</label>
      </div>
      <div className="review-editor-actions is-wide">
        <button type="submit" className="button" disabled={busy}>Save</button>
        <button type="button" className="admin-link-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Folder chooser for touch screens and keyboards (and anyone who clicks instead of dragging). */
function FolderPicker({ title, imageUrl, suggestedId, categories, limit, onPick, onClose }) {
  const suggested = categories.find((c) => c.id === suggestedId);
  const others = categories.filter((c) => c !== suggested);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const option = (folder, isSuggested) => (
    <button type="button" key={folder.id} className={`review-pick${isSuggested ? ' is-suggested' : ''}`} onClick={() => onPick(folder)}>
      <span><strong>{folder.name}</strong>{isSuggested && <em>Suggested</em>}</span>
      <span className="muted">{folder.images.length}/{limit}{folder.images.length >= limit ? ' · last photo will be removed' : ''}</span>
    </button>
  );
  return (
    <div className="review-sheet-backdrop" onClick={onClose}>
      <div className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="review-sheet-title" onClick={(event) => event.stopPropagation()}>
        <img src={imageUrl} alt="" />
        <h2 id="review-sheet-title">{title}</h2>
        <div className="review-pick-list">
          {suggested && option(suggested, true)}
          {others.map((folder) => option(folder, false))}
        </div>
        <button type="button" className="admin-link-button" onClick={onClose} autoFocus>Cancel</button>
      </div>
    </div>
  );
}
