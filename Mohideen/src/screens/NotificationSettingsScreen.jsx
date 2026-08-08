/**
 * NotificationSettingsScreen.jsx
 *
 * Screen for configuring prayer notification preferences.
 * Allows users to toggle global settings and individual prayer notification types.
 */

import React, { useState, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, StatusBar, Platform, Switch } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path } from "react-native-svg";
import { COLORS as C } from "../config/theme";
import { useTranslation } from "react-i18next";

const NOTIF_SETTINGS_KEY = 'prayer_notification_settings';

const DEFAULT_SETTINGS = {
  adhanEnabled: true,
  iqamahEnabled: true,
  fajr:    { adhan: true, iqamah: true },
  dhuhr:   { adhan: true, iqamah: true },
  asr:     { adhan: true, iqamah: true },
  maghrib: { adhan: true, iqamah: true },
  isha:    { adhan: true, iqamah: true },
  sunrise: { adhan: false, iqamah: false },
  jummah:  { adhan: true, iqamah: true },
};

const normalizeSettings = (raw) => {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const normalized = { ...DEFAULT_SETTINGS, ...parsed };

  for (const prayerKey of ["fajr", "dhuhr", "asr", "maghrib", "isha", "sunrise", "jummah"]) {
    const source = parsed[prayerKey] || parsed[prayerKey === "jummah" ? "jumuah" : prayerKey] || {};
    normalized[prayerKey] = {
      adhan: source.adhan ?? DEFAULT_SETTINGS[prayerKey].adhan,
      iqamah: source.iqamah ?? DEFAULT_SETTINGS[prayerKey].iqamah,
    };
  }

  delete normalized.prayerStartedEnabled;
  delete normalized.jumuah;

  return normalized;
};

const H = {
  bg: "#FBF9F4",
  card: "#FFFFFF",
  cardBorder: "rgba(11,61,46,0.08)",
  headerDeep: C.bg,
  headerLight: C.bgVivid,
  gold: C.gold,
  goldLight: C.goldLight,
  goldDeep: C.goldDeep,
  textDark: C.textDark,
  textMuted: C.textMuted,
  white: C.white,
};


