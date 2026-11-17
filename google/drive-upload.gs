/**
 * Fresco NY — Drive bridge (Google Apps Script). Google Drive is the storage for the website's photos.
 *
 * 1. Contributor uploads -> "Unprocessed Garment Images" (the image pipeline's input).
 * 2. Pipeline output in "Processed Images/<category>/" -> listed and downloaded for approval (read-only).
 *    For the contributor's live status, the script also reports where each uploaded original is now
 *    (still waiting in the input folder, or moved by the pipeline to "_done" / "_failed").
 * 3. Website photos live in "Fresco Website Images/<website folder>/" (created automatically):
 *    approving copies a finished image there; moving a photo to another website folder moves its file;
 *    removing a photo moves it to the Drive trash (30 days).
 * The website keeps only a disposable cache; it can always re-download a photo from here.
 * It runs as the Fresco NY Google account, so the website never holds Google credentials.
 *
 * SETUP — signed in to Google as the Fresco NY account (the one that owns the Drive folders):
 *  1. Open https://script.google.com -> New project -> name it "Fresco upload bridge".
 *  2. Replace the code with this file and Save.
 *  3. Project Settings (gear icon) -> Script properties -> Add:
 *       FOLDER_ID            the ID of "Unprocessed Garment Images" (the last part of its Drive folder URL)
 *       PROCESSED_FOLDER_ID  the ID of "Processed Images"
 *       UPLOAD_SECRET        a long random string; put the SAME value in DRIVE_UPLOAD_SECRET on the website server
 *     (WEBSITE_FOLDER_ID is added by the script itself when it creates "Fresco Website Images".)
 *  4. Deploy -> New deployment -> Select type: Web app
 *       Execute as: Me      Who has access: Anyone
 *     Deploy -> Authorize access (choose the Fresco NY account; "Advanced" -> "Go to ..." if Google warns).
 *  5. Copy the Web app URL (ends in /exec) into DRIVE_UPLOAD_URL on the website server.
 *  6. On the server run:  npm run drive:check
 *
 * After changing this code: Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy.
 * The URL stays the same. "Anyone" access is safe because every request must carry UPLOAD_SECRET.
 */

var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
var WEB_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
var NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
var WEBSITE_ROOT_NAME = 'Fresco Website Images';
var MAX_LISTED = 500;

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('UPLOAD_SECRET');
    var folderId = props.getProperty('FOLDER_ID');
    if (!secret || !folderId) return reply_({ ok: false, error: 'script_not_configured' });

    var body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== secret) return reply_({ ok: false, error: 'forbidden' });

    switch (body.action) {
      case 'ping': return ping_(props, folderId);
      case 'upload': return upload_(DriveApp.getFolderById(folderId), body);
      case 'listProcessed': return listProcessed_(processedFolder_(props));
      case 'downloadProcessed': return download_(fileIn_(body.id, processedFolder_(props), true));
      case 'ensureWebsiteFolder': return ensureWebsiteFolder_(props, body);
      case 'uploadWebsite': return uploadWebsite_(props, body);
      case 'copyToWebsite': return copyToWebsite_(props, body);
      case 'downloadWebsite': return download_(fileIn_(body.id, websiteRoot_(props), false));
      case 'trashWebsite': return trashWebsite_(props, body);
      case 'moveWebsite': return moveWebsite_(props, body);
      case 'locateFiles': return locateFiles_(props, folderId, body);
      default: return reply_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    var code = err && err.code ? err.code : 'script_error';
    return reply_({ ok: false, error: code, detail: String((err && err.message) || err).slice(0, 200) });
  }
}

function fail_(code, message) {
  var err = new Error(message || code);
  err.code = code;
  throw err;
}

function ping_(props, folderId) {
  var processedId = props.getProperty('PROCESSED_FOLDER_ID');
  var websiteId = props.getProperty('WEBSITE_FOLDER_ID');
  return reply_({
    ok: true,
    folderName: DriveApp.getFolderById(folderId).getName(),
    processedFolderName: processedId ? DriveApp.getFolderById(processedId).getName() : null,
    websiteFolderName: websiteId ? DriveApp.getFolderById(websiteId).getName() : null,
    version: 5
  });
}

