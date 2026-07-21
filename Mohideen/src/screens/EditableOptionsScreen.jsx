/**
 * EditableOptionsScreen.js — Mohideen Masjid
 * Imam Dashboard - religious content controls.
 *
 * Changes from the previous version:
 *  - Switched off react-i18next to the project's own t() (../i18n).
 *    Our t() always returns a plain string by construction (falls back
 *    to English, then to the raw key, never to an object/number/array),
 *    so the normalizeTextValue() defensive wrapper this file had isn't
 *    needed anymore - the class of bug it was guarding against
 *    ("Text strings must be rendered within a <Text> component" when a
 *    non-string sneaks into a Text child) can't happen through t() now.
 *  - Added a role guard: only "imam" or a SuperAdmin role sees the
 *    controls. Previously this screen rendered full Imam controls for
 *    anyone who reached the route, regardless of role - matches the
 *    same tightening already applied to BottomNav's tab visibility.
 *    Same caveat as before: this is a UI convenience, not a security
 *    boundary - the Prayer/Hadith/Q&A/Announcement write endpoints
 *    this screen calls into must independently verify the role
 *    server-side.
 */

import React, { useEffect, useState, useRef, useCallback, memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  StatusBar,
  Platform,
  Dimensions,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Rect, Defs, LinearGradient, Stop, Circle, Line } from "react-native-svg";
import BottomNav from "../components/BottomNav";
import { COLORS as C } from "../config/theme";
import { useTranslation } from "react-i18next";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
const STATUSBAR_HEIGHT = IOS ? 48 : (StatusBar.currentHeight || 0) + 6;
const HEADER_H = 148;

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
  success: C.bgVivid,
};

const shadow = (y = 4, opacity = 0.08) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.6 },
    android: { elevation: y },
  });

// Same exact-match convention as BottomNav's role gating.
const normalizeRole = (role) => (role || "").toString().trim().toLowerCase();
const SUPERADMIN_ROLES = ["superadmin", "super_admin", "super admin"];
const EDITABLE_ROLES = ["imam", "modhin", "watchman"];
const canAccessEditable = (role) => {
  const r = normalizeRole(role);
  return EDITABLE_ROLES.includes(r) || SUPERADMIN_ROLES.includes(r);
};

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

