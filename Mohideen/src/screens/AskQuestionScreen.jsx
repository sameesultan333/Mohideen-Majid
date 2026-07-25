/**
 * AskQuestionScreen — Premium Question Submission
 * Matches HomeScreen/ProfileScreen palette and styling
 * No emojis · All text from i18n
 */

import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, StatusBar, Platform, ActivityIndicator, Alert, KeyboardAvoidingView, Animated, Dimensions } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getToken } from "../utils/secureStorage";
import Svg, { Path, Rect, Defs, LinearGradient, Stop, Circle } from "react-native-svg";
import { apiAxios } from "../config/server";
import { COLORS as C } from "../config/theme";
import { logger } from "../utils/logger";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
const STATUSBAR_HEIGHT = IOS ? 48 : (StatusBar.currentHeight || 0) + 6;

// ─── Palette (identical to HomeScreen) ─────────────────────────────
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

// ─── SVG Icons (no emojis) ──────────────────────────────────────────
const BackIcon = ({ color = H.white, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15 18 L9 12 L15 6" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const QuestionMarkIcon = ({ color = H.gold, size = 28 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2 C8 2 6 4 6 8 L6 10 C6 14 8 16 12 16" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    <Circle cx="12" cy="20" r="2" fill={color} />
    <Path d="M12 16 L12 18" stroke={color} strokeWidth={1.8} />
  </Svg>
);

const CheckmarkIcon = ({ color = H.white, size = 40 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="11" stroke={color} strokeWidth={2} fill="none" />
    <Path d="M7 12 L11 16 L18 8" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const MosqueIcon = ({ color = H.goldLight, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2 C10 6 10 12 10 12 A4 4 0 1 0 2 12 V22 H22 V12 A4 4 0 1 0 14 12 C14 12 14 6 12 2 Z" fill={color} />
  </Svg>
);

// ─── Header Pattern ──────────────────────────────────────────────────
const HeaderPattern = ({ w = SW, h = 148 }) => {
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
};

// ─── Helper: Hijri date ──────────────────────────────────────────────
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
    return "Hijri unavailable";
  }
};

// ─── Compact Header ──────────────────────────────────────────────────
const CompactHeader = ({ onBack, title, hijriDate, gregorianDate }) => {
  // Safe string checks
  const safeTitle = typeof title === "string" ? title : "";
  const safeGregorian = typeof gregorianDate === "string" ? gregorianDate : "";
  const safeHijri = typeof hijriDate === "string" ? hijriDate : "";

  return (
    <View style={hs.wrap}>
      <Svg width={SW} height={148} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset={0} stopColor={H.headerDeep} />
            <Stop offset={1} stopColor={H.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={148} fill="url(#headerGrad)" />
      </Svg>
      <HeaderPattern w={SW} h={148} />

      <View style={hs.row}>
        <AnimatedPressable onPress={onBack} style={hs.backBtn}>
          <BackIcon />
        </AnimatedPressable>
        <View style={hs.titleContainer}>
          <Text style={hs.title}>{safeTitle}</Text>
        </View>
        {/*
          Fixed-width spacer to balance the back button so the title
          stays visually centered. Kept on its own line deliberately —
          a same-line trailing comment after a self-closing tag leaves a
          literal space character as a text node directly inside this
          View, which React Native refuses to render and throws
          "Text strings must be rendered within a <Text> component".
        */}
        <View style={{ width: 44 }} />
      </View>

      <View style={hs.dateRow}>
        <Text style={hs.dateTxt}>{safeGregorian}</Text>
        <View style={hs.dateDot} />
        <Text style={hs.dateTxt}>{safeHijri}</Text>
      </View>
    </View>
  );
};

// ─── Main Component ──────────────────────────────────────────────────
export default function AskQuestionScreen({ navigation, route }) {
  const { t } = useTranslation();
  const [questionText, setQuestionText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async () => {
    if (!questionText.trim()) {
      Alert.alert(t("askQuestion.emptyTitle"), t("askQuestion.emptyMessage"));
      return;
    }

    try {
      setSubmitting(true);
      const token = await getToken();

      await apiAxios({
        method: "post",
        url: "/questions/",
        data: {
          question_text: questionText.trim(),
          question_voice_url: null,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      setSubmitted(true);
      setQuestionText("");
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || t("common.error");
      logger.log("Submit error:", msg);
      Alert.alert(t("common.error"), msg);
    } finally {
      setSubmitting(false);
    }
  };

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const title = t("askQuestion.title");

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      <CompactHeader
        onBack={() => navigation.goBack()}
        title={title}
        hijriDate={hijriDate}
        gregorianDate={gregorianDate}
      />

      <Animated.ScrollView
        contentContainerStyle={styles.body}
        style={{ opacity: fadeAnim }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {submitted ? (
          // ── Success State ──────────────────────────────
          <View style={styles.successBox}>
            <View style={styles.successIconContainer}>
              <CheckmarkIcon color={H.gold} size={56} />
            </View>
            <Text style={styles.successTitle}>{t("askQuestion.successTitle")}</Text>
            <Text style={styles.successText}>{t("askQuestion.successText")}</Text>
            <AnimatedPressable
              style={styles.askAnother}
              onPress={() => setSubmitted(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.askAnotherText}>{t("askQuestion.askAnother")}</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.askAnother, { backgroundColor: H.cardBorder, marginTop: 10 }]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.8}
            >
              <Text style={[styles.askAnotherText, { color: H.textDark }]}>
                {t("askQuestion.goBack")}
              </Text>
            </AnimatedPressable>
          </View>
        ) : (
          // ── Form ──────────────────────────────────────
          <>
            <View style={styles.infoCard}>
              <View style={styles.infoIconContainer}>
                <MosqueIcon color={H.gold} size={28} />
              </View>
              <Text style={styles.infoText}>{t("askQuestion.infoText")}</Text>
            </View>

            <Text style={styles.label}>{t("askQuestion.yourQuestion")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("askQuestion.placeholder")}
              placeholderTextColor={H.textMuted}
              value={questionText}
              onChangeText={setQuestionText}
              multiline
              textAlignVertical="top"
              maxLength={600}
            />
            <Text style={styles.charCount}>
              {questionText.length} / 600
            </Text>

            <AnimatedPressable
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color={H.white} size="small" />
              ) : (
                <Text style={styles.submitText}>{t("askQuestion.submit")}</Text>
              )}
            </AnimatedPressable>
          </>
        )}
      </Animated.ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  body: { padding: 16, paddingBottom: 40 },

  // Info Card
  infoCard: {
    flexDirection: "row",
    backgroundColor: H.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: H.cardBorder,
    ...shadow(4, 0.06),
  },
  infoIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: H.goldLight + "20",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    borderWidth: 1,
    borderColor: H.goldLight + "40",
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: H.textDark,
    lineHeight: 20,
  },

  label: {
    fontSize: 14,
    fontWeight: "700",
    color: H.textDark,
    marginBottom: 8,
    fontFamily: "Georgia",
  },

  input: {
    backgroundColor: H.card,
    borderRadius: 16,
    padding: 16,
    fontSize: 15,
    color: H.textDark,
    minHeight: 160,
    borderWidth: 1,
    borderColor: H.cardBorder,
    lineHeight: 22,
    ...shadow(3, 0.04),
  },

  charCount: {
    textAlign: "right",
    fontSize: 11,
    color: H.textMuted,
    marginTop: 6,
    marginBottom: 20,
  },

  submitBtn: {
    backgroundColor: H.headerDeep,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    ...shadow(6, 0.12),
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: H.white, fontSize: 16, fontWeight: "700" },

  // Success State
  successBox: {
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  successIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: H.goldLight + "20",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 2,
    borderColor: H.gold,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: H.textDark,
    fontFamily: "Georgia",
    marginBottom: 10,
  },
  successText: {
    fontSize: 14,
    color: H.textMuted,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 30,
  },
  askAnother: {
    backgroundColor: H.headerDeep,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    ...shadow(4, 0.06),
  },
  askAnotherText: {
    color: H.white,
    fontWeight: "700",
    fontSize: 15,
  },
});

// ─── Header Styles ────────────────────────────────────────────────────
const hs = StyleSheet.create({
  wrap: {
    height: 148,
    paddingTop: STATUSBAR_HEIGHT,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  titleContainer: { flex: 1, marginLeft: 12 },
  title: {
    color: H.white,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Georgia",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    marginRight: 8,
  },
  dateTxt: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10.5,
    fontWeight: "600",
    marginRight: 8,
  },
  dateDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: H.goldLight,
    marginRight: 8,
  },
}); 