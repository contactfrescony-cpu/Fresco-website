/**
 * Fresco NY — Enquiries Sheet bridge (Google Apps Script).
 *
 * The website saves every Contact-page enquiry in its own database (the master copy) and then sends it
 * here, so the team also has it in a Google Sheet. Each enquiry is one row, found by its ID in column A:
 * a new enquiry adds a row; a status/assignment change made on the back-office Enquiries page updates
 * that same row. Sending the same enquiry twice never creates a duplicate.
 * The script runs as the Fresco NY Google account, so the website never holds Google credentials.
 *
 * SETUP — signed in to Google as the Fresco NY account:
 *  1. Create a Google Sheet, e.g. "Fresco NY Enquiries".
 *  2. In that Sheet: Extensions -> Apps Script. Replace the code with this file and Save.
 *  3. Project Settings (gear icon) -> Script properties -> Add:
 *       SHEET_SECRET  a long random string; put the SAME value in SHEETS_WEBHOOK_SECRET on the website server
 *     Optional:
 *       SHEET_NAME    the tab to write to (default "Enquiries"; created with headings if missing)
 *  4. Deploy -> New deployment -> Select type: Web app
 *       Execute as: Me      Who has access: Anyone
 *     Deploy -> Authorize access (choose the Fresco NY account; "Advanced" -> "Go to ..." if Google warns).
 *  5. Copy the Web app URL (ends in /exec) into SHEETS_WEBHOOK_URL on the website server.
 *  6. On the server run:  npm run sheets:check
 *
 * After changing this code: Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy.
 * The URL stays the same. "Anyone" access is safe because every request must carry SHEET_SECRET.
 * Staff may add their own columns to the right of the headings below; the script only writes these.
 */

var VERSION = 1;
var DEFAULT_SHEET_NAME = 'Enquiries';
var HEADERS = ['ID', 'Received', 'Company', 'Email', 'Phone', 'Purpose', 'Message', 'Country', 'Status', 'Assigned to', 'Website link'];
var MAX_ROWS_PER_CALL = 100;

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('SHEET_SECRET');
    if (!secret) return reply_({ ok: false, error: 'script_not_configured' });

    var body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== secret) return reply_({ ok: false, error: 'forbidden' });

    switch (body.action) {
      case 'ping': return ping_(props);
      case 'upsert': return upsert_(props, body.rows);
      default: return reply_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return reply_({ ok: false, error: 'script_error', detail: String((err && err.message) || err).slice(0, 200) });
  }
}

/**
 * Run this once from the editor (select "setup" in the toolbar -> Run). It asks Google for permission,
 * creates the Enquiries tab with its headings and checks the secret is set. Safe to run again.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var sheet = sheet_(props);
  LockService.getScriptLock();   // makes Google ask for every permission the web app needs
  var secret = props.getProperty('SHEET_SECRET');
  Logger.log('Sheet ready: "' + spreadsheet_().getName() + '", tab "' + sheet.getName() + '".');
  Logger.log(secret ? 'SHEET_SECRET is set (' + secret.length + ' characters).'
    : 'SHEET_SECRET is missing: add it under Project Settings -> Script properties.');
}

function reply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function spreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open Apps Script from the Sheet (Extensions -> Apps Script) so the script belongs to it.');
  return ss;
}

/** The enquiries tab, created with bold, frozen headings the first time. */
function sheet_(props) {
  var ss = spreadsheet_();
  var name = props.getProperty('SHEET_NAME') || DEFAULT_SHEET_NAME;
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('dd mmm yyyy hh:mm');
  }
  return sheet;
}

function ping_(props) {
  var sheet = sheet_(props);
  return reply_({
    ok: true,
    version: VERSION,
    spreadsheetName: spreadsheet_().getName(),
    sheetName: sheet.getName(),
    rows: Math.max(sheet.getLastRow() - 1, 0)
  });
}

/**
 * Text that a spreadsheet would treat as a formula or number (=, +, -, @) is stored as plain text,
 * so a visitor cannot plant a formula and phone numbers keep their leading "+".
 */
function safeText_(value) {
  var text = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function rowValues_(row) {
  return [
    Number(row.id),
    row.receivedAt ? new Date(row.receivedAt) : '',
    safeText_(row.company),
    safeText_(row.email),
    safeText_(row.phone),
    safeText_(row.purpose),
    safeText_(row.message),
    safeText_(row.country),
    safeText_(row.status),
    safeText_(row.assignedTo),
    safeText_(row.link)
  ];
}

/** Adds or updates rows by enquiry ID. Returns the IDs written. */
function upsert_(props, rows) {
  if (!Array.isArray(rows) || !rows.length) return reply_({ ok: true, ids: [] });
  if (rows.length > MAX_ROWS_PER_CALL) return reply_({ ok: false, error: 'too_many_rows' });

  // One writer at a time, so two enquiries arriving together cannot claim the same empty row.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = sheet_(props);
    var lastRow = sheet.getLastRow();
    var rowById = {};
    if (lastRow > 1) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0] !== '' && ids[i][0] != null) rowById[String(ids[i][0])] = i + 2;
      }
    }

    var written = [];
    var appended = [];
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      var id = Number(row && row.id);
      if (!id || id < 1 || Math.floor(id) !== id) continue;
      var values = rowValues_(row);
      var existing = rowById[String(id)];
      if (existing) {
        sheet.getRange(existing, 1, 1, values.length).setValues([values]);
      } else {
        appended.push(values);
        rowById[String(id)] = -1;   // a repeat of the same ID in this call is not appended twice
      }
      written.push(id);
    }
    if (appended.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, HEADERS.length).setValues(appended);
    }
    SpreadsheetApp.flush();
    return reply_({ ok: true, ids: written });
  } finally {
    lock.releaseLock();
  }
}
