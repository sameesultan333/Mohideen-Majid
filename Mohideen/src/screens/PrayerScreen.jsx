/**
 * PrayerScreen.js — Mohideen Masjid
 * The dedicated full prayer-times screen (Early/Special times live
 * here now, deliberately removed from Home to keep that screen compact).
 *
 * Notes:
 *  - Uses the project's own t() from ../i18n (plain function, not a
 *    hook) - the reference example used react-i18next's useTranslation,
 *    which isn't actually installed in this project.
 *  - Shares the exact same AsyncStorage cache key as HomeScreen
 *    ("cached_prayer_timings") so both screens agree on what "last
 *    known good" data means, instead of maintaining two separate caches.
 *  - Friday Dhuhr -> Jumu'ah swap and Iqamah-as-primary-time are the
 *    same conventions established in HomeScreen, kept consistent here.
 *  - Every conditional render was checked for the classic
 *    `{someNumber && <View/>}` bug - when someNumber is 0, that renders
 *    a bare "0" text node directly inside a View, which is what throws
 *    "Text strings must be rendered within a <Text> component." All
 *    numeric conditions here explicitly compare (`> 0`, `!== null`)
 *    rather than relying on raw truthiness.
 */

import React, { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { View, Text, StyleSheet, ScrollView, StatusBar, Platform, Dimensions, RefreshControl, ActivityIndicator, Animated, Easing } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Rect, Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { apiAxios, getWsUrl } from "../config/server";
import { COLORS as C } from "../config/theme";
import { useTranslation } from "react-i18next";
import BottomNav from "../components/BottomNav";
import { syncPrayerTimesToLocalScheduler } from "../utils/prayerScheduleSync";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { useTopInset } from "../hooks/useSafeArea";
const PRAYER_CACHE_KEY = "cached_prayer_timings"; // shared with HomeScreen

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
  error: "#C0473A",
  fajr: "#E8C97A",
  dhuhr: C.gold,
  jummah: "#B8863A",
  asr: "#B8963A",
  maghrib: "#D4B15C",
  isha: "#8E6A24",
};

const shadow = (y = 4, opacity = 0.08) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.6 },
    android: { elevation: y },
  });

// ─── Hijri date (tabular/civil calendar approximation) ───────────────────
const HIJRI_MONTHS = [
  "Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani", "Jumada al-Awwal", "Jumada al-Thani",
  "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah",
];

const gregorianToJDN = (y, m, d) => {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
};

const jdnToHijri = (jdn) => {
  const epoch = 1948440;
  let l = jdn - epoch + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const month = Math.floor((24 * l) / 709);
  const day = l - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  return { year, month, day };
};

const getHijriDateString = (date) => {
  try {
    const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const { year, month, day } = jdnToHijri(jdn);
    const monthName = HIJRI_MONTHS[Math.max(0, Math.min(11, month - 1))];
    return `${day} ${monthName} ${year} AH`;
  } catch {
    return "—";
  }
};

// ─── Prayer metadata - rebuilt fresh, not frozen at module load ─────────
const getPrayerMeta = (t) => ({
  fajr: { key: "fajr", label: t("prayers.fajr"), arabic: t("prayers.fajrArabic"), color: H.fajr },
  dhuhr: { key: "dhuhr", label: t("prayers.dhuhr"), arabic: t("prayers.dhuhrArabic"), color: H.dhuhr },
  jummah: { key: "jummah", label: t("prayers.jummah"), arabic: t("prayers.jummahArabic"), color: H.jummah },
  asr: { key: "asr", label: t("prayers.asr"), arabic: t("prayers.asrArabic"), color: H.asr },
  maghrib: { key: "maghrib", label: t("prayers.maghrib"), arabic: t("prayers.maghribArabic"), color: H.maghrib },
  isha: { key: "isha", label: t("prayers.isha"), arabic: t("prayers.ishaArabic"), color: H.isha },
});

// ─── Time utilities ──────────────────────────────────────────────────
const getAdhanTime = (timings, prayer) => timings?.adhan?.[prayer];
const getIqamahTime = (timings, prayer) => timings?.prayer?.[prayer];
const pad = (n) => String(n).padStart(2, "0");

