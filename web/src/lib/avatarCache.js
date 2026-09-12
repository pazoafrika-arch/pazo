import { api, getAccessToken } from './api.js';

/**
 * Shared cache of avatar and logo object URLs.
 *
 * The image endpoints require an Authorization header, which a plain <img src>
 * cannot send, so the bytes are fetched and handed to the browser as an object
 * URL. Without a cache, a partner table of fifty rows would fire fifty
 * requests, and every re-render would fire them again.
 *
 * Entries are keyed by kind and id. In-flight requests are shared, so ten
 * components mounting at once still make one request.
 */

const cache = new Map(); // key -> object URL (or null when there is no image)
const inflight = new Map(); // key -> Promise

const pathFor = (kind, id) =>
  kind === 'business' ? `/media/business-logo/${id}` : `/media/avatar/${id}`;

const keyFor = (kind, id) => `${kind}:${id}`;

/**
 * Resolve an image URL, fetching it once and reusing it thereafter.
 * Resolves to null when the subject has no image, which callers render as a
 * monogram.
 */
export function loadAvatar(kind, id) {
  const key = keyFor(kind, id);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);

  const token = getAccessToken();
  if (!token) return Promise.resolve(null);

  const request = fetch(`${api.base}${pathFor(kind, id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (res) => {
      if (!res.ok) {
        // 404 simply means "no picture", which is a normal, cacheable answer.
        cache.set(key, null);
        return null;
      }
      const url = URL.createObjectURL(await res.blob());
      cache.set(key, url);
      return url;
    })
    .catch(() => {
      cache.set(key, null);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

/**
 * Forget one subject's image so the next render refetches it.
 * Called after an upload or removal, including by an admin editing someone
 * else, so every list showing that person updates.
 */
export function invalidateAvatar(kind, id) {
  const key = keyFor(kind, id);
  const existing = cache.get(key);
  if (existing) URL.revokeObjectURL(existing);
  cache.delete(key);
  inflight.delete(key);
  notify(key);
}

/* ---- subscriptions, so mounted components repaint on a change ---- */

const listeners = new Set();

function notify(key) {
  for (const fn of listeners) fn(key);
}

export function onAvatarChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Drop everything, e.g. on sign-out so the next user sees their own images. */
export function clearAvatarCache() {
  for (const url of cache.values()) if (url) URL.revokeObjectURL(url);
  cache.clear();
  inflight.clear();
  notify('*');
}
