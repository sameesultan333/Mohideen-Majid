// screens/CollectorDashboardScreen.jsx
import React, { useCallback, useEffect, useState, memo, useMemo, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Platform, SafeAreaView, StatusBar, Dimensions, Animated } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import { authApiFetch } from "../config/server";
import { COLORS as C, RADII, FONTS } from "../config/theme";
import BottomNav from "../components/BottomNav";
import Svg, { Path, Rect, Defs, LinearGradient, Stop, Circle } from "react-native-svg";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { useTopInset } from "../hooks/useSafeArea";

// ─── Helpers ──────────────────────────────────────────────────────────
const money = (v) => {
  const n = Number(v || 0);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
};
const getMonthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (key, delta) => {
  const [y, m] = key.split("-").map(Number);
  return getMonthKey(new Date(y, m - 1 + delta, 1));
};
const fmtMonth = (key) => {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

// ─── Palette ──────────────────────────────────────────────────────────
const H = {
  bg:         "#FBF9F4",
  card:       "#FFFFFF",
  cardBorder: "rgba(11,61,46,0.05)",
  headerDeep: C.bg,
  headerLight: C.bgVivid,
  gold:       C.gold,
  goldDeep:   C.goldDeep,
  goldLight:  C.goldLight,
  green:      "#0E6B45",
  textDark:   C.textDark,
  textMuted:  C.textMuted,
  amber:      "#9A6B2E",
  amberBg:    "rgba(154,107,46,0.06)",
  errorBg:    C.errorBg,
  error:      C.error,
  subtleGreen: "rgba(14,107,69,0.04)",
};

const sh = (y = 3, op = 0.04) =>
  Platform.select({
    ios: { shadowColor: "rgba(0,0,0,0.02)", shadowOffset: { width: 0, height: y }, shadowOpacity: op, shadowRadius: y * 1.2 },
    android: { elevation: Math.round(y * 0.5) },
  });

// ─── SVG Icons ──────────────────────────────────────────────────────
const IconWallet = memo(({ color = C.white, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 8 L20 8 L20 18 L4 18 Z M4 8 L8 6 L16 6 L20 8 M8 13 L12 13" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));
const IconCheck = memo(({ color = C.white, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M9 12 L11.5 14.5 L16 9" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));
const IconClock = memo(({ color = C.white, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M12 6 L12 12 L16 14" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
  </Svg>
));
const IconTrending = memo(({ color = C.white, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M3 17 L9 11 L13 15 L21 7" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M17 7 L21 7 L21 11" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));
const IconCash = memo(({ color = C.white, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="3" y="6" width="18" height="12" rx="2" stroke={color} strokeWidth={1.8} fill="none" />
    <Circle cx="12" cy="12" r="2.5" stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M7 6 L9 4 L15 4 L17 6" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
  </Svg>
));
const IconUpi = memo(({ color = C.white, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 6 L20 6 L20 18 L4 18 Z M8 10 L16 10 M8 14 L12 14" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    <Path d="M16 14 L16 14.01 M12 10 L12 10.01" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
));
const IconUsers = memo(({ color = C.white, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 12 C14 12 16 10 16 8 C16 6 14 4 12 4 C10 4 8 6 8 8 C8 10 10 12 12 12 Z M6 20 C6 16 9 14 12 14 C15 14 18 16 18 20 Z" stroke={color} strokeWidth={1.8} fill="none" strokeLinejoin="round" />
  </Svg>
));

// ─── Header Pattern ──────────────────────────────────────────────────
const HeaderPattern = memo(({ w = SW, h = 140 }) => {
  const step = 48;
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const stars = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * step + (r % 2 === 0 ? 0 : step / 2);
      const cy = r * step;
      stars.push(`M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z`);
    }
  }
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      {stars.map((d, i) => (
        <Path key={i} d={d} fill={C.gold} opacity={0.04} />
      ))}
    </Svg>
  );
});

// ─── Header Component ────────────────────────────────────────────────
const Header = memo(({ title, month, onPrev, onNext }) => {
  const topInset = useTopInset(14);
  return (
    <View style={[hs.wrap, { paddingTop: topInset }]}>
      <Svg width={SW} height={140 + topInset} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="chandaHeader" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={C.bg} />
            <Stop offset="1" stopColor={C.bgVivid} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={140 + topInset} fill="url(#chandaHeader)" />
      </Svg>
      <HeaderPattern w={SW} h={140} />
      <View style={hs.content}>
        <Text style={hs.eyebrow}>Mohideen Masjid</Text>
        <Text style={hs.title}>{title}</Text>
        <View style={hs.monthRow}>
          <AnimatedPressable onPress={onPrev} style={hs.mArrow} activeOpacity={0.7}>
            <Text style={hs.mArrowTxt}>‹</Text>
          </AnimatedPressable>
          <Text style={hs.monthTxt}>{fmtMonth(month)}</Text>
          <AnimatedPressable onPress={onNext} style={hs.mArrow} activeOpacity={0.7}>
            <Text style={hs.mArrowTxt}>›</Text>
          </AnimatedPressable>
        </View>
      </View>
    </View>
  );
});

// ─── Circular Progress ──────────────────────────────────────────────
const CircularProgress = memo(({ percentage, size = 100, strokeWidth = 7, color = C.gold }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(percentage, 0), 100);
  const strokeDashoffset = circumference * (1 - progress / 100);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgba(212,175,55,0.12)"
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        rotation="-90"
        origin={`${size / 2}, ${size / 2}`}
      />
      <Text
        style={{
          position: "absolute",
          top: size / 2 - 12,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 18,
          fontWeight: "800",
          color: C.textDark,
        }}
      >
        {progress}%
      </Text>
    </Svg>
  );
});

// ─── Stat Card ──────────────────────────────────────────────────────
const StatCard = memo(({ label, value, icon: Icon, color = C.textDark }) => (
  <View style={styles.statCard}>
    <View style={[styles.statIconWrap, { backgroundColor: color + "10" }]}>
      <Icon color={color} size={18} />
    </View>
    <Text style={styles.statValue} numberOfLines={1}>
      {value}
    </Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
));

// ─── Breakdown Item ──────────────────────────────────────────────────
const BreakdownItem = memo(({ label, value, color }) => (
  <View style={styles.breakdownRow}>
    <View style={styles.breakdownLeft}>
      <View style={[styles.breakdownDot, { backgroundColor: color }]} />
      <Text style={styles.breakdownLabel}>{label}</Text>
    </View>
    <Text style={[styles.breakdownValue, { color }]}>{value}</Text>
  </View>
));

// Module-level, keyed by month — survives this screen's remounts. The
// bottom "tabs" in this app are implemented as stack push/pop
// (navigation.navigate on a native-stack, not a real tab navigator), so
// switching away and back to this screen fully unmounts and remounts it.
// Without this cache, every remount reset straight to the full-screen
// spinner and replayed the entrance animation, which read as the
// dashboard "shaking" on every tab switch.
const dashboardCache = {};

// ─── Main Component ──────────────────────────────────────────────────
const CollectorDashboardScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [month, setMonth] = useState(getMonthKey());
  const [data, setData] = useState(() => dashboardCache[month] ?? null);
  const [loading, setLoading] = useState(() => !dashboardCache[month]);
  const [refreshing, setRefreshing] = useState(false);

  const hasCachedData = !!dashboardCache[month];
  const fadeAnim = useRef(new Animated.Value(hasCachedData ? 1 : 0)).current;
  const slideAnim = useRef(new Animated.Value(hasCachedData ? 0 : 30)).current;

  useEffect(() => {
    if (hasCachedData) return; // already visible — no entrance replay needed
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 7, useNativeDriver: true }),
    ]).start();
  }, []);

  const load = useCallback(
    async (isRefresh = false) => {
      // Only show the full-screen spinner when there's genuinely nothing
      // cached yet for this month — a background refresh or a remount that
      // already has cached data updates in place instead of flashing back
      // to a spinner.
      if (isRefresh) setRefreshing(true);
      else if (!dashboardCache[month]) setLoading(true);
      try {
        const res = await authApiFetch(`/finance/dashboard?month=${month}`);
        if (res.ok) {
          const json = await res.json();
          dashboardCache[month] = json;
          setData(json);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [month]
  );

  useEffect(() => {
    // Show cached data for the newly-selected month immediately (no spinner,
    // no stale previous-month flash) while load() refreshes it in the
    // background.
    if (dashboardCache[month]) setData(dashboardCache[month]);
    load();
  }, [month, load]);

  const handlePrevMonth = useCallback(() => setMonth((p) => shiftMonth(p, -1)), []);
  const handleNextMonth = useCallback(() => setMonth((p) => shiftMonth(p, 1)), []);
  const handleRefresh = useCallback(() => load(true), [load]);

  const chanda = data?.chanda;
  const cashFlow = data?.collection_periods?.this_month;
  const families = data?.families;
  const collectionPct = useMemo(() => chanda?.collection_pct ?? 0, [chanda]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}>
          <ActivityIndicator color={C.gold} size="large" />
          <Text style={styles.loadingText}>{t("common.loading")}</Text>
        </View>
        <BottomNav navigation={navigation} currentRoute="CollectorDashboard" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <Header
        title={t("collectorDashboard.title")}
        month={month}
        onPrev={handlePrevMonth}
        onNext={handleNextMonth}
      />

      <Animated.ScrollView
        style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.gold}
            colors={[C.gold]}
            progressBackgroundColor="#fff"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* === BIG PROGRESS CARD (top) === */}
        <View style={styles.progressCard}>
          <View style={styles.progressAccentLine} />
          <Text style={styles.progressLabel}>{t("collectorDashboard.collectionPct")}</Text>
          <View style={styles.progressWrap}>
            <CircularProgress percentage={collectionPct} size={110} color={C.gold} />
            <View>
              <Text style={styles.progressBig}>{collectionPct}%</Text>
              <Text style={styles.progressSub}>of target</Text>
            </View>
          </View>
        </View>

        {/* === Row 1: Expected, Collected, Outstanding (3 cards) === */}
        <View style={styles.statGrid3}>
          <StatCard
            label={t("collectorDashboard.expected")}
            value={`₹${money(chanda?.due)}`}
            icon={IconWallet}
            color="#5B6B62"
          />
          <StatCard
            label={t("collectorDashboard.collected")}
            value={`₹${money(chanda?.collected)}`}
            icon={IconCheck}
            color={C.bgVivid}
          />
          <StatCard
            label={t("collectorDashboard.outstanding")}
            value={`₹${money(chanda?.outstanding)}`}
            icon={IconClock}
            color={C.error}
          />
        </View>

        {/* === Row 2: Cash, UPI, Pending Families, Total Families (2x2) === */}
        <View style={styles.statGrid4}>
          <StatCard
            label={t("collectorDashboard.cash")}
            value={`₹${money(cashFlow?.cash)}`}
            icon={IconCash}
            color="#5B6B62"
          />
          <StatCard
            label={t("collectorDashboard.upi")}
            value={`₹${money(cashFlow?.upi)}`}
            icon={IconUpi}
            color="#1F3F73"
          />
          <StatCard
            label={t("collectorDashboard.pendingFamilies")}
            value={String(chanda?.pending ?? 0)}
            icon={IconUsers}
            color={C.error}
          />
          <StatCard
            label={t("collectorDashboard.totalFamilies")}
            value={String(families?.total ?? 0)}
            icon={IconUsers}
            color={C.bgVivid}
          />
        </View>

        {/* === Status Breakdown === */}
        <View style={styles.breakdownCard}>
          <Text style={styles.breakdownTitle}>{t("collectorDashboard.statusBreakdown")}</Text>
          <BreakdownItem
            label={t("collectorDashboard.paid")}
            value={chanda?.paid ?? 0}
            color={C.bgVivid}
          />
          <BreakdownItem
            label={t("collectorDashboard.partial")}
            value={chanda?.partial ?? 0}
            color={C.gold}
          />
          <BreakdownItem
            label={t("collectorDashboard.pending")}
            value={chanda?.pending ?? 0}
            color={C.error}
          />
        </View>

        <View style={{ height: 40 }} />
      </Animated.ScrollView>

      <BottomNav navigation={navigation} currentRoute="CollectorDashboard" />
    </SafeAreaView>
  );
};

export default memo(CollectorDashboardScreen);

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: H.bg },
  scrollContent: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: C.textMuted, marginTop: 16, fontSize: 14 },

  // ── Big progress card ──────────────────────────────────────────────
  progressCard: {
    backgroundColor: H.card,
    borderRadius: RADII.xl,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.15)",
    shadowColor: "rgba(0,0,0,0.02)",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  progressAccentLine: {
    position: "absolute",
    top: 0,
    left: 20,
    right: 20,
    height: 2.5,
    backgroundColor: C.gold,
    borderBottomLeftRadius: 2.5,
    borderBottomRightRadius: 2.5,
    opacity: 0.6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  progressWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  progressBig: {
    fontSize: 28,
    fontWeight: "800",
    color: C.textDark,
    fontFamily: FONTS.display,
  },
  progressSub: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── 3‑card row ─────────────────────────────────────────────────────
  statGrid3: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  // ── 4‑card grid (2x2) ─────────────────────────────────────────────
  statGrid4: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  statCard: {
    backgroundColor: H.card,
    borderRadius: RADII.md,
    padding: 10,
    flex: 1,
    minWidth: (SW - 48) / 3 - 4,
    borderWidth: 1,
    borderColor: H.cardBorder,
    shadowColor: "rgba(0,0,0,0.02)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    alignItems: "center",
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 2,
  },
  statValue: {
    fontSize: 15,
    fontWeight: "800",
    color: C.textDark,
    textAlign: "center",
  },
  statLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 1,
    textAlign: "center",
  },

  // ── Breakdown ──────────────────────────────────────────────────────
  breakdownCard: {
    backgroundColor: H.card,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: H.cardBorder,
    padding: 14,
    marginTop: 6,
    shadowColor: "rgba(0,0,0,0.02)",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  breakdownTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    fontFamily: FONTS.display,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(11,61,46,0.04)",
  },
  breakdownLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownLabel: { fontSize: 13, color: C.textMuted, fontWeight: "500" },
  breakdownValue: { fontSize: 15, fontWeight: "700" },
});

// ─── Header Styles ────────────────────────────────────────────────────
const hs = StyleSheet.create({
  wrap: {
    height: 140,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  content: {
    flex: 1,
    justifyContent: "center",
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.55)",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: C.white,
    fontFamily: FONTS.display || "Georgia",
    marginBottom: 6,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  mArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.25)",
  },
  mArrowTxt: {
    fontSize: 18,
    color: C.white,
    fontWeight: "700",
  },
  monthTxt: {
    fontSize: 15,
    fontWeight: "700",
    color: C.goldLight,
    letterSpacing: 0.4,
  },
});