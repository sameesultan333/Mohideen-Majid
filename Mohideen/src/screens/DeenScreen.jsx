/**
 * DeenScreen — Premium Islamic Education Hub
 * Matches HomeScreen/ProfileScreen palette and styling
 * No emojis · All text from i18n
 */

import React, { useEffect, useState, useRef, useCallback, memo } from "react";
import { View, Text, StyleSheet, Animated, ScrollView, StatusBar, Platform, Alert, Dimensions, RefreshControl } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import { useFocusEffect } from "@react-navigation/native";
import Svg, { Path, Circle, Rect, Line, Defs, LinearGradient, Stop } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiAxios } from "../config/server";
import BottomNav from "../components/BottomNav";
import { getPendingQuestionCount, IMAM_LIKE_ROLES } from "../utils/deenUnread";
import { COLORS as C } from "../config/theme";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { useTopInset } from "../hooks/useSafeArea";

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
const StarIcon = ({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 2 L14 8 L20 8 L15.5 12 L17.5 18 L12 14 L6.5 18 L8.5 12 L4 8 L10 8 Z"
      fill="none"
      stroke={color}
      strokeWidth={1.2}
    />
  </Svg>
);

const CompassIcon = ({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth={1.5} />
    <Path d="M12 4 L12 8" stroke={color} strokeWidth={1.5} />
    <Path d="M12 16 L12 20" stroke={color} strokeWidth={1.5} />
    <Path d="M4 12 L8 12" stroke={color} strokeWidth={1.5} />
    <Path d="M16 12 L20 12" stroke={color} strokeWidth={1.5} />
    <Path d="M12 12 L16 8" stroke={color} strokeWidth={1.5} />
  </Svg>
);

const QuestionIcon = ({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2 C8 2 6 4 6 8 L6 10 C6 14 8 16 12 16" fill="none" stroke={color} strokeWidth={1.5} />
    <Circle cx="12" cy="20" r="1.5" fill={color} />
    <Path d="M12 16 L12 18" stroke={color} strokeWidth={1.5} />
  </Svg>
);

const HadithIcon = ({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke={color} strokeWidth={1.5} />
    <Line x1="8" y1="8" x2="16" y2="8" stroke={color} strokeWidth={1.2} />
    <Line x1="8" y1="12" x2="14" y2="12" stroke={color} strokeWidth={1.2} />
    <Line x1="8" y1="16" x2="12" y2="16" stroke={color} strokeWidth={1.2} />
  </Svg>
);

const AnswersIcon = ({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="4" width="12" height="16" rx="1" fill="none" stroke={color} strokeWidth={1.5} />
    <Line x1="9" y1="8" x2="15" y2="8" stroke={color} strokeWidth={1.2} />
    <Line x1="9" y1="12" x2="13" y2="12" stroke={color} strokeWidth={1.2} />
    <Line x1="9" y1="16" x2="11" y2="16" stroke={color} strokeWidth={1.2} />
  </Svg>
);

const JobIcon = ({ color = H.gold, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 7 L20 7 L20 18 L4 18 Z M9 7 V5 H15 V7" stroke={color} strokeWidth={1.5} fill="none" />
  </Svg>
);

const ArrowIcon = ({ color = H.gold, size = 16 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M5 12 L19 12 M14 7 L19 12 L14 17" stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ─── Header Pattern ──────────────────────────────────────────────────
const HeaderPattern = memo(({ w = SW, h = 148 }) => {
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
const CompactHeader = ({ title, hijriDate, gregorianDate }) => {
  const topInset = useTopInset();
  return (
    <View style={[hs.wrap, { paddingTop: topInset }]}>
      <Svg width={SW} height={148 + topInset} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset={0} stopColor={H.headerDeep} />
            <Stop offset={1} stopColor={H.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={148 + topInset} fill="url(#headerGrad)" />
      </Svg>
      <HeaderPattern w={SW} h={148} />

      <View style={hs.row}>
        <View style={hs.titleContainer}>
          <Text style={hs.title}>{title}</Text>
        </View>
        <View style={hs.iconContainer}>
          <StarIcon color={H.goldLight} size={28} />
        </View>
      </View>

      <View style={hs.dateRow}>
        <Text style={hs.dateTxt}>{gregorianDate}</Text>
        <View style={hs.dateDot} />
        <Text style={hs.dateTxt}>{hijriDate}</Text>
      </View>
    </View>
  );
};

// ─── Feature Card ────────────────────────────────────────────────────
const FeatureCard = ({ title, arabic, description, icon: Icon, onPress, badgeCount }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }),
    ]).start();
    onPress();
  };
  return (
    <AnimatedPressable onPress={handlePress} activeOpacity={0.9}>
      <Animated.View style={[styles.featureCard, { transform: [{ scale }] }]}>
        <View style={styles.iconCircle}>
          <Icon color={H.gold} size={32} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        {arabic && <Text style={styles.cardArabic}>{arabic}</Text>}
        <Text style={styles.cardDescription}>{description}</Text>
        <View style={styles.cardArrow}>
          <ArrowIcon color={H.gold} size={14} />
        </View>
        {badgeCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badgeCount > 9 ? "9+" : badgeCount}</Text>
          </View>
        )}
      </Animated.View>
    </AnimatedPressable>
  );
};

// ─── Main Component ──────────────────────────────────────────────────
export default function DeenScreen({ navigation, route }) {
  const currentRoute = route?.name || "Deen";
  const { t } = useTranslation();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [unreadHadithCount, setUnreadHadithCount] = useState(0);
  const [unreadQuestionCount, setUnreadQuestionCount] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  // ─── Load unread counts ─────────────────────────────────────────────
  // useFocusEffect (not a plain mount-only useEffect) so the per-card
  // badges re-derive from AsyncStorage every time this screen regains
  // focus — otherwise reading a hadith/question in another screen and
  // coming straight back here left the stale count showing until the
  // 30s interval happened to fire.
  useFocusEffect(
    useCallback(() => {
    let isActive = true;
    const loadUnreadCounts = async () => {
      try {
        const userRaw = await AsyncStorage.getItem("user");
        const role = (userRaw ? JSON.parse(userRaw)?.role : null) || "";
        const isImamLike = IMAM_LIKE_ROLES.includes(role.toString().trim().toLowerCase());

        const [readHadiths, readQuestions] = await Promise.all([
          AsyncStorage.getItem("read_hadiths"),
          AsyncStorage.getItem("read_questions")
        ]);

        const readHadithIds = readHadiths ? JSON.parse(readHadiths) : [];
        const readQuestionIds = readQuestions ? JSON.parse(readQuestions) : [];

        // Fetch hadiths and questions to count unread
        const [hadithRes, questionsRes] = await Promise.all([
          apiAxios({ method: "get", url: "/hadith" }),
          apiAxios({ method: "get", url: "/questions" })
        ].map(p => p.catch(() => ({ data: [] }))));

        const hadiths = hadithRes.data || [];
        const questions = questionsRes.data || [];

        // Filter out expired hadiths (48 hours)
        const now = new Date();
        const freshHadiths = hadiths.filter(h => {
          if (!h.created_at) return true;
          const created = new Date(h.created_at);
          const hoursDiff = (now - created) / (1000 * 60 * 60);
          return hoursDiff < 48;
        });

        if (!isActive) return;
        setUnreadHadithCount(freshHadiths.filter(h => !readHadithIds.includes(h.id)).length);

        // Imam/admin need the PENDING queue awaiting their reply, not the
        // general answered-questions feed — that's what "unread" means to
        // a member, but it's meaningless to someone who answers questions.
        if (isImamLike) {
          const pending = await getPendingQuestionCount();
          if (isActive) setUnreadQuestionCount(pending);
        } else if (isActive) {
          setUnreadQuestionCount(questions.filter(q => !readQuestionIds.includes(q.id)).length);
        }
      } catch (e) {
        // Silent error - will retry on interval
      }
    };

    loadUnreadCounts();
    // Refresh counts every 30 seconds while focused
    const interval = setInterval(loadUnreadCounts, 30000);
    return () => {
      isActive = false;
      clearInterval(interval);
    };
    }, [])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const comingSoon = (feature) => {
    Alert.alert(t("common.comingSoon"), `${feature} ${t("common.willBeAvailableSoon")}`, [{ text: t("common.ok") }]);
  };

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      <CompactHeader
        title={t("deen.title")}
        hijriDate={hijriDate}
        gregorianDate={gregorianDate}
      />

      <Animated.ScrollView
        style={{ flex: 1, opacity: fadeAnim }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={H.gold} />
        }
      >
        {/* Quote Card */}
        <View style={styles.quoteCard}>
          <Text style={styles.quoteArabic}>{t("deen.quoteArabic")}</Text>
          <Text style={styles.quoteText}>{t("deen.quoteText")}</Text>
          <Text style={styles.quoteReference}>{t("deen.quoteReference")}</Text>
        </View>

        {/* Features Grid */}
        <Text style={styles.sectionTitle}>{t("deen.resourcesTitle")}</Text>
        <Text style={styles.sectionArabic}>{t("deen.resourcesArabic")}</Text>
        <View style={styles.featuresGrid}>
          <FeatureCard
            title={t("deen.qibla")}
            arabic={t("deen.qiblaArabic")}
            description={t("deen.qiblaDesc")}
            icon={CompassIcon}
            onPress={() => navigation.navigate("Qibla")}
          />
          <FeatureCard
            title={t("deen.askQuestion")}
            arabic={t("deen.askQuestionArabic")}
            description={t("deen.askQuestionDesc")}
            icon={QuestionIcon}
            onPress={() => navigation.navigate("AskQuestion")}
          />
          <FeatureCard
            title={t("deen.hadith")}
            arabic={t("deen.hadithArabic")}
            description={t("deen.hadithDesc")}
            icon={HadithIcon}
            onPress={() => navigation.navigate("HadithFeed")}
            badgeCount={unreadHadithCount}
          />
          <FeatureCard
            title={t("deen.answers")}
            arabic={t("deen.answersArabic")}
            description={t("deen.answersDesc")}
            icon={AnswersIcon}
            onPress={() => navigation.navigate("QAViewer")}
            badgeCount={unreadQuestionCount}
          />
        </View>

        {/* Career Section */}
        <View style={styles.careerSection}>
          <Text style={styles.sectionTitle}>{t("deen.careerTitle")}</Text>
          <Text style={styles.sectionArabic}>{t("deen.careerArabic")}</Text>
          <AnimatedPressable
            style={styles.careerCard}
            onPress={() => navigation.navigate("JobsFeed")}
            activeOpacity={0.9}
          >
            <View style={styles.careerLeft}>
              <View style={styles.iconCircle}>
                <JobIcon color={H.gold} size={32} />
              </View>
              <View style={styles.careerText}>
                <Text style={styles.careerTitle}>{t("deen.jobOpportunities")}</Text>
                <Text style={styles.careerArabic}>{t("deen.jobArabic")}</Text>
                <Text style={styles.careerDescription}>{t("deen.jobDesc")}</Text>
              </View>
            </View>
            <ArrowIcon color={H.gold} size={16} />
          </AnimatedPressable>
        </View>

        {/* Footer Dua */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{t("deen.footerText")}</Text>
          <Text style={styles.footerArabic}>{t("deen.footerArabic")}</Text>
        </View>
      </Animated.ScrollView>

      <BottomNav navigation={navigation} currentRoute={currentRoute} />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  scrollContent: { padding: 16, paddingBottom: 120 },

  quoteCard: {
    backgroundColor: H.card,
    borderRadius: 22,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: H.cardBorder,
    alignItems: "center",
    ...shadow(6, 0.08),
  },
  quoteArabic: {
    fontSize: 20,
    color: H.gold,
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
    fontFamily: "Georgia",
  },
  quoteText: {
    fontSize: 14,
    color: H.textDark,
    textAlign: "center",
    fontStyle: "italic",
    marginBottom: 8,
  },
  quoteReference: {
    fontSize: 11,
    color: H.textMuted,
    textAlign: "center",
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: H.textDark,
    fontFamily: "Georgia",
    marginBottom: 2,
  },
  sectionArabic: {
    fontSize: 11,
    color: H.textMuted,
    marginBottom: 14,
  },

  featuresGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  featureCard: {
    width: (SW - 44) / 2,
    backgroundColor: H.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
    alignItems: "center",
    marginBottom: 12,
    position: "relative",
    ...shadow(4, 0.06),
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: H.goldLight + "20",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: H.textDark,
    textAlign: "center",
    marginBottom: 2,
  },
  cardArabic: {
    fontSize: 11,
    color: H.goldDeep,
    textAlign: "center",
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 10,
    color: H.textMuted,
    textAlign: "center",
  },
  cardArrow: {
    position: "absolute",
    bottom: 8,
    right: 8,
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: H.gold,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: {
    color: H.white,
    fontSize: 10,
    fontWeight: "700",
  },

  careerSection: {
    marginBottom: 24,
  },
  careerCard: {
    backgroundColor: H.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...shadow(4, 0.06),
  },
  careerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  careerText: {
    marginLeft: 12,
    flex: 1,
  },
  careerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: H.textDark,
    marginBottom: 2,
  },
  careerArabic: {
    fontSize: 12,
    color: H.goldDeep,
    marginBottom: 2,
  },
  careerDescription: {
    fontSize: 11,
    color: H.textMuted,
  },

  footer: {
    alignItems: "center",
    paddingVertical: 20,
    gap: 6,
  },
  footerText: {
    fontSize: 11,
    color: H.textMuted,
    textAlign: "center",
  },
  footerArabic: {
    fontSize: 14,
    color: H.goldDeep,
    fontWeight: "500",
    fontFamily: "Georgia",
  },
});

// ─── Header Styles ────────────────────────────────────────────────────
const hs = StyleSheet.create({
  wrap: {
    height: 148,
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
  titleContainer: {
    flex: 1,
  },
  title: {
    color: H.white,
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Georgia",
    letterSpacing: 0.5,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.4)",
    justifyContent: "center",
    alignItems: "center",
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