// One request per gallery folder per visit, shared by every component that shows it.
const cache = new Map();

/** Resolves to the image URLs in a server gallery folder, or [] if unavailable. */
export function fetchGallery(key) {
  if (!cache.has(key)) {
    const request = fetch(`/api/gallery/${encodeURIComponent(key)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { images: [] }))
      .then((data) => (Array.isArray(data.images) ? data.images : []))
      .catch(() => []);
    cache.set(key, request);
  }
  return cache.get(key);
}
