import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import messaging from '@react-native-firebase/messaging';
import { handlePrayerFcmMessage } from './src/utils/prayerFcm';

// 🔥 REQUIRED — DO NOT REMOVE
messaging().setBackgroundMessageHandler(async remoteMessage => {
  const data = remoteMessage.data || {};
  if (await handlePrayerFcmMessage(remoteMessage)) {
    return;
  }

  if (data.type === 'prayer_times_updated') {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const { syncPrayerTimesToLocalScheduler } = require('./src/utils/prayerScheduleSync');

      const timetable = {
        version: parseInt(data.schedule_version || '1', 10),
        adhan: {
          fajr:    data.fajr_adhan,
          dhuhr:   data.dhuhr_adhan,
          asr:     data.asr_adhan,
          maghrib: data.maghrib_adhan,
          isha:    data.isha_adhan,
        },
        prayer: {
          fajr:          data.fajr,
          dhuhr:         data.dhuhr,
          asr:           data.asr,
          maghrib:       data.maghrib,
          isha:          data.isha,
          jummah:        data.jummah,
          jummah_iqamah: data.jummah_iqamah,
        },
      };

      await AsyncStorage.setItem('cached_prayer_timings', JSON.stringify({
        ...timetable,
        early: { sunrise: data.sunrise, taraweeh: data.taraweeh },
      }));
      await syncPrayerTimesToLocalScheduler(timetable);
      console.log(`[BG] Prayer times updated to v${timetable.version}, local alarms rescheduled`);
    } catch (e) {
      console.warn('[BG] Failed to save prayer times from FCM:', e);
    }
  }
});

AppRegistry.registerComponent(appName, () => App);
