import AsyncStorage from "@react-native-async-storage/async-storage";
import messaging, { getToken as getFcmToken } from "@react-native-firebase/messaging";
import { deleteToken, deleteRefreshToken } from "./secureStorage";
import { deregisterDevice } from "./fcmRegistration";

/**
 * Clears every local trace of the current session (FCM device registration,
 * secure-storage tokens, cached AsyncStorage keys). Used by both Logout and
 * Delete Account — the only difference between them is what happens on the
 * backend before this runs and what message is shown after. Does not
 * navigate; callers are responsible for `navigation.replace("Login")`.
 */
export async function clearAuthSession() {
  // Best-effort FCM deregistration with a 3s timeout — never block the caller
  try {
    const fcm = messaging();
    const userRaw = await AsyncStorage.getItem("user");
    const userObj = userRaw ? JSON.parse(userRaw) : null;
    const fcmToken = await Promise.race([
      getFcmToken(fcm),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]).catch(() => null);
    if (fcmToken) deregisterDevice(fcm, fcmToken, userObj?.role).catch(() => {});
  } catch {}
  await deleteToken();
  await deleteRefreshToken();
  await AsyncStorage.multiRemove(["user", "chanda_summary"]);
}