/* ---------- contributor uploads ---------- */

function upload_(folder, body) {
  if (ALLOWED_TYPES.indexOf(body.mimeType) === -1) return reply_({ ok: false, error: 'unsupported_type' });
  if (!NAME_PATTERN.test(body.name || '')) return reply_({ ok: false, error: 'bad_name' });
  // Never overwrite or duplicate: refuse a name that is already in the folder.
  if (folder.getFilesByName(body.name).hasNext()) return reply_({ ok: false, error: 'exists' });

  var blob = Utilities.newBlob(Utilities.base64Decode(body.data), body.mimeType, body.name);
  var file = folder.createFile(blob);
  if (body.description) file.setDescription(String(body.description).slice(0, 500));
  return reply_({ ok: true, id: file.getId(), name: file.getName(), size: file.getSize() });
}

/* ---------- pipeline output (read-only) ---------- */

function processedFolder_(props) {
  var id = props.getProperty('PROCESSED_FOLDER_ID');
  if (!id) fail_('processed_not_configured', 'PROCESSED_FOLDER_ID is not set');
  return DriveApp.getFolderById(id);
}

/** Finished images in Processed Images/<category>/, newest first. "_done", "_failed", "_logs" are skipped. */
function listProcessed_(root) {
  var files = [];
  var folders = root.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    if (folder.getName().charAt(0) === '_') continue;
    var it = folder.getFiles();
    while (it.hasNext()) {
      var file = it.next();
      if (String(file.getMimeType()).indexOf('image/') !== 0) continue;
      files.push({
        id: file.getId(), name: file.getName(), folder: folder.getName(),
        size: file.getSize(), created: file.getDateCreated().toISOString()
      });
    }
  }
  files.sort(function (a, b) { return a.created < b.created ? 1 : -1; });
  return reply_({ ok: true, files: files.slice(0, MAX_LISTED) });
}

/**
 * Where are these uploaded originals now? (read-only)
 *   input = still in "Unprocessed Garment Images" (waiting for the pipeline)
 *   done / failed = moved by the pipeline to Processed Images/_done or /_failed
 *   missing = deleted or trashed; elsewhere = moved somewhere else by hand
 */
function locateFiles_(props, inputFolderId, body) {
  var ids = (body.ids || []).slice(0, 200);
  var processedId = props.getProperty('PROCESSED_FOLDER_ID');
  var result = {};
  for (var i = 0; i < ids.length; i++) {
    var where = 'missing';
    try {
      var file = DriveApp.getFileById(String(ids[i]));
      if (!file.isTrashed()) {
        where = 'elsewhere';
        var parents = file.getParents();
        while (parents.hasNext()) {
          var parent = parents.next();
          if (parent.getId() === inputFolderId) { where = 'input'; break; }
          if (processedId && hasParent_(parent, processedId)) {
            if (parent.getName() === '_done') { where = 'done'; break; }
            if (parent.getName() === '_failed') { where = 'failed'; break; }
          }
        }
      }
    } catch (gone) { where = 'missing'; }
    result[ids[i]] = where;
  }
  return reply_({ ok: true, locations: result });
}

/* ---------- website photos ---------- */

