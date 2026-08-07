import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage, type Messaging } from "firebase/messaging";

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBo1cdjgdEjHfyDwKBha0EL5nHh5jEEaTQ",
  authDomain:        "mohideen-masjid.firebaseapp.com",
  projectId:         "mohideen-masjid",
  storageBucket:     "mohideen-masjid.firebasestorage.app",
  messagingSenderId: "676960223561",
  appId:             "1:676960223561:android:cdb148eb87977e153fda98",
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";
// Every other API call in this app goes through the axios client, which targets
// VITE_BACKEND_URL. The browser-push helpers now use the same backend origin so
// registration works both in dev and in production.
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || window.location.origin;

function getApiEndpoint(path: string): string {
  return new URL(path, API_BASE_URL).toString();
}

let _messaging: Messaging | null = null;

function getFirebaseMessaging(): Messaging | null {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return null;
  try {
    const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    if (!_messaging) _messaging = getMessaging(app);
    return _messaging;
  } catch {
    return null;
  }
}

/**
 * Request browser notification permission and return the FCM token.
 * Returns null if permission denied or browser unsupported.
 */
export async function requestBrowserToken(): Promise<string | null> {
  const fcm = getFirebaseMessaging();
  if (!fcm) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    let swRegistration = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
    if (!swRegistration) {
      swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    }
    await navigator.serviceWorker.ready;

    const token = await getToken(fcm, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swRegistration });
    return token || null;
  } catch (e) {
    console.warn("[BrowserPush] getToken failed:", e);
    return null;
  }
}

/**
 * Register browser token with the backend.
 */
export async function registerBrowserToken(token: string, authHeader: string): Promise<void> {
  try {
    await fetch(getApiEndpoint("/user/register-device"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ token, platform: "web", device_name: navigator.userAgent.slice(0, 80) }),
    });
  } catch (e) {
    console.warn("[BrowserPush] registration failed:", e);
  }
}

/**
 * Deregister browser token on logout.
 */
export async function deregisterBrowserToken(token: string, authHeader: string): Promise<void> {
  try {
    await fetch(getApiEndpoint("/user/deregister-device"), {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ token, platform: "web" }),
    });
  } catch {}
}

/**
 * Listen for foreground messages and show a browser notification.
 * Call once after login.
 */
export function listenBrowserMessages(onClick?: (data: Record<string, string>) => void): () => void {
  const fcm = getFirebaseMessaging();
  if (!fcm) return () => {};

  const unsub = onMessage(fcm, (payload) => {
    const title = payload.notification?.title ?? "Mohideen Masjid";
    const body  = payload.notification?.body  ?? "";
    if (Notification.permission === "granted") {
      const n = new Notification(title, { body, icon: "/favicon.svg" });
      n.onclick = () => { onClick?.(payload.data as Record<string, string> ?? {}); };
    }
  });

  return unsub;
}
