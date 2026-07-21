// src/services/auth.ts

import api from './axios';

export interface User {
  id: number;
  name: string;
  phone: string;
  role: string;
  family_id?: number;
  head_phone?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

let accessToken: string | null = null;
let currentUser: User | null = null;

// Singleton promise — prevents multiple simultaneous refresh calls from
// each rotating the token and invalidating the others.
let _refreshPromise: Promise<string> | null = null;

/**
 * Returns the current access token.
 * Never stored in localStorage.
 */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Used internally by axios interceptor.
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Returns logged in user.
 */
export function getCurrentUser(): User | null {
  return currentUser;
}

export function setCurrentUser(user: User | null): void {
  currentUser = user;
}

/**
 * Simple auth state.
 */
export function isAuthenticated(): boolean {
  return accessToken !== null;
}

/**
 * Admin dashboard login — phone + password, superadmin/admin only.
 */
export async function adminLogin(phone: string, password: string): Promise<User> {
  const { data } = await api.post<AuthResponse>('/auth/admin-login', { phone, password });

  accessToken = data.access_token;
  currentUser = data.user;

  // Register browser push token and start foreground listener — non-blocking
  import("../utils/browserPush").then(async ({ requestBrowserToken, registerBrowserToken, listenBrowserMessages }) => {
    try {
      const pushToken = await requestBrowserToken();
      if (pushToken) await registerBrowserToken(pushToken, `Bearer ${data.access_token}`);
      listenBrowserMessages();
    } catch {}
  });

  return data.user;
}

/**
 * Refresh Access Token
 *
 * Refresh cookie is automatically sent
 * because axios uses withCredentials=true.
 */
export async function refreshAccessToken(): Promise<string> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = api
    .post<{ access_token: string; user: User }>('/auth/refresh')
    .then(({ data }) => {
      accessToken = data.access_token;
      currentUser = data.user;
      return data.access_token;
    })
    .finally(() => {
      _refreshPromise = null;
    });

  return _refreshPromise;
}

/**
 * Logout current device.
 */
export async function logout(): Promise<void> {
  try {
    // Deregister browser push token before clearing auth
    const token = accessToken;
    if (token) {
      import("../utils/browserPush").then(async ({ requestBrowserToken, deregisterBrowserToken }) => {
        try {
          const pushToken = await requestBrowserToken();
          if (pushToken) await deregisterBrowserToken(pushToken, `Bearer ${token}`);
        } catch {}
      });
    }
    await api.post('/auth/logout');
  } finally {
    accessToken = null;
    currentUser = null;
  }
}

/**
 * Logout every device.
 */
export async function logoutAll(): Promise<void> {
  try {
    await api.post('/auth/logout-all');
  } finally {
    accessToken = null;
    currentUser = null;
  }
}

/**
 * Active sessions
 */
export async function getSessions() {
  const { data } = await api.get('/auth/sessions');
  return data;
}

/**
 * Revoke one session
 */
export async function revokeSession(sessionId: number) {
  return api.delete(`/auth/sessions/${sessionId}`);
}

/**
 * Clears everything.
 */
export function clearAuth(): void {
  accessToken = null;
  currentUser = null;
}