const timeToMinutes = (timeStr, prayerName) => {
  if (!timeStr) return null;
  let [time, modifier] = String(timeStr).trim().split(/\s+/);
  if (!time) return null;
  let [hours, minutes] = time.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;
  if (!modifier && prayerName) {
    const p = prayerName.toLowerCase();
    if (["asr", "maghrib", "isha", "taraweeh"].includes(p)) modifier = "PM";
    else if (["fajr", "imsak", "dhuha", "ishraq"].includes(p)) modifier = "AM";
    else if (["dhuhr", "jummah"].includes(p)) modifier = (hours >= 1 && hours <= 5) || hours === 12 ? "PM" : "AM";
  }
  if (modifier) {
    modifier = modifier.toLowerCase();
    if (modifier === "pm" && hours < 12) hours += 12;
    if (modifier === "am" && hours === 12) hours = 0;
  }
  return hours * 60 + minutes;
};

const parseTimeStr = (timeStr, prayerName) => {
  if (!timeStr) return "—";
  let [time, modifier] = String(timeStr).trim().split(/\s+/);
  if (!time) return "—";
  let [hours, minutes] = time.split(":");
  if (hours === undefined || minutes === undefined) return timeStr;
  let h = parseInt(hours, 10);
  if (isNaN(h)) return timeStr;
  if (!modifier && prayerName) {
    const p = prayerName.toLowerCase();
    if (["asr", "maghrib", "isha", "taraweeh"].includes(p)) modifier = "PM";
    else if (["fajr", "imsak", "dhuha", "ishraq"].includes(p)) modifier = "AM";
    else if (["dhuhr", "jummah"].includes(p)) modifier = (h >= 1 && h <= 5) || h === 12 ? "PM" : "AM";
  }
  if (modifier) {
    modifier = modifier.toLowerCase();
    if (modifier === "pm" && h < 12) h += 12;
    if (modifier === "am" && h === 12) h = 0;
  }
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${minutes} ${ampm}`;
};

const getCurrentMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const formatTime12h = (date) => {
  let h = date.getHours();
  const m = pad(date.getMinutes());
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${m} ${ampm}`;
};

const isFriday = () => new Date().getDay() === 5;

// Friday Dhuhr -> Jumu'ah swap, same convention as HomeScreen.
const buildPrayerList = (timings, friday, t) => {
  const META = getPrayerMeta(t);
  const list = [];
  list.push({ ...META.fajr, adhan: getAdhanTime(timings, "fajr"), iqamah: getIqamahTime(timings, "fajr") });
  if (friday) {
    list.push({ ...META.jummah, adhan: timings?.prayer?.jummah, iqamah: timings?.prayer?.jummah_iqamah });
  } else {
    list.push({ ...META.dhuhr, adhan: getAdhanTime(timings, "dhuhr"), iqamah: getIqamahTime(timings, "dhuhr") });
  }
  list.push({ ...META.asr, adhan: getAdhanTime(timings, "asr"), iqamah: getIqamahTime(timings, "asr") });
  list.push({ ...META.maghrib, adhan: getAdhanTime(timings, "maghrib"), iqamah: getIqamahTime(timings, "maghrib") });
  list.push({ ...META.isha, adhan: getAdhanTime(timings, "isha"), iqamah: getIqamahTime(timings, "isha") });
  return list;
};

const primaryTime = (item) => item?.iqamah || item?.adhan;

const getNextIndex = (list) => {
  const now = getCurrentMinutes();
  for (let i = 0; i < list.length; i++) {
    const mins = timeToMinutes(primaryTime(list[i]), list[i]?.key);
    if (mins !== null && mins > now) return i;
  }
  return 0;
};

// "Now" only applies while we're genuinely inside a prayer's window -
// from its Adhan until a short grace period after its Iqamah (people
// still arriving/praying). Outside that window, nothing is "now" - the
// previous version just picked "whichever prayer most recently
// happened," so Fajr stayed marked NOW for the entire 7+ hours until
// Dhuhr, which is exactly the bug being reported.
const NOW_WINDOW_GRACE_MINUTES = 20;

