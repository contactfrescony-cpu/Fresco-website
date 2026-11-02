'use strict';

// Talks to Google Drive through the Apps Script bridge (google/drive-upload.gs):
//   - sends raw garment photos to "Unprocessed Garment Images" for the image pipeline;
//   - lists and downloads the pipeline's finished images from "Processed Images/<category>/" for review;
//   - stores the website's product photos in "Fresco Website Images/<category>/" (Drive is the storage).
// The website holds no Google credentials: the script runs as the Fresco NY Google account.
//
//   DRIVE_UPLOAD_URL     the Apps Script web-app URL (ends in /exec)
//   DRIVE_UPLOAD_SECRET  shared secret; the same value is the script's UPLOAD_SECRET property

const TIMEOUT_MS = 120 * 1000;

function isDriveConfigured(env = process.env) {
  return Boolean(env.DRIVE_UPLOAD_URL && env.DRIVE_UPLOAD_SECRET);
}

class DriveError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

async function callScript(payload, env = process.env) {
  if (!isDriveConfigured(env)) throw new DriveError('drive_not_configured');
  let response;
  try {
    // Apps Script answers a POST with a redirect to the result; fetch follows it automatically.
    response = await fetch(env.DRIVE_UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, secret: env.DRIVE_UPLOAD_SECRET }),
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new DriveError('drive_unreachable', error.name === 'TimeoutError' ? 'timed out' : error.message);
  }
  const result = await response.json().catch(() => null);
  // A non-JSON answer usually means the web app is not deployed with access "Anyone".
  if (!response.ok || !result) throw new DriveError('drive_bad_response', `HTTP ${response.status}`);
  if (!result.ok) throw new DriveError(`drive_${result.error || 'error'}`, result.detail);
  return result;
}

/**
 * Saves one photo into the input folder. Resolves only after Drive confirms the new file id and
 * the stored size matches what was sent; otherwise throws a DriveError.
 */
async function uploadToDrive({ name, mimeType, buffer, description }, env = process.env) {
  const result = await callScript({ action: 'upload', name, mimeType, description, data: buffer.toString('base64') }, env);
  if (!result.id || Number(result.size) !== buffer.length) {
    throw new DriveError('drive_unverified', `id=${result.id || '-'} size=${result.size}`);
  }
  return { id: result.id, name: result.name };
}

/** Checks the connection: the names of the three Drive folders (null where not set up yet). */
async function pingDrive(env = process.env) {
  const result = await callScript({ action: 'ping' }, env);
  return {
    folderName: result.folderName,
    processedFolderName: result.processedFolderName ?? null,
    websiteFolderName: result.websiteFolderName ?? null,
    version: result.version ?? 1
  };
}

/** The pipeline's finished images: [{ id, name, folder, size, created }], newest first. */
async function listProcessed(env = process.env) {
  const result = await callScript({ action: 'listProcessed' }, env);
  return Array.isArray(result.files) ? result.files : [];
}

async function download(action, id, env) {
  const result = await callScript({ action, id }, env);
  const buffer = Buffer.from(result.data || '', 'base64');
  if (!buffer.length || Number(result.size) !== buffer.length) {
    throw new DriveError('drive_unverified', `download size ${buffer.length} != ${result.size}`);
  }
  return { name: result.name, mimeType: result.mimeType, buffer };
}

/** Downloads one finished image from Processed Images (byte count verified). */
const downloadProcessed = (id, env = process.env) => download('downloadProcessed', id, env);

/* ----- Website photo storage: "Fresco Website Images/<category>/" ----- */

/** Returns the Drive folder id for a website category, creating it or renaming it to `name`. */
async function ensureWebsiteFolder({ id, name }, env = process.env) {
  const result = await callScript({ action: 'ensureWebsiteFolder', id: id || null, name }, env);
  if (!result.id) throw new DriveError('drive_unverified', 'no folder id');
  return result.id;
}

/** Uploads a photo into a website folder; resolves to the new Drive file id once the size is confirmed. */
async function uploadWebsiteFile({ folderId, name, mimeType, buffer }, env = process.env) {
  const result = await callScript({ action: 'uploadWebsite', folderId, name, mimeType, data: buffer.toString('base64') }, env);
  if (!result.id || Number(result.size) !== buffer.length) throw new DriveError('drive_unverified', `size=${result.size}`);
  return result.id;
}

/** Copies a finished pipeline image into a website folder (Drive-side copy); resolves to the copy's id. */
async function copyToWebsite({ fileId, folderId, name }, env = process.env) {
  const result = await callScript({ action: 'copyToWebsite', fileId, folderId, name }, env);
  if (!result.id) throw new DriveError('drive_unverified', 'no copy id');
  return { id: result.id, size: Number(result.size) };
}

/** Downloads a website photo (used to refill the local cache). */
const downloadWebsiteFile = (id, env = process.env) => download('downloadWebsite', id, env);

/** Moves a website photo's file into another website folder (needs script version 4). */
async function moveWebsiteFile(id, folderId, env = process.env) {
  try {
    await callScript({ action: 'moveWebsite', id, folderId }, env);
  } catch (error) {
    if (error.code === 'drive_unknown_action') throw new DriveError('drive_script_outdated', 'deploy the new google/drive-upload.gs');
    throw error;
  }
}

/**
 * Where uploaded originals are now: { [id]: 'input' | 'done' | 'failed' | 'missing' | 'elsewhere' }.
 * Resolves to null when the deployed script is older than version 5 (it cannot tell).
 */
async function locateFiles(ids, env = process.env) {
  if (!ids.length) return {};
  try {
    const result = await callScript({ action: 'locateFiles', ids }, env);
    return result.locations || {};
  } catch (error) {
    if (error.code === 'drive_unknown_action') return null;
    throw error;
  }
}

/** Moves a website photo to the Drive trash (recoverable for 30 days). */
async function trashWebsiteFile(id, env = process.env) {
  await callScript({ action: 'trashWebsite', id }, env);
}

module.exports = {
  isDriveConfigured, uploadToDrive, pingDrive, listProcessed, downloadProcessed,
  ensureWebsiteFolder, uploadWebsiteFile, copyToWebsite, downloadWebsiteFile, trashWebsiteFile, moveWebsiteFile, locateFiles, DriveError
};
