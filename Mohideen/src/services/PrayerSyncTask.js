/**
 * HeadlessJS task: PrayerSyncTask
 * Runs every 1 h via WorkManager (even when app is closed/killed).
 * Checks schedule version → downloads full times only if changed → reschedules alarms.
 */
import { AppRegistry, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PrayerNotificationService from './PrayerNotificationService';
import { getFallbackBaseUrl } from '../config/server';
import { logger } from "../utils/logger";

const TASK_NAME = 'PrayerSyncTask';

const CACHE_KEY   = 'prayer_times_cache';
const VERSION_KEY = 'prayer_schedule_version';

async function fetchWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function PrayerSyncTask() {
  try {
    const BASE_URL = getFallbackBaseUrl();

    // Step 1 — cheap version check
    const versionRes = await fetchWithTimeout(`${BASE_URL}/prayer/version`);
    if (!versionRes.ok) return;
    const { version: serverVersion } = await versionRes.json();

    const storedVersion = parseInt(await AsyncStorage.getItem(VERSION_KEY) || '0', 10);
    if (serverVersion <= storedVersion) {
      logger.log(`[PrayerSync] Up to date (v${storedVersion})`);
      return;
    }

    // Step 2 — download full times
    logger.log(`[PrayerSync] New version ${serverVersion} (had ${storedVersion}) — downloading`);
    const timesRes = await fetchWithTimeout(`${BASE_URL}/prayer/`, 10000);
    if (!timesRes.ok) return;
    const data = await timesRes.json();

    // Step 3 — save
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
      times:    data,
      version:  serverVersion,
      lastSync: new Date().toISOString(),
    }));
    await AsyncStorage.setItem(VERSION_KEY, String(serverVersion));

    // Step 4 — reschedule AlarmManager with new times
    await PrayerNotificationService.initialize();
    await PrayerNotificationService.scheduleNotifications(data);

    logger.log(`[PrayerSync] Rescheduled alarms for v${serverVersion}`);
  } catch (e) {
    logger.warn('[PrayerSync] Sync failed (will retry next cycle):', e?.message);
  }
}

// Register the headless task — without this, PrayerSyncWorker.kt's hourly
// WorkManager job (native) calls into PrayerSyncService, which looks up a
// JS headless task named "PrayerSyncTask" and finds nothing registered,
// so the sync silently never runs. This was the missing link: the native
// side was fully wired correctly, this one line just wasn't here.
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(TASK_NAME, () => PrayerSyncTask);
}

export default PrayerSyncTask;
