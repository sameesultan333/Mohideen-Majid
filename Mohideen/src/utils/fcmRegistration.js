import { Platform } from "react-native";
import messaging, { subscribeToTopic, unsubscribeFromTopic } from "@react-native-firebase/messaging";
import { getToken } from "./secureStorage";
import { apiAxios } from "../config/server";
import { logger } from "./logger";

// Role → FCM topic mapping
const ROLE_TOPICS = {
  admin:     ["admins"],
  superadmin:["admins", "superadmins"],
  imam:      ["imams"],
  collector: ["collectors"],
  head:      ["members"],
  member:    ["members"],
};

/**
 * Register or refresh the FCM device token with the backend.
 * Safe to call on every app launch — backend upserts by (user_id, token).
 */
export async function registerFcmToken(fcmToken, role, preFetchedAuthToken) {
  try {
    const authToken = preFetchedAuthToken || (await getToken());
    if (!authToken || !fcmToken) return;

    await apiAxios({
      method: "post",
      url: "/user/register-device",
      data: {
        token: fcmToken,
        platform: Platform.OS,
        device_name: Platform.OS === "android" ? "Android Device" : "iOS Device",
        app_version: "1.0.0",
      },
      headers: { Authorization: `Bearer ${authToken}` },
    });
  } catch (e) {
    logger.log("[FCM] Device registration failed:", e?.message);
  }
}

/**
 * Subscribe to role-specific FCM topics after login.
 * Call with the messaging() instance from @react-native-firebase/messaging.
 */
export async function subscribeRoleTopics(fcmInstance, role) {
  const topics = ROLE_TOPICS[role] || [];
  for (const topic of topics) {
    try {
      await subscribeToTopic(fcmInstance, topic);
      logger.log(`[FCM] Subscribed to topic: ${topic}`);
    } catch (e) {
      logger.log(`[FCM] Failed to subscribe to ${topic}:`, e?.message);
    }
  }
}

/**
 * Unsubscribe from role topics and deregister device on logout.
 */
export async function deregisterDevice(fcmInstance, fcmToken, role) {
  // Unsubscribe from role topics
  const topics = ROLE_TOPICS[role] || [];
  for (const topic of topics) {
    try {
      await unsubscribeFromTopic(fcmInstance, topic);
    } catch {}
  }

  // Mark token inactive on backend
  try {
    const authToken = await getToken();
    if (!authToken || !fcmToken) return;
    await apiAxios({
      method: "delete",
      url: "/user/deregister-device",
      data: { token: fcmToken, platform: Platform.OS },
      headers: { Authorization: `Bearer ${authToken}` },
    });
  } catch {}
}
