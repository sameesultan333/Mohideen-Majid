import { NativeModules, Platform } from 'react-native';
import PushNotification from 'react-native-push-notification';
import PrayerNotificationService from '../services/PrayerNotificationService';

const normalizePrayerKey = (prayerKey) => {
  const key = String(prayerKey || '').trim().toLowerCase();
  return key === 'jumuah' ? 'jummah' : key;
};

function showImmediateNotification({ channelId, title, message, soundName, settings, prayerKey, notifType }) {
  PushNotification.localNotification({
    channelId,
    title,
    message,
    playSound: settings.soundEnabled,
    soundName: settings.soundEnabled ? soundName : undefined,
    vibrate: settings.vibrationEnabled,
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
 * The local alarm is the offline-capable, authoritative trigger. It only
 * needs the FCM push to stand in for it when the local alarm itself is
 * known to be unreliable: no SCHEDULE_EXACT_ALARM permission (Android 13+
 * silently degrades to an inexact alarm Doze can defer arbitrarily), or no
 * local schedule exists yet at all (e.g. first-ever launch before the first
 * sync completes). In every other case the local alarm already has it
 * covered, so the FCM-triggered instant notification is skipped.
 */
async function localAlarmIsTrustworthy() {
  try {
    const [canScheduleExact, cachedTimes] = await Promise.all([
      Platform.OS === 'android' && NativeModules.IqamahScheduler?.canScheduleExactAlarms
        ? NativeModules.IqamahScheduler.canScheduleExactAlarms()
        : true, // no such restriction on iOS
      PrayerNotificationService.getPrayerTimes(),
    ]);
    return !!canScheduleExact && !!cachedTimes;
  } catch {
    // Can't confirm the local alarm is reliable — fall back to the FCM push
    // rather than silently risk missing the Adhan.
    return false;
  }
}

export async function handlePrayerFcmMessage(remoteMessage) {
  const data = remoteMessage?.data || {};
  if (data.type !== 'prayer_notification') return false;

  await PrayerNotificationService.initialize();

  const settings = PrayerNotificationService.settings || {};
  const prayerKey = normalizePrayerKey(data.prayer_key);
  const prayerName = data.prayer_name || 'Prayer';
  const notifType = String(data.notif_type || '').toLowerCase();
  const prayerSettings = settings[prayerKey] || {};

  if (notifType === 'adhan') {
    if (!settings.adhanEnabled || !prayerSettings.adhan) return true;
    // The on-device alarm already covers this prayer — don't double-fire.
    if (await localAlarmIsTrustworthy()) return true;

    if (Platform.OS === 'android' && NativeModules.IqamahScheduler?.showAdhanNow) {
      NativeModules.IqamahScheduler.showAdhanNow(prayerName);
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
    // Same dedup rule as adhan above.
    if (await localAlarmIsTrustworthy()) return true;

    showImmediateNotification({
      channelId: 'prayer_iqamah',
      title: `${prayerName} Iqamah`,
      message: 'Iqamah is starting — join the congregation.',
      soundName: 'start_prayer',
      settings,
      prayerKey,
      notifType,
    });

    return true;
  }

  return false;
}
