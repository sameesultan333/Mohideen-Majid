import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import axios from "axios";
import { getToken, saveToken, saveRefreshToken, getRefreshToken, deleteToken, deleteRefreshToken } from "../utils/secureStorage";

const WORKING_SERVER_KEY = "working_server_url";
const DEFAULT_BASE_URL = "http://172.20.10.3:8000";
const DEFAULT_TIMEOUT_MS = 3000;
// File/image uploads (multipart FormData) need much more headroom than plain
// JSON calls — 3s is enough to fail routinely on real mobile networks even
// for a small photo, which is why "Self Pay" and other upload screens were
// intermittently showing "Failed to submit. Check your connection" even
// when the request would have succeeded given a few more seconds.
const UPLOAD_TIMEOUT_MS = 30000;

const CANDIDATE_BASE_URLS = [DEFAULT_BASE_URL];

let cachedBaseUrl = DEFAULT_BASE_URL;
let resolvingPromise = null;

const uniqueUrls = (urls) => {
  const seen = new Set();
  return urls.filter((url) => {
    if (!url || seen.has(url)) {
      return false;
    }
    seen.add(url);
    return true;
  });
};

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const fetchWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller?.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const isReachable = async (baseUrl) => {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/health`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    return response.ok;
  } catch {
    return false;
  }
};

async function resolveBaseUrl(forceRefresh = false) {
  if (!forceRefresh && cachedBaseUrl) {
    return cachedBaseUrl;
  }

  const storedUrl = await AsyncStorage.getItem(WORKING_SERVER_KEY);
  const candidates = uniqueUrls([
    cachedBaseUrl,
    ...CANDIDATE_BASE_URLS,
    storedUrl === DEFAULT_BASE_URL ? storedUrl : null,
  ]);

  for (const candidate of candidates) {
    if (await isReachable(candidate)) {
      cachedBaseUrl = candidate;
      await AsyncStorage.setItem(WORKING_SERVER_KEY, candidate);
      return candidate;
    }
  }

  cachedBaseUrl = DEFAULT_BASE_URL;
  return cachedBaseUrl;
}

export async function getBaseUrl(options = {}) {
  const { forceRefresh = false } = options;

  if (!forceRefresh && cachedBaseUrl) {
    return cachedBaseUrl;
  }

  if (!forceRefresh && resolvingPromise) {
    return resolvingPromise;
  }

  resolvingPromise = resolveBaseUrl(forceRefresh).finally(() => {
    resolvingPromise = null;
  });

  return resolvingPromise;
}

export function getFallbackBaseUrl() {
  return cachedBaseUrl || DEFAULT_BASE_URL;
}

export async function getWsUrl(path, options = {}) {
  const baseUrl = await getBaseUrl(options);
  return `${baseUrl.replace(/^http/i, "ws")}${path}`;
}

export function buildAbsoluteUrl(path, baseUrl = getFallbackBaseUrl()) {
  if (!path) {
    return null;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

const shouldRetryWithFreshBaseUrl = (error) =>
  !error?.response && !!error?.request;

export async function apiAxios(config) {
  const baseUrl = await getBaseUrl();

  try {
    return await axios({
      timeout: DEFAULT_TIMEOUT_MS,
      ...config,
      url: `${baseUrl}${config.url}`,
    });
  } catch (error) {
    if (!shouldRetryWithFreshBaseUrl(error)) {
      throw error;
    }

    const freshBaseUrl = await getBaseUrl({ forceRefresh: true });
    if (freshBaseUrl === baseUrl) {
      throw error;
    }

    return axios({
      timeout: DEFAULT_TIMEOUT_MS,
      ...config,
      url: `${freshBaseUrl}${config.url}`,
    });
  }
}

export async function apiFetch(path, init = {}) {
  const baseUrl = await getBaseUrl();
  const { timeoutMs, ...fetchInit } = init;
  const effectiveTimeout =
    timeoutMs ?? (fetchInit.body instanceof FormData ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

  try {
    return await fetchWithTimeout(`${baseUrl}${path}`, fetchInit, effectiveTimeout);
  } catch (error) {
    const freshBaseUrl = await getBaseUrl({ forceRefresh: true });
    if (freshBaseUrl === baseUrl) {
      throw error;
    }

    return fetchWithTimeout(`${freshBaseUrl}${path}`, fetchInit, effectiveTimeout);
  }
}

export async function warmServerConnection() {
  try {
    await getBaseUrl({ forceRefresh: true });
  } catch {
    await delay(0);
  }
}

let _refreshing = null;

async function tryRefreshToken() {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token');
    const baseUrl = await getBaseUrl();
    const res = await axios({
      method: 'post',
      url: `${baseUrl}/auth/refresh`,
      headers: { 'X-Refresh-Token': refreshToken },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await saveToken(res.data.access_token);
    if (res.data.refresh_token) await saveRefreshToken(res.data.refresh_token);
    return res.data.access_token;
  })().finally(() => { _refreshing = null; });
  return _refreshing;
}

/**
 * Like apiAxios but automatically attaches the stored JWT as Authorization header.
 * On 401, attempts one token refresh then retries. If refresh fails, clears tokens.
 */
/**
 * Like apiFetch but auto-attaches the JWT and retries once after a token refresh on 401.
 * Use this everywhere you previously did apiFetch + manual Authorization header.
 */
export async function authApiFetch(path, init = {}) {
  const token = await getToken();
  const headers = {
    ...(init.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await apiFetch(path, { ...init, headers });
  if (res.status !== 401) return res;
  try {
    const newToken = await tryRefreshToken();
    const retryHeaders = { ...(init.headers || {}), Authorization: `Bearer ${newToken}` };
    return apiFetch(path, { ...init, headers: retryHeaders });
  } catch {
    await deleteToken();
    await deleteRefreshToken();
    throw new Error('Session expired — please log in again');
  }
}

export async function authApiAxios(config) {
  const token = await getToken();
  const headers = {
    ...(config.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  try {
    return await apiAxios({ ...config, headers });
  } catch (error) {
    if (error?.response?.status !== 401) throw error;
    try {
      const newToken = await tryRefreshToken();
      const retryHeaders = { ...(config.headers || {}), Authorization: `Bearer ${newToken}` };
      return await apiAxios({ ...config, headers: retryHeaders });
    } catch {
      await deleteToken();
      await deleteRefreshToken();
      throw error;
    }
  }
}

export { DEFAULT_BASE_URL };
