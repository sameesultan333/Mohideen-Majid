import { NativeModules, Platform } from 'react-native';
import PushNotification from 'react-native-push-notification';
import PrayerNotificationService from '../services/PrayerNotificationService';

const normalizePrayerKey = (prayerKey) => {
  const key = String(prayerKey || '').trim().toLowerCase();
  return key === 'jumuah' ? 'jummah' : key;
};

function showImmediateNotification({ channelId, title, message, soundName, settings, prayerKey, notifType }) {
  // For adhan and iqamah, always play sound and vibrate
  // This ensures notifications work offline and when backend is down
  const isPrayerNotification = (notifType === 'adhan' || notifType === 'iqamah');

  PushNotification.localNotification({
    channelId,
    title,
    message,
    playSound: isPrayerNotification,
    soundName: isPrayerNotification ? soundName : undefined,
    vibrate: isPrayerNotification,
    smallIcon: 'ic_notification',
    color: '#D4AF37',
    userInfo: { prayerKey, type: notifType },
  });
}

/**
 * The backend's per-minute cron (job_prayer_notifications) sends this same
 * "prayer_notification" FCM data message at the exact adhan/iqamah minute as
 * a reliability fallback — it fires independently of the on-device
 * AlarmManager alarm PrayerNotificationService already scheduled for the
 * identical prayer+time, which is why both used to fire at once (duplicate
 * Adhan/Iqamah).
 *
 * Both paths are allowed to reach the native service. The native event ID
 * claim is the deduplication point, so whichever path arrives first plays the
 * audio and the second path becomes a no-op. This keeps FCM useful when a
 * device has no exact-alarm permission while preserving offline alarms.
 */
export async function handlePrayerFcmMessage(remoteMessage) {
  const data = remoteMessage?.data || {};
  if (data.type !== 'prayer_notification') return false;

  await PrayerNotificationService.initialize();

  const settings = PrayerNotificationService.settings || {};
  const prayerKey = normalizePrayerKey(data.prayer_key);
  const prayerName = data.prayer_name || 'Prayer';
  const notifType = String(data.notif_type || '').toLowerCase();
  const prayerSettings = settings[prayerKey] || {};
  const localDate = new Date();
  const eventId = data.event_id || `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}:${prayerKey}:${notifType}`;

  if (notifType === 'adhan') {
    if (!settings.adhanEnabled || !prayerSettings.adhan) return true;
    if (Platform.OS === 'android' && NativeModules.IqamahScheduler?.showAdhanNow) {
      NativeModules.IqamahScheduler.showAdhanNow(prayerName, eventId);
    } else {
      showImmediateNotification({
        channelId: 'prayer_adhan',
        title: `${prayerName} Adhan`,
        message: `The Adhan for ${prayerName} has begun.`,
        soundName: 'adhan',
        settings,
        prayerKey,
        notifType,
      });
    }

    return true;
  }

  if (notifType === 'iqamah') {
    if (!settings.iqamahEnabled || !prayerSettings.iqamah) return true;
    if (Platform.OS === 'android' && NativeModules.IqamahScheduler?.showIqamahNow) {
      NativeModules.IqamahScheduler.showIqamahNow(prayerName, eventId);
    } else {
      showImmediateNotification({
        channelId: 'prayer_iqamah',
        title: `${prayerName} Iqamah`,
        message: 'Iqamah is starting — join the congregation.',
        soundName: 'start_prayer',
        settings,
        prayerKey,
        notifType,
      });
    }

    return true;
  }

  return false;
}
