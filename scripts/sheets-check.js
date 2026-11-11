'use strict';

// npm run sheets:check — confirms the Enquiries Google Sheet bridge (google/enquiries-sheet.gs) is reachable,
// shows which Sheet enquiries are copied to, then sends any enquiries the Sheet is still missing.

const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

const { isSheetConfigured, pingSheet, syncSheetNow } = require('../server/enquiries.js');
const { getPool, closePool } = require('../server/db.js');

const HINTS = {
  sheet_not_configured: 'Set SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET in .env.',
  sheet_forbidden: 'SHEETS_WEBHOOK_SECRET does not match the script property SHEET_SECRET.',
  sheet_script_not_configured: 'Add the SHEET_SECRET script property in Apps Script.',
  sheet_bad_response: 'The URL did not answer like the script. Check it ends in /exec and the deployment has access "Anyone".',
  sheet_unreachable: 'Could not reach Google. Check the URL and this server\'s internet access.',
  sheet_script_error: 'The script failed. Make sure it was created from the Sheet itself (Extensions -> Apps Script).'
};

(async () => {
  if (!isSheetConfigured()) {
    console.error(HINTS.sheet_not_configured);
    process.exit(1);
  }
  try {
    const { spreadsheetName, sheetName, rows } = await pingSheet();
    console.log(`Connected. Enquiries are copied to the Google Sheet "${spreadsheetName}", tab "${sheetName}" (${rows} rows).`);
  } catch (error) {
    console.error(`Sheet check failed: ${error.message}`);
    if (HINTS[error.code]) console.error(HINTS[error.code]);
    process.exit(1);
  }
  if (!getPool()) {
    console.log('The database is not configured, so there are no saved enquiries to send.');
    return;
  }
  try {
    const { synced, error } = await syncSheetNow();
    if (error) throw new Error(error);
    console.log(synced ? `Sent ${synced} enquiries that the Sheet was missing.` : 'The Sheet already has every enquiry.');
  } catch (error) {
    console.error(`Sending enquiries failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
})();
