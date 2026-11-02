'use strict';

// npm run drive:check — confirms the Google Drive upload bridge (google/drive-upload.gs) is reachable
// and shows which Drive folder contributor uploads will land in. Uploads nothing.

const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

const { isDriveConfigured, pingDrive } = require('../server/drive.js');

const HINTS = {
  drive_not_configured: 'Set DRIVE_UPLOAD_URL and DRIVE_UPLOAD_SECRET in .env.',
  drive_forbidden: 'DRIVE_UPLOAD_SECRET does not match the script property UPLOAD_SECRET.',
  drive_script_not_configured: 'Add the FOLDER_ID and UPLOAD_SECRET script properties in Apps Script.',
  drive_bad_response: 'The URL did not answer like the script. Check it ends in /exec and the deployment has access "Anyone".',
  drive_unreachable: 'Could not reach Google. Check the URL and this server\'s internet access.',
  drive_script_error: 'The script failed. Check FOLDER_ID is the ID of "Unprocessed Garment Images".'
};

(async () => {
  if (!isDriveConfigured()) {
    console.error(HINTS.drive_not_configured);
    process.exit(1);
  }
  try {
    const { folderName, processedFolderName, websiteFolderName, version } = await pingDrive();
    console.log(`Connected. Contributor uploads go to the Drive folder: "${folderName}"`);
    if (folderName !== 'Unprocessed Garment Images') {
      console.warn('Warning: expected "Unprocessed Garment Images". Check the script\'s FOLDER_ID.');
    }
    if (processedFolderName) {
      console.log(`Finished images for approval are read from: "${processedFolderName}"`);
    } else {
      console.warn('Approval of finished images is not set up yet: add the PROCESSED_FOLDER_ID script property and deploy a new version.');
    }
    if (version < 5) {
      console.warn(`The deployed Apps Script is an older version (${version}); the website needs version 5`
        + (version < 3 ? ' (website photos cannot be stored in Drive yet).' : version < 4 ? ' (moving photos between folders will not work).' : ' (upload status cannot show "Failed").') + '\n'
        + 'Paste the new google/drive-upload.gs, then Deploy -> Manage deployments -> Edit -> Version: New version -> Deploy.');
    } else if (websiteFolderName) {
      console.log(`Website photos are stored in: "${websiteFolderName}"`);
    } else {
      console.log('Website photo storage is ready; the "Fresco Website Images" folder is created on first use (npm run media:migrate).');
    }
  } catch (error) {
    const key = error.code;
    console.error(`Drive check failed: ${error.message}`);
    if (HINTS[key]) console.error(HINTS[key]);
    process.exit(1);
  }
})();