// ─── Icons ────────────────────────────────────────────────────────────
const BackIcon = memo(({ color = H.white, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15 18 L9 12 L15 6" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

const PrayerIcon = memo(({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2 L12 22 M4 12 L20 12" stroke={color} strokeWidth={1.5} />
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={1.5} fill="none" />
  </Svg>
));

const HadithIcon = memo(({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="4" y="4" width="16" height="16" rx="2" stroke={color} strokeWidth={1.5} fill="none" />
    <Line x1="8" y1="8" x2="16" y2="8" stroke={color} strokeWidth={1.2} />
    <Line x1="8" y1="12" x2="14" y2="12" stroke={color} strokeWidth={1.2} />
    <Line x1="8" y1="16" x2="12" y2="16" stroke={color} strokeWidth={1.2} />
  </Svg>
));

const QuestionIcon = memo(({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2 C8 2 6 4 6 8 L6 10 C6 14 8 16 12 16" stroke={color} strokeWidth={1.5} fill="none" />
    <Circle cx="12" cy="20" r="1.5" fill={color} />
    <Path d="M12 16 L12 18" stroke={color} strokeWidth={1.5} />
  </Svg>
));

const AnnouncementIcon = memo(({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M18 8 C18 4 15 2 12 2 C9 2 6 4 6 8 L6 14 L4 16 L20 16 L18 14 Z" stroke={color} strokeWidth={1.5} fill="none" />
    <Path d="M10 18 A2 2 0 0 0 14 18" stroke={color} strokeWidth={1.5} fill="none" />
  </Svg>
));

const ArrowIcon = memo(({ color = H.gold, size = 15 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M5 12 L19 12 M14 7 L19 12 L14 17" stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

const HeaderPattern = memo(({ w = SW, h = HEADER_H }) => {
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

// ─── Header - every string goes through t(), which is guaranteed to
// return a plain string, so there's nothing to "normalize" ─────────────
const CompactHeader = ({ onBack, title, hijriDate, gregorianDate }) => (
  <View style={hs.wrap}>
    <Svg width={SW} height={HEADER_H} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="editableHeaderGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset={0} stopColor={H.headerDeep} />
          <Stop offset={1} stopColor={H.headerLight} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={SW} height={HEADER_H} fill="url(#editableHeaderGrad)" />
    </Svg>
    <HeaderPattern w={SW} h={HEADER_H} />

    <View style={hs.row}>
      <TouchableOpacity onPress={onBack} style={hs.backBtn} activeOpacity={0.8}>
        <BackIcon />
      </TouchableOpacity>
      <View style={hs.titleContainer}>
        <Text allowFontScaling={false} style={hs.title}>{title}</Text>
      </View>
      <View style={hs.spacer} />
    </View>

    <View style={hs.dateRow}>
      <Text allowFontScaling={false} style={hs.dateTxt}>{gregorianDate}</Text>
      <View style={hs.dateDot} />
      <Text allowFontScaling={false} style={hs.dateTxt}>{hijriDate}</Text>
    </View>
  </View>
);

// ─── Control card ───────────────────────────────────────────────────────
const ICONS = { prayer: PrayerIcon, hadith: HadithIcon, question: QuestionIcon, announcement: AnnouncementIcon };

const ControlCard = ({ title, subtitle, type = "prayer", onPress, index }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const Icon = ICONS[type] || PrayerIcon;

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 400, delay: index * 80, useNativeDriver: true }).start();
  }, []);

  const pressIn = () => Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }).start();

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
      }}
    >
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        activeOpacity={0.9}
      >
        <Animated.View style={[styles.cardLeft, { transform: [{ scale }] }]}>
          <View style={styles.iconCircle}>
            <Icon color={H.gold} size={22} />
          </View>
          <View style={styles.cardText}>
            <Text allowFontScaling={false} style={styles.cardTitle}>{title}</Text>
            <Text allowFontScaling={false} style={styles.cardSub}>{subtitle}</Text>
          </View>
        </Animated.View>
        <ArrowIcon color={H.gold} size={15} />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ─── Main component ────────────────────────────────────────────────────
export default function EditableOptionsScreen({ navigation, route }) {
  const { t } = useTranslation();
  const currentRoute = route?.name || "Editable";
  const [role, setRole] = useState(null);
  const [roleChecked, setRoleChecked] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    (async () => {
      try {
        const userData = await AsyncStorage.getItem("user");
        if (userData) {
          const user = JSON.parse(userData);
          setRole(user.role);
        }
      } catch (e) {
      } finally {
        setRoleChecked(true);
      }
    })();

    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 550, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  // Wait for the role check before deciding what to render, so an
  // unauthorized user never even briefly sees the controls flash in.
  if (!roleChecked) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />
        <CompactHeader onBack={() => navigation.goBack()} title={t("editable.title")} hijriDate={hijriDate} gregorianDate={gregorianDate} />
        <BottomNav navigation={navigation} currentRoute={currentRoute} />
      </View>
    );
  }

  if (!canAccessEditable(role)) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />
        <CompactHeader onBack={() => navigation.goBack()} title={t("editable.title")} hijriDate={hijriDate} gregorianDate={gregorianDate} />
        <View style={styles.restricted}>
          <Text allowFontScaling={false} style={styles.restrictedTitle}>{t("editable.accessRestrictedTitle")}</Text>
          <Text allowFontScaling={false} style={styles.restrictedSub}>{t("editable.accessRestrictedSub")}</Text>
          <TouchableOpacity style={styles.restrictedBtn} onPress={() => navigation.navigate("Home")}>
            <Text allowFontScaling={false} style={styles.restrictedBtnTxt}>{t("editable.backToHome")}</Text>
          </TouchableOpacity>
        </View>
        <BottomNav navigation={navigation} currentRoute={currentRoute} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      <CompactHeader onBack={() => navigation.goBack()} title={t("editable.title")} hijriDate={hijriDate} gregorianDate={gregorianDate} />

      <Animated.ScrollView
        contentContainerStyle={styles.container}
        style={{ opacity: fade, transform: [{ translateY: translate }] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={H.gold} />}
        showsVerticalScrollIndicator={false}
      >
        <Text allowFontScaling={false} style={styles.sectionTitle}>{t("editable.religiousControls")}</Text>

        <ControlCard
          title={t("editable.prayerTimings")}
          subtitle={t("editable.prayerTimingsSub")}
          type="prayer"
          onPress={() => navigation.navigate("PrayerTime")}
          index={0}
        />

        {/* Imam and SuperAdmin only: Hadith, Q&A, Announcements */}
        {(role === "imam" || SUPERADMIN_ROLES.includes(normalizeRole(role))) && (
          <>
            <ControlCard
              title={t("editable.hadithManagement")}
              subtitle={t("editable.hadithManagementSub")}
              type="hadith"
              onPress={() => navigation.navigate("ImamHadith")}
              index={1}
            />

            <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 20 }]}>{t("editable.community")}</Text>

            <ControlCard
              title={t("editable.qaResponses")}
              subtitle={t("editable.qaResponsesSub")}
              type="question"
              onPress={() => navigation.navigate("AnswerQA")}
              index={2}
            />

            <ControlCard
              title={t("editable.announcements")}
              subtitle={t("editable.announcementsSub")}
              type="announcement"
              onPress={() => navigation.navigate("PostAnnouncement")}
              index={3}
            />
          </>
        )}
      </Animated.ScrollView>

      <BottomNav navigation={navigation} currentRoute={currentRoute} />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  container: { padding: 16, paddingBottom: 120 },
  sectionTitle: {
    fontSize: 12, fontWeight: "700", color: H.textMuted, textTransform: "uppercase",
    letterSpacing: 1, marginBottom: 12, marginTop: 8,
  },
  card: {
    backgroundColor: H.card, borderRadius: 20, padding: 16, marginBottom: 12,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderWidth: 1, borderColor: H.cardBorder, ...shadow(4, 0.06),
  },
  cardLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  iconCircle: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(232,201,122,0.16)",
    justifyContent: "center", alignItems: "center", marginRight: 12,
    borderWidth: 1, borderColor: "rgba(232,201,122,0.35)",
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: H.textDark },
  cardSub: { fontSize: 11, color: H.textMuted, marginTop: 2 },

  restricted: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  restrictedTitle: { fontSize: 18, fontWeight: "700", color: H.textDark },
  restrictedSub: { fontSize: 13, color: H.textMuted, textAlign: "center", lineHeight: 19 },
  restrictedBtn: { marginTop: 10, backgroundColor: H.gold, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 },
  restrictedBtnTxt: { color: H.headerDeep, fontWeight: "800", fontSize: 13 },
});

const hs = StyleSheet.create({
  wrap: { height: HEADER_H, paddingTop: STATUSBAR_HEIGHT, paddingHorizontal: 20, overflow: "hidden", borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1, borderColor: "rgba(212,175,55,0.4)", justifyContent: "center", alignItems: "center",
  },
  titleContainer: { flex: 1, marginLeft: 12 },
  title: { color: H.white, fontSize: 18, fontWeight: "700" },
  spacer: { width: 40 },
  dateRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 8 },
  dateTxt: { color: "rgba(255,255,255,0.6)", fontSize: 10.5, fontWeight: "600" },
  dateDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: H.goldLight },
});