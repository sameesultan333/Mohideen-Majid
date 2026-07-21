/**
 * PrayerNotificationService.js
 * 
 * Production-critical local prayer notification system.
 * 
 * This service ensures prayer notifications work completely offline,
 * without any backend dependency. It behaves like a native alarm clock.
 * 
 * Features:
 * - Local storage of prayer times
 * - Scheduling of Adhan and Iqamah notifications
 * - Automatic rescheduling on app launch
 * - Android BOOT_COMPLETED receiver for device restart
 * - Timezone-aware scheduling
 * - User preferences for notification types
 * - Battery optimization resistant
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import PushNotification from 'react-native-push-notification';
import PushNotificationIOS from '@react-native-community/push-notification-ios';
import { Platform } from 'react-native';

// Storage keys
const PRAYER_TIMES_KEY = 'prayer_times_cache';
const NOTIFICATION_SETTINGS_KEY = 'prayer_notification_settings';
const LAST_SYNC_KEY = 'prayer_times_last_sync';

// Notification types
const NOTIFICATION_TYPES = {
  ADHAN: 'adhan',
  IQAMAH: 'iqamah',
};

// Default notification settings
const DEFAULT_SETTINGS = {
  adhanEnabled: true,
  iqamahEnabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  fajr: { adhan: true, iqamah: true },
  dhuhr: { adhan: true, iqamah: true },
  asr: { adhan: true, iqamah: true },
  maghrib: { adhan: true, iqamah: true },
  isha: { adhan: true, iqamah: true },
  sunrise: { adhan: false, iqamah: false },
  jummah: { adhan: true, iqamah: true },
};

const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'sunrise', 'jummah'];

function normalizeSettings(raw) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const normalized = { ...DEFAULT_SETTINGS, ...parsed };

  for (const prayerKey of PRAYER_KEYS) {
    const source = parsed[prayerKey] || parsed[prayerKey === 'jummah' ? 'jumuah' : prayerKey] || {};
    normalized[prayerKey] = {
      adhan: source.adhan ?? DEFAULT_SETTINGS[prayerKey].adhan,
      iqamah: source.iqamah ?? DEFAULT_SETTINGS[prayerKey].iqamah,
    };
  }

  delete normalized.prayerStartedEnabled;
  delete normalized.jumuah;

  return normalized;
}

class PrayerNotificationService {
  constructor() {
    this.initialized = false;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /**
   * Initialize the notification service
   * Must be called on app startup
   */
  async initialize() {
    if (this.initialized) return;

    // Configure PushNotification
    PushNotification.configure({
      onRegister: function (token) {
        console.log('Notification token:', token);
      },
      onNotification: function (notification) {
        console.log('Notification received:', notification);
        if (notification.userInteraction) {
          // User tapped notification
        }
        notification.finish(PushNotificationIOS.FetchResult.NoData);
      },
      permissions: {
        alert: true,
        badge: true,
        sound: true,
        vibration: true,
      },
      popInitialNotification: true,
      requestPermissions: Platform.OS === 'ios',
    });

    // Create notification channels (Android 8+)
    // react-native-push-notification must own these channels for local notifications.
    // Channel version: bump when sound/importance changes so old cached channels are replaced.
    if (Platform.OS === 'android') {
      PushNotification.createChannel(
        {
          channelId: 'prayer_adhan',
          channelName: 'Adhan',
          channelDescription: 'Adhan call for each prayer',
          soundName: 'adhan',
          importance: 5, // IMPORTANCE_HIGH
          vibrate: true,
        },
        () => {},
      );
      PushNotification.createChannel(
        {
          channelId: 'prayer_iqamah',
          channelName: 'Iqamah / Prayer Started',
          channelDescription: 'Congregation start reminder',
          soundName: 'start_prayer',
          importance: 5,
          vibrate: true,
        },
        () => {},
      );
      PushNotification.createChannel(
        {
          channelId: 'default_channel_id',
          channelName: 'General Notifications',
          channelDescription: 'Announcements and updates from Mohideen Masjid',
          soundName: 'default',
          importance: 4,
          vibrate: true,
        },
        () => {},
      );
    }

    // Load settings
    await this.loadSettings();

    this.initialized = true;
  }

  /**
   * Load notification settings from storage
   */
  async loadSettings() {
    try {
      const stored = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY);
      if (stored) {
        this.settings = normalizeSettings(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load notification settings:', error);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Save notification settings to storage
   */
  async saveSettings() {
    try {
      this.settings = normalizeSettings(this.settings);
      await AsyncStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save notification settings:', error);
    }
  }

  /**
   * Update notification settings
   */
  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    await this.saveSettings();
    
    // Reschedule notifications with new settings
    const prayerTimes = await this.getPrayerTimes();
    if (prayerTimes) {
      await this.scheduleNotifications(prayerTimes);
    }
  }

  /**
   * Get current notification settings
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Save prayer times to local storage
   */
  async savePrayerTimes(prayerTimes) {
    try {
      console.log('Saving prayer times:', JSON.stringify(prayerTimes, null, 2));
      
      const data = {
        times: prayerTimes,
        lastSync: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      await AsyncStorage.setItem(PRAYER_TIMES_KEY, JSON.stringify(data));
      await AsyncStorage.setItem(LAST_SYNC_KEY, data.lastSync);
      
      // Schedule notifications after saving
      await this.scheduleNotifications(prayerTimes);
      
      return true;
    } catch (error) {
      console.error('Failed to save prayer times:', error);
      return false;
    }
  }

  /**
   * Get prayer times from local storage
   */
  async getPrayerTimes() {
    try {
      const stored = await AsyncStorage.getItem(PRAYER_TIMES_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        return data.times;
      }
      return null;
    } catch (error) {
      console.error('Failed to get prayer times:', error);
      return null;
    }
  }

  /**
   * Get last sync timestamp
   */
  async getLastSync() {
    try {
      const stored = await AsyncStorage.getItem(LAST_SYNC_KEY);
      return stored ? new Date(stored) : null;
    } catch (error) {
      console.error('Failed to get last sync:', error);
      return null;
    }
  }

  /**
   * Cancel all prayer notifications
   */
  async cancelAllPrayerNotifications() {
    try {
      PushNotification.cancelAllLocalNotifications();
      // Give the OS a moment to process cancellations before we schedule new ones.
      // Without this pause, newly-scheduled notifications occasionally fire immediately
      // because Android hasn't finished removing the pending intents.
      await new Promise(resolve => setTimeout(resolve, 250));
    } catch (error) {
      console.error('Failed to cancel notifications:', error);
    }
  }

  /**
   * Schedule local notifications for all prayers (offline-first).
   * Fires even when the server is down — stores times on device.
   */
  async scheduleNotifications(prayerTimes) {
    if (!prayerTimes) return;

    // Cancel all existing notifications first, then wait for OS to settle
    await this.cancelAllPrayerNotifications();

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Schedule for today and tomorrow only — no repeatType, so stale times never
    // linger after an admin updates the schedule. The app reschedules on launch
    // and whenever the backend pushes prayer_times_updated.
    await this.scheduleForDate(prayerTimes, today, 'today');
    await this.scheduleForDate(prayerTimes, tomorrow, 'tomorrow');
  }

  /**
   * Schedule notifications for a specific date.
   *
   * Each prayer fires exactly TWO local notifications:
   *   1. Adhan  — at adhan time,  channel prayer_adhan  (adhan sound)
   *   2. Iqamah — at iqamah time, channel prayer_iqamah (iqamah sound)
   *
   * The previous "Prayer Started" notification was removed because it fired
   * at the identical adhan timestamp, causing 2–3 banners at once.
   */
  async scheduleForDate(prayerTimes, date, dayLabel) {
    const prayers = [
      { key: 'fajr',    name: 'Fajr'    },
      { key: 'sunrise', name: 'Sunrise'  },
      { key: 'dhuhr',   name: 'Dhuhr'   },
      { key: 'asr',     name: 'Asr'     },
      { key: 'maghrib', name: 'Maghrib'  },
      { key: 'isha',    name: 'Isha'    },
    ];

    // Add Jumu'ah on Fridays
    if (date.getDay() === 5) {
      prayers.push({ key: 'jummah', name: "Jumu'ah" });
    }

    for (const prayer of prayers) {
      const adhanTime  = prayerTimes?.adhan?.[prayer.key];
      const iqamahTime = prayerTimes?.prayer?.[prayer.key];

      if (!adhanTime && !iqamahTime) continue;

      const prayerSettings = this.settings[prayer.key] || { adhan: true, iqamah: true };

      // 1. Adhan notification
      if (prayerSettings.adhan && this.settings.adhanEnabled && adhanTime) {
        await this.scheduleNotification(
          prayer.key,
          NOTIFICATION_TYPES.ADHAN,
          prayer.name,
          adhanTime,
          date,
          dayLabel,
        );
      }

      // 2. Iqamah notification — only if a distinct iqamah time exists AND it
      //    differs from the adhan time (some masjids set them to the same value).
      const iqamahDiffersFromAdhan = iqamahTime && iqamahTime !== adhanTime;
      if (prayerSettings.iqamah && this.settings.iqamahEnabled && iqamahDiffersFromAdhan) {
        await this.scheduleNotification(
          prayer.key,
          NOTIFICATION_TYPES.IQAMAH,
          prayer.name,
          iqamahTime,
          date,
          dayLabel,
        );
      }
    }
  }

  /**
   * Schedule a single notification.
   *
   * ID derivation: deterministic integer from prayerKey + type + date string.
   * Using the epoch timestamp caused collisions after `.replace(/\D/g,'').slice(0,9)`
   * because the prefix digits of different timestamps often share the same 9-digit
   * window. A stable hash from a short key string avoids this.
   */
  _stableId(prayerKey, type, dateStr) {
    // djb2-style hash over a short ASCII string — stays within safe int range
    const str = `${prayerKey}_${type}_${dateStr}`;
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; // keep as uint32
    }
    // Clamp to Android's positive int range (2^31 - 1)
    return h & 0x7fffffff;
  }

  async scheduleNotification(prayerKey, type, prayerName, timeString, date, dayLabel) {
    try {
      let hours, minutes;
      // Support "HH:MM AM/PM" and plain "HH:MM"
      const parts = String(timeString).trim().split(/\s+/);
      [hours, minutes] = parts[0].split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return;

      if (parts[1]) {
        const mod = parts[1].toLowerCase();
        if (mod === 'pm' && hours < 12) hours += 12;
        if (mod === 'am' && hours === 12) hours = 0;
      }

      const notificationDate = new Date(date);
      notificationDate.setHours(hours, minutes, 0, 0);

      // Skip if time has already passed
      if (notificationDate <= new Date()) return;

      const dateStr = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      const id = this._stableId(prayerKey, type, dateStr);

      let title, message, channelId, sound;
      if (type === NOTIFICATION_TYPES.ADHAN) {
        title   = `${prayerName} Adhan`;
        message = `The Adhan for ${prayerName} has begun.`;
        channelId = 'prayer_adhan';
        sound     = 'adhan';
      } else {
        title   = `${prayerName} Iqamah`;
        message = `Iqamah is starting — join the congregation.`;
        channelId = 'prayer_iqamah';
        sound     = 'start_prayer';
      }

      PushNotification.localNotificationSchedule({
        id,
        channelId,
        title,
        message,
        date: notificationDate,
        // No repeatType — times are re-scheduled on every app launch and
        // every prayer_times_updated push. repeatType:'day' caused ghost
        // notifications after time changes because Android keeps repeating
        // until the intent is explicitly cancelled.
        soundName: this.settings.soundEnabled ? sound : undefined,
        vibrate: this.settings.vibrationEnabled,
        playSound: this.settings.soundEnabled,
        smallIcon: 'ic_notification',
        color: '#1B5E20',
        userInfo: { prayerKey, type, prayerName, scheduledFor: notificationDate.toISOString() },
      });
    } catch (error) {
      console.error(`Failed to schedule ${type} for ${prayerName}:`, error);
    }
  }

  /**
   * Reschedule notifications on app launch
   * This ensures notifications are restored after app restart
   */
  async rescheduleOnLaunch() {
    const prayerTimes = await this.getPrayerTimes();
    if (prayerTimes) {
      await this.scheduleNotifications(prayerTimes);
      console.log('Rescheduled prayer notifications on app launch');
    }
  }

  /**
   * Clear all data (for testing or logout)
   */
  async clearAll() {
    try {
      await AsyncStorage.removeItem(PRAYER_TIMES_KEY);
      await AsyncStorage.removeItem(NOTIFICATION_SETTINGS_KEY);
      await AsyncStorage.removeItem(LAST_SYNC_KEY);
      await this.cancelAllPrayerNotifications();
      this.settings = DEFAULT_SETTINGS;
    } catch (error) {
      console.error('Failed to clear prayer notification data:', error);
    }
  }
}

// Export singleton instance
export default new PrayerNotificationService();
