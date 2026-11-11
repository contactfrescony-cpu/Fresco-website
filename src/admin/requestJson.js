/**
 * Calls a back-office JSON API and always resolves to { ok, body, error, configured } — never throws,
 * so pages can show the server's exact error message instead of failing silently.
 */
export async function requestJson(url, options = {}) {
  try {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let body = null;
    try { body = await response.json(); } catch { /* non-JSON error page */ }
    if (response.status === 401) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    if (!response.ok || !body?.success) {
      const fallback = response.status === 403
        ? 'Your account does not have access to this.'
        : `Request failed (HTTP ${response.status}).`;
      return { ok: false, configured: body?.configured, error: body?.error && body.error !== 'forbidden' ? body.error : fallback };
    }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: `Could not reach the server: ${err.message}` };
  }
}

/** JSON body helper for POST/PUT (the API only accepts application/json, which blocks CSRF). */
export const jsonBody = (method, data) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data ?? {})
});
