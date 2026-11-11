// Gallery photo lists, shared by every component that shows the same gallery. A list is reused for
// MAX_AGE_MS only, so a tab that stays open (or moves between pages without reloading) still picks up
// photos added, removed or reordered in the back office. Back-office changes also clear it at once.
const MAX_AGE_MS = 30 * 1000;
const cache = new Map();   // key -> { at, request }

/** Resolves to the image URLs of a gallery, or [] if unavailable. */
export function fetchGallery(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.request;
  const request = fetch(`/api/gallery/${encodeURIComponent(key)}`, { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : { images: [] }))
    .then((data) => (Array.isArray(data.images) ? data.images : []))
    .catch(() => []);
  cache.set(key, { at: Date.now(), request });
  return request;
}

/** Forgets every cached list (called after a back-office change to website photos). */
export function clearGalleryCache() {
  cache.clear();
}
