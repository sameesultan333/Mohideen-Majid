/**
 * prayerScheduleSync.js
 *
 * Single source of truth for feeding a fetched prayer timetable into the
 * on-device alarm scheduler (PrayerNotificationService). Local Adhan/Iqamah
 * alarms must exist the moment the app has a confirmed timetable, from
 * ANY source (REST fetch, WebSocket push, or FCM) — they cannot depend on
 * an FCM data message successfully arriving, since that can silently fail
 * (permission race, topic-subscription timing, background delivery drops).
 *
 * Every caller shares the same "prayer_schedule_version" AsyncStorage key.
 * That sharing is intentional (screens agree on what's already fetched) but
 * it means only ONE caller must be responsible for consuming a version bump
 * and re-scheduling — call this from every place that fetches prayer times
 * instead of writing the version key manually.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import PrayerNotificationService from "../services/PrayerNotificationService";

export const PRAYER_SCHEDULE_VERSION_KEY = "prayer_schedule_version";

export async function syncPrayerTimesToLocalScheduler(data) {
  if (!data || !data.adhan || !data.prayer) return;
  try {
    const serverVersion = parseInt(data.version || 0, 10);
    if (!serverVersion) return; // unconfigured — nothing to schedule

    const storedVersion = parseInt(
      (await AsyncStorage.getItem(PRAYER_SCHEDULE_VERSION_KEY)) || "0",
      10
    );
    if (serverVersion <= storedVersion) return;

    await PrayerNotificationService.initialize();
    await PrayerNotificationService.savePrayerTimes({
      adhan: data.adhan,
      prayer: data.prayer,
    });
    await AsyncStorage.setItem(PRAYER_SCHEDULE_VERSION_KEY, String(serverVersion));
  } catch (_) {}
}