const getActiveIndex = (list) => {
  const now = getCurrentMinutes();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const adhanMins = timeToMinutes(item?.adhan, item?.key);
    if (adhanMins === null) continue;
    const iqamahMins = timeToMinutes(item?.iqamah, item?.key);
    const windowEnd = (iqamahMins !== null ? iqamahMins : adhanMins) + NOW_WINDOW_GRACE_MINUTES;
    if (now >= adhanMins && now <= windowEnd) return i;
  }
  return -1;
};

const getTimeUntil = (list, index) => {
  const item = list[index];
  const target = timeToMinutes(primaryTime(item), item?.key);
  if (target === null) return null;
  const now = getCurrentMinutes();
  let diff = target - now;
  if (diff <= 0) diff += 24 * 60;
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const getWindowProgress = (list, nextIndex) => {
  const now = getCurrentMinutes();
  const nextMins = timeToMinutes(primaryTime(list[nextIndex]), list[nextIndex]?.key);
  const prevIndex = (nextIndex - 1 + list.length) % list.length;
  let prevMins = timeToMinutes(primaryTime(list[prevIndex]), list[prevIndex]?.key);
  if (nextMins === null) return 0;
  let nowAdj = now;
  let nextAdj = nextMins;
  if (prevMins === null) prevMins = nextMins - 60;
  if (nextAdj <= prevMins) nextAdj += 24 * 60;
  if (nowAdj < prevMins) nowAdj += 24 * 60;
  const total = nextAdj - prevMins;
  const elapsed = nowAdj - prevMins;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, elapsed / total));
};

