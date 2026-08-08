import React, { useEffect, useState } from "react";
import { ActivityIndicator, LogBox, StyleSheet, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import messaging, { onMessage } from "@react-native-firebase/messaging";
import AsyncStorage from "@react-native-async-storage/async-storage";

import AppNavigator from "./src/navigation/AppNavigator";
import { navigationRef } from "./src/navigation/navigationRef";
import { initializeI18n } from "./src/localization";
import { syncPrayerTimesToLocalScheduler } from "./src/utils/prayerScheduleSync";

LogBox.ignoreLogs([
  "react-native-video version 5.x is deprecated and not maintained anymore.",
]);

export default function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        await initializeI18n();
      } finally {
        setIsReady(true);
      }
    };

    initializeApp();

    // Handle FCM messages while app is in foreground
    // (background/killed is handled in index.js setBackgroundMessageHandler)
    const unsubscribe = onMessage(messaging(), async remoteMessage => {
      const data = remoteMessage.data || {};

      if (data.type === 'prayer_times_updated') {
        // Update cached prayer times
        try {
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
        } catch (e) {
          console.warn('[FG] Failed to update prayer times from FCM:', e);
        }
      }

      // prayer_notification FCM is ignored in foreground — local
      // PrayerNotificationService alarms handle adhan/iqamah offline-first.
    });

    return unsubscribe;
  }, []);

  if (!isReady) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#0F5C4C" />
        </View>
      </SafeAreaProvider>
    );
  }

  // SafeAreaProvider must wrap the whole tree: from targetSdk 35+ Android forces
  // edge-to-edge, so screens draw behind the status bar and display cutout.
  // Every header reads its top padding from useTopInset() (src/hooks/useSafeArea),
  // which is backed by this provider. initialMetrics avoids the one-frame layout
  // jump on cold start by seeding the insets synchronously from the native side.
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <NavigationContainer ref={navigationRef}>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F7F5EF",
  },
});
