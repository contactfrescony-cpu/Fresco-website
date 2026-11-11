/**
 * Fresco NY — Insights feed bridge (Google Apps Script).
 *
 * The Insights page shows blog posts that the team drops into Google Drive. This script reads them:
 *   - one parent Drive folder, with one sub-folder per Insights tab, named like the tab:
 *       Fabric innovation, Dyeing & washing, Sustainable chemistry, Green energy,
 *       Automation, Print-on-demand, AI & digital supply chain, Market developments
 *   - each blog is one .json file in its tab's folder:
 *       { "id": "20261111-0930-dyeing-washing", "tab": "Dyeing & washing", "title": "...",
 *         "description": "...", "image": "https://...", "link": "https://..." }
 *   - each folder keeps the 20 newest blogs; when more are uploaded, the oldest files are moved to the
 *     Drive trash (recoverable for 30 days).
 * "Newest" is decided by the date at the start of the id (YYYYMMDD or YYYYMMDD-HHMM), falling back to the
 * file's upload time. The script runs as the Fresco NY Google account, so the website holds no Google credentials.
 *
 * SETUP — signed in to Google as the Fresco NY account:
 *  1. Go to script.google.com -> New project. Replace the code with this file and Save.
 *  2. Project Settings (gear icon) -> Script properties -> Add:
 *       INSIGHTS_SECRET     a long random string; put the SAME value in INSIGHTS_FEED_SECRET on the website server
 *     (INSIGHTS_FOLDER_ID is filled in by the next step; if you made the Drive folders by hand, set it to the
 *     parent folder's ID instead: drive.google.com/drive/folders/<ID>)
 *  3. Select "createFolders" in the toolbar -> Run, and approve the permissions. It creates "Fresco Insights" and
 *     the 8 tab folders in this account's Drive.
 *  4. Optional: run "setup" to log which folders it found.
 *  5. Deploy -> New deployment -> Select type: Web app
 *       Execute as: Me      Who has access: Anyone
 *  6. Copy the Web app URL (ends in /exec) into INSIGHTS_FEED_URL on the website server.
 *  7. On the server run:  npm run insights:check
 *
 * After changing this code: Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy.
 * "Anyone" access is safe because every request must carry INSIGHTS_SECRET.
 */

var VERSION = 1;
var MAX_PER_TAB = 20;
var TABS = [
  'Fabric innovation', 'Dyeing & washing', 'Sustainable chemistry', 'Green energy',
  'Automation', 'Print-on-demand', 'AI & digital supply chain', 'Market developments'
];

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('INSIGHTS_SECRET');
    if (!secret) return reply_({ ok: false, error: 'script_not_configured' });
    var body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== secret) return reply_({ ok: false, error: 'forbidden' });
    if (body.action === 'ping') return reply_({ ok: true, version: VERSION, folders: foldersFound_(props) });
    if (body.action === 'list') return reply_({ ok: true, version: VERSION, insights: collect_(props) });
    return reply_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return reply_({ ok: false, error: 'script_error', detail: String((err && err.message) || err).slice(0, 200) });
  }
}

/**
 * Run once from the editor while signed in as the Fresco NY account: creates "Fresco Insights" with the
 * 8 tab folders in that account's Drive and saves its ID as INSIGHTS_FOLDER_ID. Safe to run again
 * (it reuses what exists). Skip it if you made the folders yourself and set INSIGHTS_FOLDER_ID by hand.
 */
function createFolders() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('INSIGHTS_FOLDER_ID');
  var parent;
  if (existing) {
    parent = DriveApp.getFolderById(existing);
  } else {
    var found = DriveApp.getFoldersByName('Fresco Insights');
    parent = found.hasNext() ? found.next() : DriveApp.createFolder('Fresco Insights');
    props.setProperty('INSIGHTS_FOLDER_ID', parent.getId());
  }
  var have = tabFolders_(props);
  TABS.forEach(function (tab) { if (!have[tab]) parent.createFolder(tab); });
  Logger.log('Folder ready: ' + parent.getUrl() + ' (INSIGHTS_FOLDER_ID saved).');
  Logger.log(JSON.stringify(foldersFound_(props), null, 1));
}

/** Run once from the editor: asks for permissions and logs which tab folders were found. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  Logger.log(props.getProperty('INSIGHTS_SECRET') ? 'INSIGHTS_SECRET is set.' : 'INSIGHTS_SECRET is missing.');
  Logger.log(JSON.stringify(foldersFound_(props), null, 1));
}

function reply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function norm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

function parent_(props) {
  var id = props.getProperty('INSIGHTS_FOLDER_ID');
  if (!id) throw new Error('INSIGHTS_FOLDER_ID is not set');
  return DriveApp.getFolderById(id);
}

/** { tab name -> Folder or null } matched by name, ignoring case and punctuation. */
function tabFolders_(props) {
  var byName = {};
  var subs = parent_(props).getFolders();
  while (subs.hasNext()) { var f = subs.next(); byName[norm_(f.getName())] = f; }
  var out = {};
  TABS.forEach(function (tab) { out[tab] = byName[norm_(tab)] || null; });
  return out;
}

function foldersFound_(props) {
  var found = tabFolders_(props), out = {};
  Object.keys(found).forEach(function (tab) {
    out[tab] = found[tab] ? { found: true, files: countJson_(found[tab]) } : { found: false };
  });
  return out;
}

function countJson_(folder) {
  var n = 0, files = folder.getFiles();
  while (files.hasNext()) { if (/\.json$/i.test(files.next().getName())) n++; }
  return n;
}

/** Sort key: the date/time digits at the start of the id (YYYYMMDD[HHMM]), else the upload time. */
function sortKey_(id, created) {
  var m = String(id || '').match(/^(\d{4})\D?(\d{2})\D?(\d{2})(?:\D?(\d{2})\D?(\d{2}))?/);
  if (m) return m[1] + m[2] + m[3] + (m[4] || '00') + (m[5] || '00');
  return Utilities.formatDate(created, 'UTC', 'yyyyMMddHHmm');
}

function collect_(props) {
  var folders = tabFolders_(props), result = [];
  Object.keys(folders).forEach(function (tab) {
    var folder = folders[tab];
    if (!folder) return;
    var items = [], files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (!/\.json$/i.test(file.getName())) continue;
      try {
        var blog = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
        items.push({ file: file, key: sortKey_(blog.id, file.getDateCreated()), blog: blog });
      } catch (err) {
        items.push({ file: file, key: '', blog: null });   // unreadable files sort last and are never shown
      }
    }
    items.sort(function (a, b) { return a.key < b.key ? 1 : (a.key > b.key ? -1 : 0); });
    items.forEach(function (item, i) {
      if (i >= MAX_PER_TAB) { item.file.setTrashed(true); return; }      // beyond 20: oldest go to the trash
      if (!item.blog) return;
      result.push({
        id: String(item.blog.id || item.file.getId()),
        tab: tab,                                                          // the folder decides the tab
        title: String(item.blog.title || ''),
        description: String(item.blog.description || ''),
        image: String(item.blog.image || ''),
        link: String(item.blog.link || ''),
        sort: item.key
      });
    });
  });
  return result;
}
