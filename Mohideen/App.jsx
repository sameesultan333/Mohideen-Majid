import React, { useEffect, useState } from "react";
import { ActivityIndicator, LogBox, StatusBar, StyleSheet, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { StatusBarProvider, useStatusBarAppearance } from "./src/theme/statusBar";
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

  // ── Global safe area ──────────────────────────────────────────────────────
  // From targetSdk 35 Android force-enables edge-to-edge, so without this the
  // app draws *behind* the status bar: headers slide under the clock and the
  // header gradient tints the status bar itself.
  //
  // The inset is handled once, here, rather than by every screen. SafeAreaView
  // with edges top/left/right shrinks the app to the usable area, so every
  // screen begins below the status bar and any display cutout automatically —
  // new screens included, with no per-screen padding to remember. Modals get
  // the same treatment through SafeModal, since the platform renders those in
  // their own window outside this hierarchy.
  //
  // The strip's colour and the system icon style come from StatusBarProvider:
  // a screen declares the colour at its top edge and the icon style is derived
  // from that colour's luminance, so the bar always matches the screen beneath
  // it and the clock/battery/signal always have contrast. `bottom` is excluded
  // so the tab bar keeps owning its own gesture-bar spacing.
  //
  // initialMetrics seeds the insets synchronously from the native side, which
  // avoids a one-frame layout jump on cold start.
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBarProvider>
        <AppShell />
      </StatusBarProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const { topColor, barStyle } = useStatusBarAppearance();
  return (
    <>
      <StatusBar barStyle={barStyle} backgroundColor={topColor} translucent={false} />
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: topColor }]}
        edges={["top", "left", "right"]}
      >
        <NavigationContainer ref={navigationRef}>
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  // Fills the status-bar strip. Neutral so the bar never shows the app's green.
  // backgroundColor is supplied at runtime from the focused screen.
  safeArea: { flex: 1 },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F7F5EF",
  },
});