const BackIcon = () => (
  <Svg width={24} height={24} viewBox="0 0 24 24">
    <Path d="M15 18 L9 12 L15 6" stroke={H.white} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ToggleSwitch = ({ value, onValueChange }) => (
  <Switch
    value={value}
    onValueChange={onValueChange}
    trackColor={{ false: "rgba(11,61,46,0.2)", true: H.gold }}
    thumbColor={value ? H.goldDeep : "#FFFFFF"}
    ios_backgroundColor="rgba(11,61,46,0.2)"
  />
);

const SettingRow = ({ label, description, value, onValueChange }) => (
  <View style={styles.settingRow}>
    <View style={styles.settingInfo}>
      <Text allowFontScaling={false} style={styles.settingLabel}>{label}</Text>
      {description && (
        <Text allowFontScaling={false} style={styles.settingDesc}>{description}</Text>
      )}
    </View>
    <ToggleSwitch value={value} onValueChange={onValueChange} />
  </View>
);

const PrayerSettingRow = ({ label, arabic, adhan, iqamah, onAdhanChange, onIqamahChange, color }) => {
  const { t } = useTranslation();
  return (
    <View style={styles.prayerSettingRow}>
      <View style={styles.prayerSettingInfo}>
        <View style={styles.prayerNameRow}>
          <View style={[styles.prayerDot, { backgroundColor: color }]} />
          <Text allowFontScaling={false} style={styles.prayerLabel}>{label}</Text>
        </View>
        <Text allowFontScaling={false} style={styles.prayerArabic}>{arabic}</Text>
      </View>
      <View style={styles.prayerToggles}>
        <View style={styles.toggleCol}>
          <Text allowFontScaling={false} style={styles.toggleLabel}>{t("prayer.adhan")}</Text>
          <ToggleSwitch value={adhan} onValueChange={onAdhanChange} />
        </View>
        <View style={styles.toggleCol}>
          <Text allowFontScaling={false} style={styles.toggleLabel}>{t("prayer.iqamah")}</Text>
          <ToggleSwitch value={iqamah} onValueChange={onIqamahChange} />
        </View>
      </View>
    </View>
  );
};

export default function NotificationSettingsScreen({ navigation }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const raw = await AsyncStorage.getItem(NOTIF_SETTINGS_KEY);
      setSettings(raw ? normalizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS);
    } catch {
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (newSettings) => {
    const normalized = normalizeSettings(newSettings);
    setSettings(normalized);
    try {
      await AsyncStorage.setItem(NOTIF_SETTINGS_KEY, JSON.stringify(normalized));
    } catch {}
  };

  const updateGlobalSetting = (key, value) => saveSettings({ ...settings, [key]: value });

  const updatePrayerSetting = (prayerKey, notificationType, value) =>
    saveSettings({ ...settings, [prayerKey]: { ...settings[prayerKey], [notificationType]: value } });

  // Static content — only depends on the active language, not on `settings`,
  // so it shouldn't be rebuilt on every toggle (each toggle calls saveSettings
  // -> setSettings -> re-render).
  const prayers = useMemo(() => [
    { key: "fajr", label: t("prayers.fajr"), arabic: t("prayers.fajrArabic"), color: "#E8C97A" },
    { key: "dhuhr", label: t("prayers.dhuhr"), arabic: t("prayers.dhuhrArabic"), color: H.gold },
    { key: "asr", label: t("prayers.asr"), arabic: t("prayers.asrArabic"), color: "#B8963A" },
    { key: "maghrib", label: t("prayers.maghrib"), arabic: t("prayers.maghribArabic"), color: "#D4B15C" },
    { key: "isha", label: t("prayers.isha"), arabic: t("prayers.ishaArabic"), color: "#8E6A24" },
    { key: "sunrise", label: t("prayers.sunrise"), arabic: t("prayers.sunriseArabic"), color: H.textMuted },
    { key: "jummah", label: t("prayers.jummah"), arabic: t("prayers.jummahArabic"), color: "#B8863A" },
  ], [t]);

  if (loading || !settings) {
    return (
      <View style={styles.center}>
        <Text allowFontScaling={false} style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()} android_ripple={{ color: 'transparent' }}>
          <BackIcon />
        </AnimatedPressable>
        <Text allowFontScaling={false} style={styles.headerTitle}>{t("notificationSettings.title")}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text allowFontScaling={false} style={styles.sectionTitle}>{t("notificationSettings.globalSettings")}</Text>
        <View style={styles.card}>
          <SettingRow
            label={t("notificationSettings.adhanEnabled")}
            description={t("notificationSettings.adhanEnabledDesc")}
            value={settings.adhanEnabled}
            onValueChange={(value) => updateGlobalSetting("adhanEnabled", value)}
          />
          <SettingRow
            label={t("notificationSettings.iqamahEnabled")}
            description={t("notificationSettings.iqamahEnabledDesc")}
            value={settings.iqamahEnabled}
            onValueChange={(value) => updateGlobalSetting("iqamahEnabled", value)}
          />
        </View>

        <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 24 }]}>{t("notificationSettings.prayerSettings")}</Text>
        <View style={styles.card}>
          {prayers.map((prayer) => (
            <PrayerSettingRow
              key={prayer.key}
              label={prayer.label}
              arabic={prayer.arabic}
              color={prayer.color}
              adhan={settings[prayer.key]?.adhan || false}
              iqamah={settings[prayer.key]?.iqamah || false}
              onAdhanChange={(value) => updatePrayerSetting(prayer.key, "adhan", value)}
              onIqamahChange={(value) => updatePrayerSetting(prayer.key, "iqamah", value)}
            />
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { fontSize: 16, color: H.textMuted },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: H.headerDeep,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: H.white },
  headerSpacer: { width: 40 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  sectionTitle: { fontSize: 16, fontWeight: "700", color: H.textDark, marginBottom: 12 },

  card: {
    backgroundColor: H.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
    padding: 16,
  },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: H.cardBorder,
  },
  settingRowLast: { borderBottomWidth: 0 },
  settingInfo: { flex: 1, marginRight: 12 },
  settingLabel: { fontSize: 15, fontWeight: "600", color: H.textDark },
  settingDesc: { fontSize: 12, color: H.textMuted, marginTop: 2 },

  prayerSettingRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: H.cardBorder,
  },
  prayerSettingRowLast: { borderBottomWidth: 0 },
  prayerSettingInfo: { marginBottom: 10 },
  prayerNameRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  prayerDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  prayerLabel: { fontSize: 15, fontWeight: "600", color: H.textDark },
  prayerArabic: { fontSize: 13, color: H.textMuted, marginLeft: 16 },
  prayerToggles: { flexDirection: "row", justifyContent: "space-between" },
  toggleCol: { alignItems: "center" },
  toggleLabel: { fontSize: 11, color: H.textMuted, fontWeight: "600", marginBottom: 4 },
});
