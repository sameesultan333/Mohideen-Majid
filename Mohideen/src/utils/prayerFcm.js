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
    color: '#1B5E20',
    userInfo: { prayerKey, type: notifType },
  });
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