/** "Fresco Website Images" in My Drive; created (once) on first use and remembered in WEBSITE_FOLDER_ID. */
function websiteRoot_(props) {
  var id = props.getProperty('WEBSITE_FOLDER_ID');
  if (id) {
    try {
      var existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (ignored) { /* deleted: create a new one below */ }
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    id = props.getProperty('WEBSITE_FOLDER_ID');
    if (id) {
      try { var again = DriveApp.getFolderById(id); if (!again.isTrashed()) return again; } catch (ignored2) { /* create */ }
    }
    var root = DriveApp.createFolder(WEBSITE_ROOT_NAME);
    root.setDescription('Product photos shown on the Fresco NY website, one folder per website category. ' +
      'Managed from the website back office (Website Images page). Please do not move, rename or delete files here by hand.');
    props.setProperty('WEBSITE_FOLDER_ID', root.getId());
    return root;
  } finally {
    lock.releaseLock();
  }
}

/** A website category folder: must sit directly inside the website root. */
function websiteFolder_(props, id) {
  var root = websiteRoot_(props);
  var folder = DriveApp.getFolderById(String(id || ''));
  if (folder.isTrashed() || !hasParent_(folder, root.getId())) fail_('not_website_folder');
  return folder;
}

function hasParent_(item, parentId) {
  var parents = item.getParents();
  while (parents.hasNext()) if (parents.next().getId() === parentId) return true;
  return false;
}

/** A file inside a category folder of `root` (and, for Processed Images, not in "_done" etc.). */
function fileIn_(id, root, skipUnderscore) {
  var file = DriveApp.getFileById(String(id || ''));
  if (file.isTrashed()) fail_('not_found');
  var parents = file.getParents();
  while (parents.hasNext()) {
    var parent = parents.next();
    if (skipUnderscore && parent.getName().charAt(0) === '_') continue;
    if (hasParent_(parent, root.getId())) return file;
  }
  fail_('not_allowed', 'file is outside the expected folder');
}

/** Returns the category folder's id, creating it (or renaming it to `name`) as needed. */
function ensureWebsiteFolder_(props, body) {
  var name = String(body.name || '').trim().slice(0, 100);
  if (!name) return reply_({ ok: false, error: 'bad_name' });
  if (body.id) {
    try {
      var folder = websiteFolder_(props, body.id);
      if (folder.getName() !== name) folder.setName(name);
      return reply_({ ok: true, id: folder.getId(), name: folder.getName() });
    } catch (gone) { /* missing or trashed: create a fresh one */ }
  }
  var created = websiteRoot_(props).createFolder(name);
  return reply_({ ok: true, id: created.getId(), name: created.getName() });
}

function uploadWebsite_(props, body) {
  if (WEB_TYPES.indexOf(body.mimeType) === -1) return reply_({ ok: false, error: 'unsupported_type' });
  var folder = websiteFolder_(props, body.folderId);
  var name = String(body.name || 'photo').slice(0, 200);
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.data), body.mimeType, name));
  return reply_({ ok: true, id: file.getId(), name: file.getName(), size: file.getSize() });
}

/** Approving a photo: copies the pipeline's finished image into the website folder (the original stays put). */
function copyToWebsite_(props, body) {
  var source = fileIn_(body.fileId, processedFolder_(props), true);
  var folder = websiteFolder_(props, body.folderId);
  var copy = source.makeCopy(String(body.name || source.getName()).slice(0, 200), folder);
  return reply_({ ok: true, id: copy.getId(), name: copy.getName(), size: copy.getSize(), mimeType: copy.getMimeType() });
}

/** Moving a photo to another website folder: its Drive file moves to that folder too. */
function moveWebsite_(props, body) {
  var file = fileIn_(body.id, websiteRoot_(props), false);
  var folder = websiteFolder_(props, body.folderId);
  file.moveTo(folder);
  return reply_({ ok: true, id: file.getId() });
}

/** Removing a photo from the website: Drive trash, recoverable for 30 days. */
function trashWebsite_(props, body) {
  var file;
  try {
    file = fileIn_(body.id, websiteRoot_(props), false);
  } catch (err) {
    if (err.code === 'not_found') return reply_({ ok: true, alreadyGone: true });
    throw err;
  }
  file.setTrashed(true);
  return reply_({ ok: true });
}

function download_(file) {
  var blob = file.getBlob();
  return reply_({
    ok: true, id: file.getId(), name: file.getName(), mimeType: blob.getContentType(),
    size: file.getSize(), data: Utilities.base64Encode(blob.getBytes())
  });
}

function reply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
