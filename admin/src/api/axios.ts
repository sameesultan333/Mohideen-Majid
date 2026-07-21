import axios from 'axios';

import type {
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';

import {
  getAccessToken,
  setAccessToken,
  clearAuth,
  refreshAccessToken,
} from './auth';

// In dev, requests go through the Vite proxy (same origin → cookies work).
// In production, set VITE_BACKEND_URL to the real backend URL.
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Required for HttpOnly refresh cookie
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

function processQueue(error: unknown, token?: string) {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else if (token) {
      promise.resolve(token);
    }
  });

  failedQueue = [];
}

/* -------------------------------------------------------------------------- */
/* Request Interceptor                                                        */
/* -------------------------------------------------------------------------- */

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

/* -------------------------------------------------------------------------- */
/* Response Interceptor                                                       */
/* -------------------------------------------------------------------------- */

api.interceptors.response.use(
  (response) => response,

  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (!originalRequest) {
      return Promise.reject(error);
    }

    const status = error.response?.status;

    // Already retried once
    if (originalRequest._retry) {
      clearAuth();
      return Promise.reject(error);
    }

    if (status !== 401) {
      return Promise.reject(error);
    }

    // Prevent refresh loop
    if (
      originalRequest.url?.includes('/auth/refresh') ||
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/admin-login')
    ) {
      clearAuth();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          },
          reject,
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const newToken = await refreshAccessToken();

      setAccessToken(newToken);

      processQueue(null, newToken);

      originalRequest.headers.Authorization = `Bearer ${newToken}`;

      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError);

      clearAuth();

      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;