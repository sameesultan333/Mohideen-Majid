/**
 * genericPush.js
 *
 * Foreground FCM messages with a `notification` payload (approval, hadith,
 * questions, answers, announcements, finance) do NOT auto-display on Android
 * or iOS while the app is open — that's only the OS's background/killed
 * behavior. Showing them via Alert.alert() (the previous approach) is
 * silent — no sound, no channel, just a blocking JS dialog — which is why
 * these categories appeared to have "no sound" specifically while the app
 * was in the foreground.
 *
 * This fires a real local notification through the same channel react-native
 * push-notification already owns ('default_channel_id', configured with a
 * sound in PrayerNotificationService.initialize()), so foreground pushes get
 * the same tray banner + sound as background ones.
 */

import PushNotification from 'react-native-push-notification';

export function showGenericPush(title, body, data = {}) {
  if (!title && !body) return;
  PushNotification.localNotification({
    channelId: 'default_channel_id',
    title: title || 'Mohideen Masjid',
    message: body || '',
    playSound: true,
    soundName: 'default',
    vibrate: true,
    smallIcon: 'ic_notification',
    color: '#D4AF37',
    userInfo: data,
  });
}