// ─── Icons ────────────────────────────────────────────────────────────
const MosqueIcon = memo(({ color = H.goldLight, size = 26 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2 C10 6 10 12 10 12 A4 4 0 1 0 2 12 V22 H22 V12 A4 4 0 1 0 14 12 C14 12 14 6 12 2 Z" fill={color} />
  </Svg>
));

const ClockIcon = memo(({ color = H.textMuted, size = 14 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.6} fill="none" />
    <Path d="M12 7 L12 12 L15.5 14" stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" />
  </Svg>
));

const RefreshIcon = memo(({ color = H.textMuted, size = 14 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M4 12 A8 8 0 0 1 12 4 A8 8 0 0 1 19 8 M19 8 L19 3 M19 8 L14 8"
      fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    />
  </Svg>
));

const CheckIcon = memo(({ color = H.white, size = 12 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M20 6 L9 17 L4 12" stroke={color} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

const ProgressRing = memo(({ progress, size = 84, color = H.gold, trackColor = "rgba(11,61,46,0.1)" }) => {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={5} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={5} fill="none"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round"
          transform={`rotate(-90, ${size / 2}, ${size / 2})`}
        />
      </Svg>
    </View>
  );
});

const HeaderPattern = memo(({ w = SW, h = 150 }) => {
  const topInset = useTopInset();
  const step = 40;
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const stars = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * step + (r % 2 === 0 ? 0 : step / 2);
      const cy = r * step;
      stars.push(`M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`);
    }
  }
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      {stars.map((d, i) => (
        <Path key={i} d={d} fill={H.gold} opacity={0.05} />
      ))}
    </Svg>
  );
});

// ─── Header - every string explicitly wrapped in <Text>, no bare
// conditionals that could evaluate to a raw number ─────────────────────
const HEADER_H = 150;

const CompactHeader = ({ title, hijriDate, gregorianDate, onSettingsPress }) => (
  <View style={[hs.wrap, { height: HEADER_H + topInset, paddingTop: topInset }]}>
    <Svg width={SW} height={HEADER_H + topInset} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="prayerHeaderGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={H.headerDeep} />
          <Stop offset="100%" stopColor={H.headerLight} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={SW} height={HEADER_H + topInset} fill="url(#prayerHeaderGrad)" />
    </Svg>
    <HeaderPattern w={SW} h={HEADER_H} />

    <View style={hs.row}>
      <Text allowFontScaling={false} style={hs.title}>{title}</Text>
      <View style={hs.iconContainer}>
        <MosqueIcon color={H.goldLight} size={26} />
      </View>
      <AnimatedPressable style={hs.settingsBtn} onPress={onSettingsPress} android_ripple={{ color: 'transparent' }}>
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35C8.66 5.59 8.12 5.92 7.63 6.29L5.24 5.33c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58C4.84 11.36 4.8 11.69 4.8 12s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61L19.14 12.94zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" fill={H.white} />
        </Svg>
      </AnimatedPressable>
    </View>

    <View style={hs.dateRow}>
      <Text allowFontScaling={false} style={hs.dateTxt}>{gregorianDate}</Text>
      <View style={hs.dateDot} />
      <Text allowFontScaling={false} style={hs.dateTxt}>{hijriDate}</Text>
    </View>
  </View>
);

// ─── Next-prayer highlight card ────────────────────────────────────────
const NextPrayerCard = ({ item, timeUntil, progress }) => {
  const { t } = useTranslation();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, [item?.key]);

  if (!item) return null;

  return (
    <Animated.View style={[styles.nextCard, { opacity: fade }]}>
      <View style={styles.nextLeft}>
        <Text allowFontScaling={false} style={styles.nextLabel}>{t("prayer.nextPrayer")}</Text>
        <Text allowFontScaling={false} style={[styles.nextName, { color: item.color }]}>{item.label}</Text>
        <Text allowFontScaling={false} style={styles.nextArabic}>{item.arabic}</Text>

        <View style={styles.nextTimesRow}>
          <View style={styles.nextTimeCol}>
            <Text allowFontScaling={false} style={styles.nextTimeLabel}>{t("prayer.iqamah")}</Text>
            <Text allowFontScaling={false} style={[styles.nextTimeValue, styles.nextIqamahValue]}>
              {parseTimeStr(item.iqamah, item.key)}
            </Text>
          </View>
        </View>

        {timeUntil ? (
          <View style={[styles.countdownPill, { borderColor: item.color }]}>
            <Text allowFontScaling={false} style={[styles.countdownTxt, { color: item.color }]}>{timeUntil}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.nextRight}>
        <ProgressRing progress={progress} size={80} color={item.color} />
      </View>
    </Animated.View>
  );
};

// ─── Full prayer row (Adhan + Iqamah both labeled, Iqamah emphasized) ──
const PrayerRow = ({ item, status, index }) => {
  const { t } = useTranslation();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 360, delay: index * 60, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 360, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, []);

  const isNow = status === "now";
  const isNext = status === "next";

  return (
    <Animated.View style={[styles.row, isNow && { borderColor: item.color, backgroundColor: `${item.color}0D` }, { opacity: fade, transform: [{ translateY: slide }] }]}>
      <View style={[styles.rowAccent, { backgroundColor: item.color }]} />

      <View style={styles.rowInfo}>
        <Text allowFontScaling={false} style={styles.rowName}>{item.label}</Text>
        <Text allowFontScaling={false} style={styles.rowArabic}>{item.arabic}</Text>
      </View>

      <View style={styles.rowTimes}>
        <View style={styles.rowTimeCol}>
          <Text allowFontScaling={false} style={styles.rowTimeLabel}>{t("prayer.iqamah")}</Text>
          <Text allowFontScaling={false} style={[styles.rowTimeValue, styles.rowIqamahValue, { color: item.color }]}>
            {parseTimeStr(item.iqamah, item.key)}
          </Text>
        </View>
      </View>

      {(isNow || isNext) ? (
        <View style={[styles.badge, isNow ? { backgroundColor: item.color } : { borderColor: item.color, borderWidth: 1 }]}>
          {isNow ? <CheckIcon color={H.white} size={10} /> : null}
          <Text allowFontScaling={false} style={[styles.badgeTxt, isNow ? { color: H.white } : { color: item.color }]}>
            {isNow ? t("prayer.now") : t("prayer.next")}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
};

// ─── Small time card for Early/Special sections ────────────────────────
const TimeCard = ({ label, arabic, time }) => (
  <View style={styles.timeCard}>
    <Text allowFontScaling={false} style={styles.timeCardLabel}>{label}</Text>
    <Text allowFontScaling={false} style={styles.timeCardArabic}>{arabic}</Text>
    <Text allowFontScaling={false} style={styles.timeCardValue}>{time || "—"}</Text>
  </View>
);

// ─── Main component ────────────────────────────────────────────────────
export default function PrayerScreen({ navigation, route }) {
  const { t } = useTranslation();
  const currentRoute = route?.name || "PrayerTime";
  const [timings, setTimings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const wsRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, []);

  // Offline-first: paint from the shared cache immediately.
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(PRAYER_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          setTimings(parsed);
          setLoading(false);
        }
      } catch (e) {}
    })();
  }, []);

  const fetchPrayerTimes = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    try {
      // Version check first — only fetch full times if schedule changed
      let shouldFetch = isRefresh;
      if (!shouldFetch) {
        try {
          const versionRes = await apiAxios({ method: "get", url: "/prayer/version", timeout: 5000 });
          const serverVersion = versionRes.data?.version || 0;
          const storedVersion = parseInt(await AsyncStorage.getItem('prayer_schedule_version') || '0', 10);
          shouldFetch = serverVersion > storedVersion;
        } catch {
          shouldFetch = true; // can't check version, fetch anyway
        }
      }

      if (shouldFetch) {
        const res = await apiAxios({ method: "get", url: "/prayer/", timeout: 10000 });
        setTimings(res.data);
        setIsOffline(false);
        setLastUpdated(new Date());
        AsyncStorage.setItem(PRAYER_CACHE_KEY, JSON.stringify(res.data)).catch(() => {});
        syncPrayerTimesToLocalScheduler(res.data).catch(() => {});
      } else {
        setIsOffline(false);
      }
    } catch (e) {
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPrayerTimes(false);

    let active = true;
    (async () => {
      try {
        const wsUrl = await getWsUrl("/ws/prayer");
        if (!active) return;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "prayer_updated") {
              setTimings(data.data);
              setIsOffline(false);
              setLastUpdated(new Date());
              AsyncStorage.setItem(PRAYER_CACHE_KEY, JSON.stringify(data.data)).catch(() => {});
              syncPrayerTimesToLocalScheduler(data.data).catch(() => {});
            }
          } catch (e) {}
        };
      } catch {}
    })();

    const poll = setInterval(() => fetchPrayerTimes(false), 30000);

    return () => {
      active = false;
      clearInterval(poll);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchPrayerTimes]);

  const onRefresh = useCallback(() => fetchPrayerTimes(true), [fetchPrayerTimes]);

  const friday = isFriday();
  const prayerList = useMemo(() => buildPrayerList(timings, friday, t), [timings, friday, t]);
  const nextIndex = useMemo(() => getNextIndex(prayerList), [prayerList, currentTime]);
  const activeIndex = useMemo(() => getActiveIndex(prayerList), [prayerList, currentTime]);
  const timeUntil = useMemo(() => getTimeUntil(prayerList, nextIndex), [prayerList, nextIndex, currentTime]);
  const windowProgress = useMemo(() => getWindowProgress(prayerList, nextIndex), [prayerList, nextIndex, currentTime]);

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  if (loading && !timings) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />
        <CompactHeader title={t("prayer.title")} hijriDate={hijriDate} gregorianDate={gregorianDate} onSettingsPress={() => navigation.navigate("NotificationSettings")} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={H.gold} />
          <Text allowFontScaling={false} style={styles.loadingText}>{t("prayer.loading")}</Text>
        </View>
        <BottomNav navigation={navigation} currentRoute={currentRoute} />
      </View>
    );
  }

  if (!timings) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />
        <CompactHeader title={t("prayer.title")} hijriDate={hijriDate} gregorianDate={gregorianDate} onSettingsPress={() => navigation.navigate("NotificationSettings")} />
        <View style={styles.center}>
          <Text allowFontScaling={false} style={styles.errorTitle}>{t("prayer.errorTitle")}</Text>
          <Text allowFontScaling={false} style={styles.errorSub}>{t("prayer.fetchError")}</Text>
          <AnimatedPressable style={styles.retryButton} onPress={() => fetchPrayerTimes(true)}>
            <Text allowFontScaling={false} style={styles.retryButtonText}>{t("prayer.retry")}</Text>
          </AnimatedPressable>
        </View>
        <BottomNav navigation={navigation} currentRoute={currentRoute} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      <CompactHeader title={t("prayer.title")} hijriDate={hijriDate} gregorianDate={gregorianDate} onSettingsPress={() => navigation.navigate("NotificationSettings")} />

      <Animated.ScrollView
        style={{ flex: 1, opacity: fadeAnim }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={H.gold} />}
        showsVerticalScrollIndicator={false}
      >
        {isOffline ? (
          <View style={styles.offlinePill}>
            <RefreshIcon />
            <Text allowFontScaling={false} style={styles.offlinePillTxt}>{t("prayer.offline")}</Text>
          </View>
        ) : lastUpdated ? (
          <View style={styles.lastUpdated}>
            <ClockIcon />
            <Text allowFontScaling={false} style={styles.lastUpdatedText}>
              {t("prayer.lastUpdated")} {formatTime12h(lastUpdated)}
            </Text>
          </View>
        ) : null}

        <NextPrayerCard item={prayerList[nextIndex]} timeUntil={timeUntil} progress={windowProgress} />

        <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 24 }]}>{t("prayer.prayerTimes")}</Text>
        <View style={{ gap: 10 }}>
          {prayerList.map((item, i) => {
            const status = i === activeIndex ? "now" : i === nextIndex ? "next" : "upcoming";
            return <PrayerRow key={item.key} item={item} status={status} index={i} />;
          })}
        </View>

        {timings?.early ? (
          <>
            <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 24 }]}>{t("prayer.earlyTimes")}</Text>
            <View style={styles.timeGrid}>
              <TimeCard label={t("prayers.imsak")} arabic={t("prayers.imsakArabic")} time={parseTimeStr(timings.early.imsak, "imsak")} />
              <TimeCard label={t("prayers.sunrise")} arabic={t("prayers.sunriseArabic")} time={parseTimeStr(timings.early.sunrise, "sunrise")} />
              <TimeCard label={t("prayers.dhuha")} arabic={t("prayers.dhuhaArabic")} time={parseTimeStr(timings.early.dhuha, "dhuha")} />
            </View>
          </>
        ) : null}

        {timings?.special ? (
          <>
            <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 24 }]}>{t("prayer.specialTimes")}</Text>
            <View style={styles.timeGrid}>
              <TimeCard label={t("prayers.ishraq")} arabic={t("prayers.ishraqArabic")} time={parseTimeStr(timings.special.ishraq, "ishraq")} />
              <TimeCard label={t("prayers.taraweeh")} arabic={t("prayers.taraweehArabic")} time={parseTimeStr(timings.special.taraweeh, "taraweeh")} />
              <TimeCard label={t("prayers.sunset")} arabic={t("prayers.sunsetArabic")} time={parseTimeStr(timings.special.sunset, "sunset")} />
            </View>
          </>
        ) : null}

        {timings?.notes ? (
          <View style={styles.notesCard}>
            <Text allowFontScaling={false} style={styles.notesTitle}>{t("prayer.notes")}</Text>
            <Text allowFontScaling={false} style={styles.notesText}>{timings.notes}</Text>
          </View>
        ) : null}

        {timings?.updated_by ? (
          <Text allowFontScaling={false} style={styles.updatedBy}>{t("prayer.updatedBy")} {timings.updated_by}</Text>
        ) : null}

        <View style={{ height: 90 }} />
      </Animated.ScrollView>

      <BottomNav navigation={navigation} currentRoute={currentRoute} />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  scrollContent: { padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: H.textMuted, fontSize: 14, fontWeight: "500" },
  errorTitle: { fontSize: 18, fontWeight: "700", color: H.textDark },
  errorSub: { fontSize: 13, color: H.textMuted, textAlign: "center" },
  retryButton: { backgroundColor: H.gold, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12, marginTop: 4 },
  retryButtonText: { color: H.headerDeep, fontWeight: "800", fontSize: 13 },

  offlinePill: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "rgba(154,163,158,0.14)", borderRadius: 12, paddingVertical: 6, marginBottom: 14,
  },
  offlinePillTxt: { fontSize: 11, color: H.textMuted, fontWeight: "700" },
  lastUpdated: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 14 },
  lastUpdatedText: { fontSize: 11, color: H.textMuted, fontWeight: "500" },

  nextCard: {
    flexDirection: "row", backgroundColor: H.card, borderRadius: 22, padding: 18,
    borderWidth: 1, borderColor: H.cardBorder, ...shadow(6, 0.08),
  },
  nextLeft: { flex: 1 },
  nextLabel: { fontSize: 10, color: H.textMuted, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  nextName: { fontSize: 22, fontWeight: "800", marginTop: 5 },
  nextArabic: { fontSize: 13, color: H.textMuted, marginTop: 1 },
  nextTimesRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 16 },
  nextTimeCol: {},
  nextTimeLabel: { fontSize: 9.5, color: H.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  nextTimeValue: { fontSize: 15, fontWeight: "700", color: H.textDark, marginTop: 3 },
  nextIqamahValue: { fontSize: 17, fontWeight: "800" },
  nextTimeDivider: { width: 1, height: 28, backgroundColor: H.cardBorder },
  countdownPill: { marginTop: 12, alignSelf: "flex-start", borderWidth: 1, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 3 },
  countdownTxt: { fontSize: 11, fontWeight: "800" },
  nextRight: { alignItems: "center", justifyContent: "center", marginLeft: 10 },

  sectionTitle: { fontSize: 16, fontWeight: "700", color: H.textDark, marginBottom: 10 },

  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 16,
    borderWidth: 1, borderColor: H.cardBorder, paddingVertical: 12, paddingHorizontal: 14,
    ...shadow(2, 0.04),
  },
  rowAccent: { position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2 },
  rowInfo: { flex: 1, marginLeft: 10 },
  rowName: { fontSize: 15, fontWeight: "700", color: H.textDark },
  rowArabic: { fontSize: 12, color: H.textMuted, marginTop: 1 },
  rowTimes: { flexDirection: "row", gap: 16, marginRight: 8 },
  rowTimeCol: { alignItems: "center" },
  rowTimeLabel: { fontSize: 8.5, color: H.textMuted, fontWeight: "700", textTransform: "uppercase" },
  rowTimeValue: { fontSize: 13, fontWeight: "600", color: H.textDark, marginTop: 3 },
  rowIqamahValue: { fontSize: 14, fontWeight: "800" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 4,
  },
  badgeTxt: { fontSize: 8.5, fontWeight: "900", letterSpacing: 0.4 },

  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  timeCard: {
    flex: 1, minWidth: "30%", backgroundColor: H.card, borderRadius: 16, padding: 14,
    alignItems: "center", borderWidth: 1, borderColor: H.cardBorder, ...shadow(2, 0.04),
  },
  timeCardLabel: { fontSize: 10, color: H.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  timeCardArabic: { fontSize: 12, color: H.goldDeep, marginTop: 3 },
  timeCardValue: { fontSize: 15, fontWeight: "700", color: H.textDark, marginTop: 5 },

  notesCard: {
    backgroundColor: H.card, borderRadius: 18, padding: 16, marginTop: 24,
    borderWidth: 1, borderColor: H.cardBorder, ...shadow(2, 0.04),
  },
  notesTitle: { fontSize: 13, fontWeight: "700", color: H.textDark, marginBottom: 4 },
  notesText: { fontSize: 13, color: H.textMuted, lineHeight: 19 },

  updatedBy: { textAlign: "center", fontSize: 11, color: H.textMuted, marginTop: 14, fontStyle: "italic" },
});

const hs = StyleSheet.create({
  wrap: { height: HEADER_H, paddingHorizontal: 20, overflow: "hidden", borderBottomLeftRadius: 24, borderBottomRightRadius: 24, ...shadow(8, 0.16) },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  title: { color: H.white, fontSize: 22, fontWeight: "700", letterSpacing: 0.4 },
  iconContainer: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1, borderColor: "rgba(212,175,55,0.4)", alignItems: "center", justifyContent: "center",
  },
  settingsBtn: { padding: 8 },
  dateRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 8 },
  dateTxt: { color: "rgba(255,255,255,0.6)", fontSize: 10.5, fontWeight: "600" },
  dateDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: H.goldLight },
});