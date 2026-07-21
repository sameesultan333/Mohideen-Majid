/**
 * Offline-First cache utility.
 *
 * Pattern:
 *   1. Try the live API call.
 *   2. On success → save response to localStorage, return {data, fromCache: false}.
 *   3. On failure  → return last cached data with {fromCache: true, cacheTime}.
 *   4. If no cache and API fails → re-throw so callers can show an error.
 */

const CACHE_PREFIX = "masjid_v1_";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export function setCacheEntry<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch (_) {
    // storage quota or private browsing — ignore silently
  }
}

export function getCacheEntry<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch (_) {
    return null;
  }
}

export interface CachedResult<T> {
  data: T;
  fromCache: boolean;
  /** Unix ms timestamp of when the cache was last updated, or null if live. */
  cacheTime: number | null;
}

/**
 * Wraps an API call with offline-first caching.
 *
 * @param cacheKey   Unique key stored in localStorage.
 * @param apiFn      Async function that fetches from the API.
 */
export async function cachedFetch<T>(
  cacheKey: string,
  apiFn: () => Promise<T>,
): Promise<CachedResult<T>> {
  try {
    const data = await apiFn();
    setCacheEntry<T>(cacheKey, data);
    return { data, fromCache: false, cacheTime: null };
  } catch (err) {
    const cached = getCacheEntry<T>(cacheKey);
    if (cached) {
      return { data: cached.data, fromCache: true, cacheTime: cached.timestamp };
    }
    throw err;
  }
}

/** Format a cache timestamp as a human-readable string. */
export function formatCacheAge(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
