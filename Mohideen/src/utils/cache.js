/**
 * Cache-first offline hook.
 *
 * Strategy:
 *  1. Immediately load from AsyncStorage → render UI right away
 *  2. Race network request against timeout (default 4 s)
 *  3. If network wins → update UI + cache
 *  4. If timeout/error → stay on cached data + set isOffline=true
 *
 * Usage:
 *   const { data, loading, isOffline, lastUpdated, refresh } =
 *     useCache("prayer_times", () => apiAxios({ url: "/prayer/" }).then(r => r.data));
 */

import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const NETWORK_TIMEOUT_MS = 4000;

export function useCache(cacheKey, fetcher, { timeout = NETWORK_TIMEOUT_MS, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const hasCacheRef = useRef(false);

  const load = useCallback(async () => {
    // Step 1: immediately show cached data
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw);
        setData(cached);
        setLastUpdated(new Date(ts));
        setLoading(false);
        hasCacheRef.current = true;
      }
    } catch {}

    if (!enabled) {
      setLoading(false);
      return;
    }

    // Step 2: background network fetch with timeout
    try {
      const result = await Promise.race([
        fetcher(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), timeout),
        ),
      ]);
      setData(result);
      setIsOffline(false);
      const now = new Date();
      setLastUpdated(now);
      setLoading(false);
      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({ data: result, ts: now.getTime() }),
      );
    } catch {
      setIsOffline(true);
      setLoading(false);
      // If no cache existed at all, data stays null — screen shows empty state
    }
  }, [cacheKey, enabled, timeout]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    data,
    loading: loading && !hasCacheRef.current,
    isOffline,
    lastUpdated,
    refresh: load,
  };
}

/** Format a Date for the offline banner: "Today 10:42 AM" / "Jul 12 10:42 AM" */
export function formatLastUpdated(date) {
  if (!date) return "";
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  return `${date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ${time}`;
}
