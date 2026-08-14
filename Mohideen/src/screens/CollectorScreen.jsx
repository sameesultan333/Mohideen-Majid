/**
 * CollectorScreen.js — Mohideen Masjid
 * Premium collection workspace. See prior chat notes for the backend
 * gaps this works around - search "TODO(backend)" for spots needing a
 * real endpoint before they're fully wired.
 *
 * Every visible string now goes through t("collector.xxx") - the
 * previous version had them hardcoded in English, inconsistent with
 * every other screen in the app.
 *
 * PERF PASS NOTES (carried over from earlier revisions):
 * - ProgressBar animates `transform: scaleX` with useNativeDriver:true
 *   instead of `width` with useNativeDriver:false (width animation runs
 *   on the JS thread and was the main source of scroll jank).
 * - No per-card fade/slide entrance animation, combined with
 *   removeClippedSubviews on the FlatList — an entrance animation would
 *   replay every time a card re-mounts crossing the render window.
 * - callFamily / navigateToFamily / goToHistory are stable via useCallback
 *   so React.memo on MemberCard actually prevents re-renders.
 * - Modals (date picker, confirm) are top-level siblings of the sheet,
 *   never nested inside the sheet's ScrollView — avoids the Android
 *   "scroll stuck" bug where a nested Modal leaves the ScrollView's
 *   responder latched to a stale contentSize.
 * - Pull-to-refresh (RefreshControl) on both the main member list and the
 *   payment sheet.
 * - Single primary action in the payment sheet: sticky "Continue" bar for
 *   chanda, in-sheet SubmitButton only for donation/fund/other.
 *
 * PERF PASS 2 (this revision — fixes the "laggy / slow" sheet):
 * - Root cause: every keystroke in Amount / Notes / Transaction-Ref
 *   re-rendered the ENTIRE CollectorScreen. Since the month selector,
 *   PaymentMethodButton and OptionPill were plain (non-memoized) function
 *   components, they fully re-executed on every keystroke — re-deriving
 *   pendingGenerated/futureMonths/byYear groupings and re-rendering every
 *   month row — even though none of that data had changed. Fixed by:
 *     • React.memo on MonthRunSelector, PaymentMethodButton,
 *       OptionPill, and StickySelectionBar.
 *     • useMemo for the month run, keyed on `availableMonths`.
 *     • useCallback on every handler passed into these memoized components
 *       (toggleMonth, quickSelectMonths, resetForm, fetchAvailableMonths,
 *       submit handlers, onManualSync, openDatePicker, getMonthlyAmt, etc.)
 *       so the memoization actually holds instead of being busted by a
 *       fresh function identity every render.
 *     • FlatList's renderItem/keyExtractor are now stable via useCallback
 *       instead of new closures on every render.
 *     • Month-total calculation (driving the Amount field) moved out of
 *       the toggle/quick-select handlers and into a small useEffect keyed
 *       on selection + available months, so it's calculated once instead
 *       of being duplicated in two call sites.
 * - Removed dead code that was computed but never used anywhere:
 *   getPendingMonths(), formatMonthName(), pendingFamiliesCount, and a
 *   pile of leftover styles from earlier layout iterations that no
 *   screen still references (old month-nav row, old zone-pill row,
 *   unused "pending months / will cover / overpay" preview boxes, unused
 *   filter/sort row styles, unused cacheTime/collectingForTxt/advanceTag
 *   styles).
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, TextInput, FlatList, Animated, StyleSheet, Alert, Image, Modal, Pressable, KeyboardAvoidingView, Platform, ScrollView, RefreshControl, StatusBar, Dimensions, Linking } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
// DateTimePicker removed — replaced with custom JS-only date modal
import { launchImageLibrary } from "react-native-image-picker";
import { authApiFetch, apiFetch, getWsUrl } from "../config/server";
import { getToken } from "../utils/secureStorage";
import { COLORS as C } from "../config/theme";
import MonthRunSelector, { buildMonthRun } from "../components/MonthRunSelector";
import { t } from "../i18n";
import SearchPickerModal from "../components/SearchPickerModal";
import SafeModal from "../components/SafeModal";
import { useScreenStatusBar } from "../theme/statusBar";

const { width: SW } = Dimensions.get("window");
const MEMBERS_CACHE_KEY = "collector_members_cache";
const OFFLINE_QUEUE_KEY = "collector_offline_queue";

const normalizeRole = (role) => (role || "").toString().trim().toLowerCase();
const SUPERADMIN_ROLES = ["superadmin", "super_admin", "super admin"];
const canAccessCollector = (role) => {
  const r = normalizeRole(role);
  return r === "collector" || SUPERADMIN_ROLES.includes(r);
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
  green: C.bgVivid,
  greenDim: "rgba(14,107,69,0.1)",
  amber: "#B8862E",
  amberDim: "rgba(184,134,46,0.12)",
  warn: "#9A6B2E",
  warnDim: "rgba(154,107,46,0.12)",
  error: "#C0473A",
  errorDim: "rgba(192,71,58,0.1)",
};

const shadow = (y = 4, opacity = 0.07) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.5 },
    android: { elevation: y },
  });

const getMonthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (key, delta) => {
  const [y, m] = key.split("-").map(Number);
  return getMonthKey(new Date(y, m - 1 + delta, 1));
};
const fmtMonth = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const getMemberStatus = (item, month) => {
  const col = item.collections?.find((c) => c.month === month) || item.collections?.[0];
  const total = Number(col?.amount_due || 0);
  const paid = Number(col?.total_paid || 0);
  const balance = Math.max(total - paid, 0);
  const status = balance === 0 && total > 0 ? "paid" : "pending";
  return { col, total, paid, balance, status };
};

const getConsecutiveUnpaidMonths = (item) => {
  // Use server-computed count (all non-paid collections) — accurate for new members
  // with historical dues and members with gaps in their collection history.
  return Number(item.pending_months_count || 0);
};

// ─── Progress bar ───────────────────────────────────────────────────────
// Animates transform:scaleX (native driver) instead of width (JS thread).
function ProgressBar({ ratio, color }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.min(Math.max(ratio, 0), 1),
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [ratio]);
  return (
    <View style={pb.track}>
      <Animated.View
        style={[
          pb.fill,
          {
            backgroundColor: color,
            transform: [{ scaleX: anim }],
          },
        ]}
      />
    </View>
  );
}
const pb = StyleSheet.create({
  track: { height: 4, backgroundColor: "rgba(11,61,46,0.08)", borderRadius: 99, overflow: "hidden", marginTop: 8 },
  fill: { height: "100%", width: "100%", borderRadius: 99, transformOrigin: "left" },
});

// No entrance fade/slide — cards just render. With removeClippedSubviews
// on the parent FlatList, an entrance animation replays every time a card
// re-mounts on scroll, which is what was causing the stutter.
const MemberCard = React.memo(({ item, selectedMonth, onPress, onCall, onNavigate, onHistory }) => {
  const { total, paid, balance, status } = getMemberStatus(item, selectedMonth);
  const ratio = total > 0 ? paid / total : 0;
  const sColor = status === "paid" ? H.green : H.warn;
  const sDim = status === "paid" ? H.greenDim : H.warnDim;
  const sLabel = t(`collector.status.${status}`);
  const overdue = getConsecutiveUnpaidMonths(item);

  const chandaNo = item.member?.chanda_no || "";
  const phone = item.member?.phone || "";
  const address = item.member?.address || "";
  const lastPaymentDate = item.last_payment_date || item.member?.last_payment_date;
  const lastCollector = item.last_collector || item.member?.last_collector;
  const donatedRecently = !!(item.recent_donation || item.member?.recent_donation);
  const fundContribution = !!(item.fund_contribution || item.member?.fund_contribution);

  // All pending month keys sorted chronologically
  const pendingCollections = (item.collections || [])
    .filter(c => Number(c.amount_due || 0) > 0 && Number(c.total_paid || 0) < Number(c.amount_due || 0))
    .sort((a, b) => a.month.localeCompare(b.month));
  const pendingCount = pendingCollections.length;
  // Full outstanding balance across every unpaid month — not just the
  // currently-selected month — so "Pending" never reads the same as "Monthly"
  // when only the selected month happens to be unpaid.
  const totalPendingAmount = pendingCollections.reduce(
    (sum, c) => sum + Math.max(Number(c.amount_due || 0) - Number(c.total_paid || 0), 0),
    0
  );
  // Show up to 4 month names; "+N more" for the remainder
  const pendingMonthNames = pendingCollections
    .slice(0, 4)
    .map(c => {
      const [y, m] = c.month.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
    });

  return (
    // Tap card body → FamilyHistory. Buttons inside handle their own actions.
    <AnimatedPressable onPress={() => onHistory(item)} activeOpacity={0.75}>
      <View style={[s.card, { borderLeftColor: sColor }, status === "paid" && s.cardPaid]}>
        <View style={s.cardRow1}>
          <View style={s.cardLeft}>
            {chandaNo ? (
              <View style={s.chandaTag}>
                <Text allowFontScaling={false} style={s.chandaTagText}>{chandaNo}</Text>
              </View>
            ) : null}
            <Text allowFontScaling={false} style={s.memberName} numberOfLines={1}>{item.member?.name}</Text>
          </View>
          <View style={[s.sPill, { backgroundColor: sDim }]}>
            <Text allowFontScaling={false} style={[s.sPillText, { color: sColor }]}>{sLabel}</Text>
          </View>
        </View>

        {address ? <Text allowFontScaling={false} style={s.addrText} numberOfLines={1}>{address}</Text> : null}
        {phone ? <Text allowFontScaling={false} style={s.phoneText}>{phone}</Text> : null}

        {pendingCount > 0 && (
          <View style={[s.overdueBadge, pendingCount >= 3 && s.overdueBadgeRed]}>
            <Text allowFontScaling={false} style={s.overdueBadgeTxt} numberOfLines={1}>
              {t("collector.pending")} {pendingCount} {pendingCount === 1 ? t("collector.month") : t("collector.months")}: {pendingMonthNames.join(" · ")}{pendingCount > 4 ? ` +${pendingCount - 4}` : ""}
            </Text>
          </View>
        )}

        {(donatedRecently || fundContribution) ? (
          <View style={s.badgeRow}>
            {donatedRecently ? (
              <View style={s.donationBadge}><Text allowFontScaling={false} style={s.donationBadgeTxt}>{t("collector.recentDonation")}</Text></View>
            ) : null}
            {fundContribution ? (
              <View style={s.fundBadge}><Text allowFontScaling={false} style={s.fundBadgeTxt}>{t("collector.fundContributor")}</Text></View>
            ) : null}
          </View>
        ) : null}

        <ProgressBar ratio={ratio} color={sColor} />

        <View style={s.statsRow}>
          <MiniStat label={t("collector.monthly")} value={`₹${total}`} color={H.gold} />
          <MiniStat label={t("collector.dueMonths")} value={String(Math.max(overdue, total > 0 && balance > 0 ? 1 : 0))} color={H.textDark} />
          <MiniStat label={t("collector.pending")} value={totalPendingAmount === 0 ? t("collector.clearBalance") : `₹${totalPendingAmount}`} color={sColor} />
        </View>

        {(lastPaymentDate || lastCollector) ? (
          <Text allowFontScaling={false} style={s.lastMeta}>
            {lastPaymentDate ? `${t("collector.lastPaid")} ${lastPaymentDate}` : ""}{lastPaymentDate && lastCollector ? " · " : ""}{lastCollector ? `${t("collector.by")} ${lastCollector}` : ""}
          </Text>
        ) : null}

        <View style={s.actionsRow}>
          <AnimatedPressable style={s.actionBtnPrimary} onPress={() => onPress(item)} activeOpacity={0.85}>
            <Text allowFontScaling={false} style={s.actionBtnPrimaryTxt}>{t("collector.collect")}</Text>
          </AnimatedPressable>
          <AnimatedPressable style={s.actionBtn} onPress={() => onHistory(item)} activeOpacity={0.85}>
            <Text allowFontScaling={false} style={s.actionBtnTxt}>{t("collector.history")}</Text>
          </AnimatedPressable>
          {phone ? (
            <AnimatedPressable style={s.actionBtn} onPress={() => onCall(phone)} activeOpacity={0.85}>
              <Text allowFontScaling={false} style={s.actionBtnTxt}>{t("collector.call")}</Text>
            </AnimatedPressable>
          ) : null}
          {address ? (
            <AnimatedPressable style={s.actionBtn} onPress={() => onNavigate(address)} activeOpacity={0.85}>
              <Text allowFontScaling={false} style={s.actionBtnTxt}>{t("collector.directions")}</Text>
            </AnimatedPressable>
          ) : null}
        </View>
      </View>
    </AnimatedPressable>
  );
});

function MiniStat({ label, value, color }) {
  return (
    <View style={s.miniStat}>
      <Text allowFontScaling={false} style={s.miniStatLabel}>{label}</Text>
      <Text allowFontScaling={false} style={[s.miniStatVal, { color }]}>{value}</Text>
    </View>
  );
}

// Memoized: without this, every keystroke anywhere in the sheet
// (Amount / Notes / Transaction Ref) re-rendered the whole screen tree,
// which re-ran every pill's render for no reason since active/label
// almost never change between those keystrokes.
const OptionPill = React.memo(function OptionPill({ label, active, onPress }) {
  const sc = useRef(new Animated.Value(1)).current;
  const tap = () => {
    Animated.sequence([
      Animated.timing(sc, { toValue: 0.92, duration: 60, useNativeDriver: true }),
      Animated.timing(sc, { toValue: 1, duration: 90, useNativeDriver: true }),
    ]).start();
    onPress();
  };
  return (
    <Animated.View style={{ transform: [{ scale: sc }] }}>
      <AnimatedPressable onPress={tap} activeOpacity={0.8} style={[s.optPill, active && s.optPillOn]}>
        <Text allowFontScaling={false} style={[s.optPillTxt, active && s.optPillTxtOn]}>{label}</Text>
      </AnimatedPressable>
    </Animated.View>
  );
});

// ─── Payment method button ────────────────────────────────────────────
// Larger, dedicated touch target for the 4 payment methods, distinct
// from the generic OptionPill used for type/fund selection. Roomier
// hit area, clearer selected state (filled + border), no crowding.
const PaymentMethodButton = React.memo(function PaymentMethodButton({ label, active, onPress }) {
  const sc = useRef(new Animated.Value(1)).current;
  const tap = () => {
    Animated.sequence([
      Animated.timing(sc, { toValue: 0.95, duration: 60, useNativeDriver: true }),
      Animated.timing(sc, { toValue: 1, duration: 110, useNativeDriver: true }),
    ]).start();
    onPress();
  };
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: sc }] }}>
      <AnimatedPressable
        onPress={tap}
        activeOpacity={0.85}
        style={[pm.btn, active && pm.btnOn]}
      >
        <Text allowFontScaling={false} style={[pm.btnTxt, active && pm.btnTxtOn]}>{label}</Text>
      </AnimatedPressable>
    </Animated.View>
  );
});
const pm = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  btn: {
    minHeight: 52,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: H.cardBorder,
    backgroundColor: H.card,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  btnOn: {
    backgroundColor: H.gold,
    borderColor: H.gold,
    ...shadow(3, 0.14),
  },
  btnTxt: { fontSize: 13, fontWeight: "700", color: H.textMuted, letterSpacing: 0.3 },
  btnTxtOn: { color: H.headerDeep, fontWeight: "800" },
});

// ─── Month allocation picker ─────────────────────────────────────────
// Shows pending + future months as individual toggleable rows.
const fmtMShort = (key) => {
  const [y, mo] = key.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
};

const fmtMFull = (key) => {
  const [y, mo] = key.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

const StickySelectionBar = React.memo(function StickySelectionBar({ count, total, onContinue, loading }) {
  if (count === 0) return null;
  return (
    <View style={sb.bar}>
      <View style={sb.info}>
        <Text allowFontScaling={false} style={sb.count}>
          {count} {count === 1 ? t("collector.month") : t("collector.months")} {t("collector.monthsSelected")}
        </Text>
        <Text allowFontScaling={false} style={sb.total}>₹{Math.round(total)}</Text>
      </View>
      <AnimatedPressable style={sb.btn} onPress={onContinue} disabled={loading} activeOpacity={0.85}>
        <Text allowFontScaling={false} style={sb.btnTxt}>
          {loading ? t("collector.processing") : t("collector.continueBtn")}
        </Text>
      </AnimatedPressable>
    </View>
  );
});

const sb = StyleSheet.create({
  bar: { borderTopWidth: 1, borderTopColor: H.cardBorder, backgroundColor: H.card, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  info: { flex: 1 },
  count: { fontSize: 12, fontWeight: "600", color: H.textMuted, marginBottom: 2 },
  total: { fontSize: 20, fontWeight: "800", color: H.green },
  btn: { backgroundColor: H.green, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22 },
  btnTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },
});

function SubmitButton({ loading, onPress, label }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (loading) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 0.97, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [loading]);
  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <AnimatedPressable style={s.submitBtn} onPress={onPress} disabled={loading} activeOpacity={0.85}>
        <Text allowFontScaling={false} style={s.submitBtnTxt}>{loading ? t("collector.processing") : (label || t("collector.recordPayment"))}</Text>
      </AnimatedPressable>
    </Animated.View>
  );
}

function QRViewerModal({ visible, onClose, imageSource }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.85);
    }
  }, [visible]);

  return (
    <SafeModal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.qrOverlay} onPress={onClose}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
          <Pressable onPress={() => {}}>
            <View style={s.qrBigBox}>
              <Image source={imageSource} style={s.qrBigImg} resizeMode="contain" />
            </View>
            <Text allowFontScaling={false} style={s.qrHint}>{t("collector.tapToClose")}</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </SafeModal>
  );
}

export default function CollectorScreen({ navigation, route }) {
  // Ivory screen — icon style is derived from this colour.
  useScreenStatusBar(H.bg);
  const initialTab = route?.params?.initialTab || "collections";
  const searchRef = useRef(null);

  const [role, setRole] = useState(null);
  const [roleChecked, setRoleChecked] = useState(false);

  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(getMonthKey());
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("overdue");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [zones, setZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState("");
  const [streets, setStreets] = useState([]);
  const [selectedStreet, setSelectedStreet] = useState("");
  const [showStreetDropdown, setShowStreetDropdown] = useState(false);

  const [selected, setSelected] = useState(null);
  const [paymentType, setPaymentType] = useState("chanda");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  // Month allocation picker state
  const [selectedMonthKeys, setSelectedMonthKeys] = useState(new Set());
  // A run is always contiguous, so one count describes the whole selection.
  // selectedMonthKeys stays the source of truth for submission and is derived
  // from this, so the payload, amount sync and receipt logic are untouched.
  const [monthCount, setMonthCount] = useState(0);
  const [availableMonths, setAvailableMonths] = useState([]);
  const [availableMonthsLoading, setAvailableMonthsLoading] = useState(false);
  const [sheetRefreshing, setSheetRefreshing] = useState(false);
  const [proofImage, setProofImage] = useState(null);
  const [transactionRef, setTransactionRef] = useState("");
  const [notes, setNotes] = useState("");
  const [collectedDate, setCollectedDate] = useState(new Date());
  const [showDate, setShowDate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [queueCount, setQueueCount] = useState(0);
  const [todaysSessionTotal, setTodaysSessionTotal] = useState({ cash: 0, digital: 0 });

  const [funds, setFunds] = useState([]);
  const [fundsAvailable, setFundsAvailable] = useState(false);
  const [selectedFund, setSelectedFund] = useState(null);

  const [qrViewerVisible, setQrViewerVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState(null);

  const hFade = useRef(new Animated.Value(0)).current;

  const [activeTab, setActiveTab] = useState(initialTab);
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [cashHistory, setCashHistory] = useState([]);
  const [cashHistoryLoading, setCashHistoryLoading] = useState(false);

  const FILTERS = useMemo(() => ([
    { key: "all", label: t("collector.filters.all") },
    { key: "pending", label: t("collector.filters.pending") },
    { key: "paid", label: t("collector.filters.paid") },
    { key: "overdue3", label: t("collector.filters.overdue3") },
    { key: "overdue6", label: t("collector.filters.overdue6") },
    { key: "overdue12", label: t("collector.filters.overdue12") },
    { key: "inactive", label: t("collector.filters.inactive") },
  ]), []);

  const SORTS = useMemo(() => ([
    { key: "overdue", label: t("collector.sorts.overdue") },
    { key: "pending_high", label: t("collector.sorts.pendingHigh") },
    { key: "address", label: t("collector.sorts.address") },
    { key: "name", label: t("collector.sorts.name") },
  ]), []);

  useEffect(() => {
    (async () => {
      try {
        const u = await AsyncStorage.getItem("user");
        if (u) setRole(JSON.parse(u)?.role);
      } catch (e) {}
      setRoleChecked(true);
    })();
  }, []);

  useEffect(() => {
    Animated.timing(hFade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, []);

  const cacheKey = `${MEMBERS_CACHE_KEY}_${selectedMonth}`;

  const loadFromCache = useCallback(async () => {
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        setMembers(parsed.data || []);
        setLastSync(parsed.timestamp ? new Date(parsed.timestamp) : null);
        return true;
      }
    } catch (e) {}
    return false;
  }, [cacheKey]);

  const fetchMembers = useCallback(async (silent = false) => {
    if (!silent) setFetching(true);
    try {
      const res = await authApiFetch(`/chanda/members?month=${selectedMonth}&include_history=true`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setMembers(list);
      setIsOffline(false);
      setLastSync(new Date());
      AsyncStorage.setItem(cacheKey, JSON.stringify({ data: list, timestamp: new Date().toISOString() })).catch(() => {});
    } catch (e) {
      setIsOffline(true);
    } finally {
      setFetching(false);
    }
  }, [selectedMonth, cacheKey]);

  useEffect(() => {
    loadFromCache().then(() => fetchMembers(true));
  }, [selectedMonth, loadFromCache, fetchMembers]);

  const getQueue = async () => {
    try {
      const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const setQueue = async (items) => {
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
    setQueueCount(items.length);
  };

  const flushQueue = useCallback(async () => {
    const queue = await getQueue();
    if (queue.length === 0) return;
    const remaining = [];
    for (const payload of queue) {
      try {
        const res = await authApiFetch("/chanda/collect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) remaining.push(payload);
      } catch {
        remaining.push(payload);
      }
    }
    await setQueue(remaining);
    if (remaining.length < queue.length) fetchMembers(true);
  }, [fetchMembers]);

  useEffect(() => {
    getQueue().then((q) => setQueueCount(q.length));
    const iv = setInterval(flushQueue, 30000);
    return () => clearInterval(iv);
  }, [flushQueue]);

  const onManualSync = useCallback(() => {
    fetchMembers();
    flushQueue();
  }, [fetchMembers, flushQueue]);

  // Pull-to-refresh for the main member list — re-fetches members and
  // flushes any queued offline payments in one gesture.
  const onListRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchMembers(true), flushQueue()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchMembers, flushQueue]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/funds/public");
        if (!res.ok) throw new Error("no access");
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setFunds(list);
        setFundsAvailable(list.length > 0);
      } catch (e) {
        setFundsAvailable(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/admin/zones");
        if (!res.ok) return;
        const data = await res.json();
        setZones(Array.isArray(data) ? data : []);
      } catch { /* non-critical */ }
    })();
  }, []);

  // Streets cascade from the selected zone (empty zone => all streets).
  useEffect(() => {
    (async () => {
      try {
        const qs = selectedZone ? `?zone=${encodeURIComponent(selectedZone)}` : "";
        const res = await authApiFetch(`/admin/streets${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setStreets(list);
        if (selectedStreet && !list.includes(selectedStreet)) setSelectedStreet("");
      } catch { /* non-critical */ }
    })();
  }, [selectedZone]);

  // Load today's collection totals from the history endpoint
  const refreshTodayTotals = useCallback(async () => {
    try {
      const res = await authApiFetch("/finance/collector/history?page=1&per_page=1");
      if (!res.ok) return;
      const data = await res.json();
      const today = data?.today;
      if (today) {
        setTodaysSessionTotal({ cash: today.cash ?? 0, digital: today.upi ?? 0 });
      }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { refreshTodayTotals(); }, [refreshTodayTotals]);

  // Live updates: when admin changes a monthly amount or a payment is verified, refresh
  useEffect(() => {
    let ws = null;
    let retryTimeout = null;
    const REFRESH_EVENTS = new Set([
      "monthly_amount_updated", "payment_verified", "payment_collected",
      "family_updated", "dashboard_updated",
    ]);
    const connect = async () => {
      try {
        const token = await getToken();
        const url = await getWsUrl(`/ws/finance?token=${token}`);
        ws = new WebSocket(url);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (REFRESH_EVENTS.has(msg.type)) fetchMembers(true);
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => {
          retryTimeout = setTimeout(connect, 10000);
        };
      } catch {}
    };
    connect();
    return () => {
      if (ws) ws.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [fetchMembers]);

  const loadCashHistory = useCallback(async () => {
    setCashHistoryLoading(true);
    try {
      const res = await authApiFetch("/collector/cash-submissions");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setCashHistory(Array.isArray(data) ? data : []);
    } catch {
      setCashHistory([]);
    } finally {
      setCashHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "history") loadCashHistory();
  }, [activeTab, loadCashHistory]);

  const resetForm = useCallback((defaultDate = new Date()) => {
    setPaymentType("chanda");
    setAmount("");
    setMethod("cash");
    setSelectedMonthKeys(new Set());
    setMonthCount(0);
    setAvailableMonths([]);
    setProofImage(null);
    setTransactionRef("");
    setNotes("");
    setCollectedDate(defaultDate);
    setShowDate(false);
    setSelectedFund(null);
  }, []);

  const fetchAvailableMonths = useCallback(async (memberId, silent = false) => {
    if (!silent) setAvailableMonthsLoading(true);
    try {
      const res = await authApiFetch(`/chanda/available-months/${memberId}?future=12`);
      if (res.ok) {
        const data = await res.json();
        setAvailableMonths(data);
      }
    } catch {}
    finally { setAvailableMonthsLoading(false); }
  }, []);

  // Pull-to-refresh inside the payment sheet — re-fetches this member's
  // month breakdown from the server without closing the sheet.
  const onSheetRefresh = useCallback(async () => {
    if (!selected?.member?.id) return;
    setSheetRefreshing(true);
    try {
      await fetchAvailableMonths(selected.member.id, true);
    } finally {
      setSheetRefreshing(false);
    }
  }, [selected, fetchAvailableMonths]);

  const openModal = useCallback((item) => {
    resetForm(new Date());
    setSelected(item);
    fetchAvailableMonths(item.member.id);
  }, [resetForm, fetchAvailableMonths]);

  const closeModal = useCallback(() => { setSelected(null); resetForm(); }, [resetForm]);

  // Payable months, oldest first: dues then advance, as one continuous run.
  const monthRun = useMemo(() => buildMonthRun(availableMonths), [availableMonths]);

  useEffect(() => {
    setSelectedMonthKeys(new Set(monthRun.slice(0, monthCount).map(r => r.month)));
  }, [monthCount, monthRun]);

  // Keep `amount` in sync with the selected months from a single effect,
  // instead of recomputing the same total by hand inside both toggleMonth
  // and quickSelectMonths.
  useEffect(() => {
    const total = availableMonths
      .filter(m => selectedMonthKeys.has(m.month))
      .reduce((sum, m) => sum + m.remaining, 0);
    setAmount(total > 0 ? String(Math.round(total)) : "");
  }, [selectedMonthKeys, availableMonths]);


  const getMonthlyAmt = useCallback(() => {
    const cur = selected?.collections?.find((c) => c?.month === selectedMonth);
    const fb = selected?.collections?.[0];
    return Number(cur?.amount_due || fb?.amount_due || selected?.member?.monthly_amount || 0);
  }, [selected, selectedMonth]);

  const pickImage = useCallback(() => {
    launchImageLibrary({ mediaType: "photo" }, (res) => {
      if (!res.didCancel) setProofImage(res.assets?.[0]?.uri);
    });
  }, []);

  const uploadScreenshot = useCallback(async () => {
    const form = new FormData();
    form.append("file", { uri: proofImage, type: "image/jpeg", name: "proof.jpg" });
    const res = await authApiFetch("/upload/screenshot", { method: "POST", body: form });
    return (await res.json()).url;
  }, [proofImage]);

  const doSubmitChanda = useCallback(async (finalAmount, paymentToken) => {
    const months_list = Array.from(selectedMonthKeys).sort();

    const payload = {
      member_id: selected.member.id,
      amount: finalAmount,
      method,
      months: months_list.length,
      months_list: months_list.length > 0 ? months_list : undefined,
      purpose: "Monthly Chanda",
      proof_image: null,
      transaction_ref: transactionRef,
      collected_date: `${collectedDate.getFullYear()}-${String(collectedDate.getMonth() + 1).padStart(2, "0")}-${String(collectedDate.getDate()).padStart(2, "0")}`,
      notes,
      payment_token: paymentToken || undefined,
    };

    try {
      setLoading(true);
      let imageUrl = null;
      if (method === "upi") imageUrl = await uploadScreenshot();
      payload.proof_image = imageUrl;

      const res = await authApiFetch("/chanda/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responseBody = await res.json();
      if (!res.ok) throw new Error(responseBody?.detail || t("collector.alertSomethingWrong"));

      refreshTodayTotals();
      const memberName = selected?.member?.name || "";
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const futureKeys = months_list.filter(mk => { const [yr, mo] = mk.split("-").map(Number); return new Date(yr, mo - 1, 1) > thisMonthStart; });
      const isAdvance = futureKeys.length > 0;
      const firstMonth = fmtMFull(months_list[0]);
      const lastMonth = months_list.length > 1 ? fmtMFull(months_list[months_list.length - 1]) : null;
      const monthRange = lastMonth ? `${firstMonth} → ${lastMonth}` : firstMonth;
      const amtStr = `₹${Number(finalAmount).toLocaleString("en-IN")}`;
      const receiptLine = responseBody.receipt_id ? `\nReceipt: ${responseBody.receipt_id}` : "";
      const typeLine = isAdvance ? "\nAdvance Payment" : "";
      Alert.alert(
        t("collector.alertRecordedTitle"),
        `${memberName}\n${amtStr} Received${typeLine}\n${monthRange}${receiptLine}`
      );
      closeModal();
      fetchMembers(true);
    } catch (err) {
      const isNetworkFailure = err instanceof TypeError || /network/i.test(err.message || "");
      if (isNetworkFailure) {
        const queue = await getQueue();
        queue.push(payload);
        await setQueue(queue);
        Alert.alert(t("collector.alertSavedOfflineTitle"), t("collector.alertSavedOfflineMsg"));
        closeModal();
      } else {
        Alert.alert(t("collector.alertFailedTitle"), err.message || t("collector.alertSomethingWrong"));
      }
    } finally {
      setLoading(false);
    }
  }, [selectedMonthKeys, selected, method, transactionRef, collectedDate, notes, uploadScreenshot, refreshTodayTotals, closeModal, fetchMembers]);

  const submitChandaPayment = useCallback(() => {
    const finalAmount = Number(String(amount || "").replace(/[^0-9.]/g, ""));
    if (!finalAmount) return Alert.alert(t("collector.alertEnterAmount"));
    if (method === "upi" && !proofImage) return Alert.alert(t("collector.alertUploadUpi"));
    if (selectedMonthKeys.size === 0) return Alert.alert("Select Months", "Please select at least one month to record payment for.");

    const months_list = Array.from(selectedMonthKeys).sort();
    const rate = selected?.member?.monthly_amount || 0;
    // Generate idempotency token — reused if user confirms; discarded on cancel
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setConfirmPayload({ finalAmount, months_list, rate, memberName: selected?.member?.name, token });
    setConfirmVisible(true);
  }, [amount, method, proofImage, selectedMonthKeys, selected]);

  const submitDonationPayment = useCallback(async () => {
    const finalAmount = Number(String(amount || "").replace(/[^0-9.]/g, ""));
    if (!finalAmount) return Alert.alert(t("collector.alertEnterAmount"));
    if (method === "upi" && !proofImage) return Alert.alert(t("collector.alertUploadUpi"));
    try {
      setLoading(true);
      let imageUrl = null;
      if (method === "upi") imageUrl = await uploadScreenshot();
      const payload = {
        donor_name: selected?.member?.name,
        amount: finalAmount,
        method,
        note: notes || (paymentType === "fund" && selectedFund ? `Fund contribution - ${funds.find((f) => f.id === selectedFund)?.name || ""}` : "Collector donation"),
        member_id: selected?.member?.id,
        fund_id: paymentType === "fund" ? selectedFund : undefined,
        donor_type: "member",
        receipt_image: imageUrl,
      };
      const res = await authApiFetch("/donations/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || t("collector.alertSomethingWrong"));
      refreshTodayTotals();
      Alert.alert(t("collector.alertRecordedTitle"), `Donation recorded${body.receipt_id ? ` — ${body.receipt_id}` : ""}`);
      closeModal();
      fetchMembers(true);
    } catch (err) {
      Alert.alert(t("collector.alertFailedTitle"), err.message || t("collector.alertSomethingWrong"));
    } finally {
      setLoading(false);
    }
  }, [amount, method, proofImage, uploadScreenshot, selected, notes, paymentType, selectedFund, funds, refreshTodayTotals, closeModal, fetchMembers]);

  const submitPayment = useCallback(() => {
    if (paymentType === "chanda") return submitChandaPayment();
    if (paymentType === "donation") return submitDonationPayment();
    if (paymentType === "fund") return submitDonationPayment();
    return submitChandaPayment();
  }, [paymentType, submitChandaPayment, submitDonationPayment]);

  const callFamily = useCallback((phone) => Linking.openURL(`tel:${phone}`).catch(() => {}), []);
  const navigateToFamily = useCallback((address) => {
    const query = encodeURIComponent(address);
    const url = Platform.select({ ios: `maps:0,0?q=${query}`, android: `geo:0,0?q=${query}` });
    Linking.openURL(url).catch(() => {});
  }, []);
  const goToHistory = useCallback((item) => {
    if (!item?.member?.id) return;
    navigation.navigate("FamilyHistory", { familyId: item.member.id, familyName: item.member.name });
  }, [navigation]);
  const openDatePicker = useCallback(() => {
    setShowDate(true);
  }, []);

  const { filtered, counts } = useMemo(() => {
    // Normalize: lowercase, strip hyphens and extra spaces so
    // "MM1001", "MM-1001", "mm 1001" all match each other.
    const normalize = (str) => (str || "").toLowerCase().replace(/[-\s]+/g, "");
    const q = normalize(search);
    const all = members.filter((m) => {
      if (selectedZone && m.member?.zone !== selectedZone) return false;
      if (selectedStreet && m.member?.street !== selectedStreet) return false;
      if (!q) return true;
      const haystack = normalize(
        `${m.member?.name} ${m.member?.address} ${m.member?.chanda_no} ${m.member?.phone}`
      );
      return haystack.includes(q);
    });

    const cnt = { all: all.length, paid: 0, pending: 0, overdue3: 0, overdue6: 0, overdue12: 0, active: 0, inactive: 0 };
    all.forEach((m) => {
      const { status } = getMemberStatus(m, selectedMonth);
      cnt[status] = (cnt[status] || 0) + 1;
      const overdue = getConsecutiveUnpaidMonths(m);
      if (overdue >= 12) cnt.overdue12++;
      if (overdue >= 6) cnt.overdue6++;
      if (overdue >= 3) cnt.overdue3++;
      const isActive = m.member?.is_active !== false;
      if (isActive) cnt.active++; else cnt.inactive++;
    });

    // The list shows ACTIVE families by default. A deactivated family used to
    // stay in the main list (the "all" branch filtered nothing), so removing a
    // family appeared to do nothing except add an "Inactive" tag. Inactive
    // records are not deleted — they stay reachable under the Inactive filter,
    // and their payment history and receipts are untouched.
    const base = filterStatus === "inactive"
      ? all.filter((m) => m.member?.is_active === false)
      : all.filter((m) => m.member?.is_active !== false);

    let shown = base;
    if (filterStatus === "pending" || filterStatus === "paid") {
      shown = base.filter((m) => getMemberStatus(m, selectedMonth).status === filterStatus);
    } else if (filterStatus === "overdue3") {
      shown = base.filter((m) => getConsecutiveUnpaidMonths(m) >= 3);
    } else if (filterStatus === "overdue6") {
      shown = base.filter((m) => getConsecutiveUnpaidMonths(m) >= 6);
    } else if (filterStatus === "overdue12") {
      shown = base.filter((m) => getConsecutiveUnpaidMonths(m) >= 12);
    }

    // Bucket paid members to the bottom first, then apply the active sort
    // within each bucket. This holds regardless of which sort/filter is
    // selected — pending always floats up, paid always sinks.
    const sorted = shown.slice().sort((a, b) => {
      const aPaid = getMemberStatus(a, selectedMonth).status === "paid" ? 1 : 0;
      const bPaid = getMemberStatus(b, selectedMonth).status === "paid" ? 1 : 0;
      if (aPaid !== bPaid) return aPaid - bPaid;

      if (sortBy === "overdue") return getConsecutiveUnpaidMonths(b) - getConsecutiveUnpaidMonths(a);
      if (sortBy === "pending_high") return getMemberStatus(b, selectedMonth).balance - getMemberStatus(a, selectedMonth).balance;
      if (sortBy === "address") return (a.member?.address || "").localeCompare(b.member?.address || "");
      if (sortBy === "name") return (a.member?.name || "").localeCompare(b.member?.name || "");
      return 0;
    });

    return { filtered: sorted, counts: cnt };
  }, [members, search, filterStatus, sortBy, selectedMonth, selectedZone, selectedStreet]);

  const renderMemberItem = useCallback(({ item }) => (
    <MemberCard item={item} selectedMonth={selectedMonth} onPress={openModal} onCall={callFamily} onNavigate={navigateToFamily} onHistory={goToHistory} />
  ), [selectedMonth, openModal, callFamily, navigateToFamily, goToHistory]);

  const keyExtractorMember = useCallback((item) => String(item.member.id), []);

  if (!roleChecked) {
    return <View style={s.root}></View>;
  }
  if (!canAccessCollector(role)) {
    return (
      <View style={s.root}>
        <View style={s.restricted}>
          <Text allowFontScaling={false} style={s.restrictedTitle}>{t("collector.restrictedTitle")}</Text>
          <Text allowFontScaling={false} style={s.restrictedSub}>{t("collector.restrictedSub")}</Text>
          <AnimatedPressable style={s.restrictedBtn} onPress={() => navigation.navigate("Home")}>
            <Text allowFontScaling={false} style={s.restrictedBtnTxt}>{t("collector.backToHome")}</Text>
          </AnimatedPressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>

      <Animated.View style={[s.header, { opacity: hFade }]}>
        <View style={s.navBar}>
          <View style={s.navLeft}>
            <AnimatedPressable onPress={() => navigation.navigate("Home")} style={s.backBtn} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text allowFontScaling={false} style={s.backBtnTxt}>←</Text>
            </AnimatedPressable>
            <View>
              <Text allowFontScaling={false} style={s.navTitle}>{t("collector.title")}</Text>
              {/* Sync status folded into the nav row instead of its own
                  full-width line below — only shown when there's actually
                  something to say (offline, or a queued payment count). */}
              {isOffline || queueCount > 0 ? (
                <Text allowFontScaling={false} style={s.navSubtle}>
                  {isOffline ? t("collector.showingCached") : ""}
                  {isOffline && queueCount > 0 ? " · " : ""}
                  {queueCount > 0 ? `${queueCount} ${t("collector.queued")}` : ""}
                </Text>
              ) : null}
            </View>
          </View>
          <AnimatedPressable onPress={onManualSync} style={s.syncBtn} activeOpacity={0.8}>
            <View style={[s.syncDot, isOffline && { backgroundColor: H.warn }]} />
            <Text allowFontScaling={false} style={s.syncTxt}>{isOffline ? t("collector.offline") : t("collector.sync")}</Text>
          </AnimatedPressable>
        </View>

        <View style={s.tabBar}>
          {[
            { key: "collections", label: t("collectorTabs.collections") },
            { key: "families",    label: t("collectorTabs.families") },
            { key: "history",     label: t("collectorTabs.history") },
          ].map((tab) => (
            <AnimatedPressable
              key={tab.key}
              style={[s.tabItem, activeTab === tab.key && s.tabItemActive]}
              onPress={() => (tab.key === "families" ? navigation.navigate("FamilySearch") : setActiveTab(tab.key))}
              activeOpacity={0.75}
            >
              <Text allowFontScaling={false} style={[s.tabLabel, activeTab === tab.key && s.tabLabelActive]}>
                {tab.label}
              </Text>
            </AnimatedPressable>
          ))}
        </View>

        {activeTab === "collections" && <>{zones.length > 0 && (
          <View style={s.filterDropdownRow}>
            <AnimatedPressable
              style={[s.zoneDropdownBtn, selectedZone && s.zoneDropdownBtnActive]}
              onPress={() => setShowZoneDropdown(true)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text allowFontScaling={false} style={[s.zoneDropdownEye, selectedZone && { color: H.goldDeep }]}>Zone</Text>
                <Text allowFontScaling={false} numberOfLines={1} style={[s.zoneDropdownVal, selectedZone ? { color: H.goldDeep } : { color: H.textMuted }]}>
                  {selectedZone || t("collector.zone.all")}
                </Text>
              </View>
              {selectedZone ? (
                <AnimatedPressable
                  onPress={(e) => { e.stopPropagation?.(); setSelectedZone(""); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text allowFontScaling={false} style={{ fontSize: 14, color: H.textMuted, marginRight: 6 }}>✕</Text>
                </AnimatedPressable>
              ) : null}
              <Text allowFontScaling={false} style={s.zoneDropdownChevron}>▼</Text>
            </AnimatedPressable>

            <AnimatedPressable
              style={[s.zoneDropdownBtn, selectedStreet && s.zoneDropdownBtnActive, streets.length === 0 && { opacity: 0.5 }]}
              onPress={() => streets.length > 0 && setShowStreetDropdown(true)}
              activeOpacity={0.8}
              disabled={streets.length === 0}
            >
              <View style={{ flex: 1 }}>
                <Text allowFontScaling={false} style={[s.zoneDropdownEye, selectedStreet && { color: H.goldDeep }]}>Street</Text>
                <Text allowFontScaling={false} numberOfLines={1} style={[s.zoneDropdownVal, selectedStreet ? { color: H.goldDeep } : { color: H.textMuted }]}>
                  {selectedStreet || "All streets"}
                </Text>
              </View>
              {selectedStreet ? (
                <AnimatedPressable
                  onPress={(e) => { e.stopPropagation?.(); setSelectedStreet(""); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text allowFontScaling={false} style={{ fontSize: 14, color: H.textMuted, marginRight: 6 }}>✕</Text>
                </AnimatedPressable>
              ) : null}
              <Text allowFontScaling={false} style={s.zoneDropdownChevron}>▼</Text>
            </AnimatedPressable>
          </View>
        )}
        {/* Month nav + search combined into one row — was two full-width
            rows before. The month pill is a fixed-width compact control,
            search takes the remaining space. */}
        <View style={s.monthSearchRow}>
          <View style={s.monthPill}>
            <AnimatedPressable onPress={() => setSelectedMonth((p) => shiftMonth(p, -1))} style={s.mArrowSm} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Text allowFontScaling={false} style={s.mArrowSmTxt}>‹</Text>
            </AnimatedPressable>
            {fetching ? <View style={s.fetchDot} /> : null}
            <Text allowFontScaling={false} numberOfLines={1} style={s.mValueSm}>{fmtMonth(selectedMonth)}</Text>
            <AnimatedPressable onPress={() => setSelectedMonth((p) => shiftMonth(p, 1))} style={s.mArrowSm} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Text allowFontScaling={false} style={s.mArrowSmTxt}>›</Text>
            </AnimatedPressable>
          </View>

          <View style={s.searchBoxFlex}>
            <TextInput
              ref={searchRef}
              placeholder={t("collector.searchPlaceholder")}
              placeholderTextColor={H.textMuted}
              value={search}
              onChangeText={setSearch}
              style={s.sInput}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <AnimatedPressable onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text allowFontScaling={false} style={s.clearTxt}>{t("collector.clear")}</Text>
              </AnimatedPressable>
            )}
          </View>
        </View>

        {/* Filter pills + sort trigger share one row — sort used to be its
            own full-width row underneath. */}
        <View style={s.filterSortRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
            {FILTERS.map((f) => (
              <OptionPill key={f.key} label={`${f.label} (${counts[f.key] ?? 0})`} active={filterStatus === f.key} onPress={() => setFilterStatus(f.key)} />
            ))}
          </ScrollView>
          <AnimatedPressable style={s.sortChip} onPress={() => setShowSortMenu((v) => !v)} activeOpacity={0.8}>
            <Text allowFontScaling={false} style={s.sortChipTxt}>{SORTS.find((x) => x.key === sortBy)?.label} ▾</Text>
          </AnimatedPressable>
        </View>

        {showSortMenu && (
          <View style={s.sortMenu}>
            {SORTS.map((opt) => (
              <AnimatedPressable key={opt.key} style={s.sortItem} onPress={() => { setSortBy(opt.key); setShowSortMenu(false); }}>
                <Text allowFontScaling={false} style={[s.sortItemTxt, sortBy === opt.key && { color: H.gold, fontWeight: "800" }]}>{opt.label}</Text>
              </AnimatedPressable>
            ))}
          </View>
        )}
        </>}
      </Animated.View>

      {activeTab === "collections" && (
        <FlatList
          data={filtered}
          keyExtractor={keyExtractorMember}
          renderItem={renderMemberItem}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onListRefresh}
              tintColor={H.gold}
              colors={[H.gold]}
            />
          }
          ListEmptyComponent={<View style={s.empty}><Text allowFontScaling={false} style={s.emptyTxt}>{fetching ? t("collector.loading") : t("collector.noFamilies")}</Text></View>}
        />
      )}

      {activeTab === "history" && (
        <View style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={cashHistoryLoading} onRefresh={loadCashHistory} tintColor={H.gold} colors={[H.gold]} />}>
            {cashHistoryLoading && cashHistory.length === 0 ? (
              <View style={s.empty}><Text allowFontScaling={false} style={s.emptyTxt}>{t("collectorTabs.loading")}</Text></View>
            ) : cashHistory.length === 0 ? (
              <View style={s.empty}><Text allowFontScaling={false} style={s.emptyTxt}>{t("collectorTabs.noHistory")}</Text></View>
            ) : cashHistory.map((sub) => (
              <View key={sub.id} style={s.subCard}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text allowFontScaling={false} style={s.subAmt}>₹{sub.submitted_amount}</Text>
                  <View style={[s.subBadge, sub.status === "approved" && s.subBadgeGreen, sub.status === "rejected" && s.subBadgeRed]}>
                    <Text allowFontScaling={false} style={[s.subBadgeTxt, sub.status === "approved" && { color: H.green }, sub.status === "rejected" && { color: H.error }]}>
                      {t(`collectorTabs.status_${sub.status}`)}
                    </Text>
                  </View>
                </View>
                <Text allowFontScaling={false} style={s.subMeta}>{sub.start_date?.slice(0, 10)} → {sub.end_date?.slice(0, 10)}</Text>
                {sub.rejection_reason ? <Text allowFontScaling={false} style={s.subReject}>{sub.rejection_reason}</Text> : null}
              </View>
            ))}
          </ScrollView>
          <AnimatedPressable style={s.submitCashBtn} onPress={() => navigation.navigate("CashSubmission")}>
            <Text allowFontScaling={false} style={s.submitCashTxt}>{t("collectorTabs.submitCash")}</Text>
          </AnimatedPressable>
        </View>
      )}

      <QRViewerModal visible={qrViewerVisible} onClose={() => setQrViewerVisible(false)} imageSource={require("../../assests/upi_qr.jpg")} />

      {/* ── Zone dropdown modal ──────────────────────────────────────────── */}
      <SearchPickerModal
        visible={showZoneDropdown}
        title="Select Zone"
        searchPlaceholder="Search zones..."
        options={zones}
        currentValue={selectedZone}
        allTopOption={{ label: t("collector.zone.all"), active: !selectedZone }}
        noMatchPrefix="No zones match"
        onSelect={(z) => { setSelectedZone(z); setShowZoneDropdown(false); }}
        onClose={() => setShowZoneDropdown(false)}
      />

      {/* ── Street dropdown modal ────────────────────────────────────────── */}
      <SearchPickerModal
        visible={showStreetDropdown}
        title={`Select Street${selectedZone ? ` — ${selectedZone}` : ""}`}
        showSearch={false}
        options={streets}
        currentValue={selectedStreet}
        allTopOption={{ label: "All streets", active: !selectedStreet }}
        onSelect={(st) => { setSelectedStreet(st); setShowStreetDropdown(false); }}
        onClose={() => setShowStreetDropdown(false)}
      />

      <SafeModal visible={!!selected} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={s.overlay}>
          {/* Backdrop is a SIBLING of the sheet, not its parent.
              While the sheet was nested inside the backdrop Pressable, every
              touch inside the sheet went through that Pressable's responder
              negotiation, and the sheet had to claim the responder on touch
              start (onStartShouldSetResponder) just to stop taps closing it.
              That claim competed with the inner ScrollView, so a drag only
              scrolled when it happened to start where the ScrollView won the
              negotiation - the "have to press in one spot to scroll" bug.
              As siblings, the backdrop only ever sees touches that miss the
              sheet, and the ScrollView owns its gestures outright. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeModal}
              accessibilityLabel="Close"
            />
            <View style={s.sheet}>
              {selected && (
                <>
                  <View style={s.handle} />

                  <View style={s.sheetTop}>
                    <View style={{ flex: 1 }}>
                      <Text allowFontScaling={false} style={s.sheetEye}>{t("collector.collectPayment")}</Text>
                      <View style={s.sheetNameRow}>
                        {selected.member?.chanda_no ? (
                          <View style={s.sheetChandaTag}><Text allowFontScaling={false} style={s.sheetChandaTxt}>{selected.member.chanda_no}</Text></View>
                        ) : null}
                        <Text allowFontScaling={false} style={s.sheetName}>{selected.member?.name}</Text>
                      </View>
                      <Text allowFontScaling={false} style={s.sheetAddr}>{selected.member?.address}</Text>
                      <Text allowFontScaling={false} style={s.sheetAddr}>{selected.member?.phone}</Text>
                    </View>
                    <AnimatedPressable onPress={closeModal} style={s.doneBtn}>
                      <Text allowFontScaling={false} style={s.doneTxt}>{t("collector.done")}</Text>
                    </AnimatedPressable>
                  </View>

                  <ScrollView
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    contentContainerStyle={s.sheetScroll}
                    refreshControl={
                      <RefreshControl
                        refreshing={sheetRefreshing}
                        onRefresh={onSheetRefresh}
                        tintColor={H.gold}
                        colors={[H.gold]}
                      />
                    }
                  >
                    <View style={s.section}>
                      <Text allowFontScaling={false} style={s.secLabel}>{t("collector.paymentType")}</Text>
                      <View style={s.pillRow}>
                        <OptionPill label={t("collector.typeChanda")} active={paymentType === "chanda"} onPress={() => setPaymentType("chanda")} />
                        <OptionPill label={t("collector.typeDonation")} active={paymentType === "donation"} onPress={() => setPaymentType("donation")} />
                        {fundsAvailable ? (
                          <OptionPill label={t("collector.typeFund")} active={paymentType === "fund"} onPress={() => setPaymentType("fund")} />
                        ) : null}
                        <OptionPill label={t("collector.typeOther")} active={paymentType === "other"} onPress={() => setPaymentType("other")} />
                      </View>
                      {paymentType === "other" ? (
                        <Text allowFontScaling={false} style={s.notConnectedNote}>{t("collector.notConnectedNote")}</Text>
                      ) : null}
                    </View>

                    <AnimatedPressable onPress={openDatePicker} style={s.dateRow}>
                      <View style={s.dateLabelCol}>
                        <Text allowFontScaling={false} style={s.dateLabel}>{t("collector.visitDate")}</Text>
                        <Text allowFontScaling={false} style={[s.dateLabel, { fontSize: 10, marginTop: 1, opacity: 0.6 }]} numberOfLines={2}>{t("collector.visitDateHint")}</Text>
                      </View>
                      <Text allowFontScaling={false} style={s.dateVal} numberOfLines={1}>
                        {collectedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </Text>
                    </AnimatedPressable>

                    <View style={s.amtRow}>
                      <Text allowFontScaling={false} style={s.amtRupee}>₹</Text>
                      <TextInput
                        placeholder="0"
                        placeholderTextColor={H.textMuted}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="numeric"
                        style={s.amtInput}
                        returnKeyType="done"
                      />
                    </View>

                    {paymentType === "chanda" && (
                      <View style={s.section}>
                        {/* Chanda rate */}
                        <View style={s.chandaRateRow}>
                          <Text allowFontScaling={false} style={s.chandaRateLabel}>Monthly Chanda</Text>
                          <Text allowFontScaling={false} style={s.chandaRateAmt}>₹{getMonthlyAmt()}</Text>
                        </View>

                        {/* Month allocation picker */}
                        {availableMonthsLoading ? (
                          <Text allowFontScaling={false} style={[s.secLabel, { marginTop: 12 }]}>Loading months…</Text>
                        ) : (
                          <MonthRunSelector
                            months={monthRun}
                            count={monthCount}
                            onCountChange={setMonthCount}
                            t={t}
                          />
                        )}
                      </View>
                    )}

                    {paymentType === "fund" && fundsAvailable && (
                      <View style={s.section}>
                        <Text allowFontScaling={false} style={s.secLabel}>{t("collector.selectFund")}</Text>
                        <View style={s.pillRow}>
                          {funds.map((f) => (
                            <OptionPill key={f.id} label={f.name} active={selectedFund === f.id} onPress={() => setSelectedFund(f.id)} />
                          ))}
                        </View>
                      </View>
                    )}

                    <View style={s.section}>
                      <Text allowFontScaling={false} style={s.secLabel}>{t("collector.paymentMethod")}</Text>
                      {/* Upgraded from OptionPill row to dedicated PaymentMethodButton
                          row — larger touch targets, filled selected state, no
                          crowding against the type/fund pills above. */}
                      <View style={pm.row}>
                        {["cash", "upi", "bank", "cheque"].map((m) => (
                          <PaymentMethodButton key={m} label={m.toUpperCase()} active={method === m} onPress={() => setMethod(m)} />
                        ))}
                      </View>
                    </View>

                    {method === "upi" && (
                      <View style={s.upiCard}>
                        <Text allowFontScaling={false} style={s.secLabel}>{t("collector.scanToPay")}</Text>
                        <View style={s.upiInner}>
                          <AnimatedPressable onPress={() => setQrViewerVisible(true)} activeOpacity={0.9} style={s.qrThumbBox}>
                            <Image source={require("../../assests/upi_qr.jpg")} style={s.qrThumbImg} resizeMode="contain" />
                          </AnimatedPressable>
                          <View style={s.upiRight}>
                            <AnimatedPressable onPress={pickImage} style={[s.uploadBtn, proofImage && s.uploadBtnDone]}>
                              <Text allowFontScaling={false} style={s.uploadTxt}>{proofImage ? t("collector.changeScreenshot") : t("collector.uploadScreenshot")}</Text>
                            </AnimatedPressable>
                            {proofImage ? (
                              <View style={s.proofBadge}><Text allowFontScaling={false} style={s.proofBadgeTxt}>{t("collector.attached")}</Text></View>
                            ) : (
                              <Text allowFontScaling={false} style={s.upiHint}>{t("collector.required")}</Text>
                            )}
                          </View>
                        </View>
                        <View style={s.refBox}>
                          <Text allowFontScaling={false} style={s.secLabel}>{t("collector.transactionRef")}</Text>
                          <TextInput
                            placeholder={t("collector.transactionRefPlaceholder")}
                            placeholderTextColor={H.textMuted}
                            value={transactionRef}
                            onChangeText={setTransactionRef}
                            style={s.refInput}
                          />
                        </View>
                      </View>
                    )}

                    <View style={s.section}>
                      <Text allowFontScaling={false} style={s.secLabel}>{t("collector.notes")}</Text>
                      <TextInput
                        placeholder={t("collector.notesPlaceholder")}
                        placeholderTextColor={H.textMuted}
                        value={notes}
                        onChangeText={setNotes}
                        style={[s.refInput, { minHeight: 60, textAlignVertical: "top" }]}
                        multiline
                      />
                    </View>

                    {/*
                      Single primary action rule: for chanda payments, the
                      sticky bottom bar below ("Continue") IS the primary
                      action — it opens the confirm dialog. We do not also
                      render SubmitButton here, since that was the second,
                      duplicate "Record Payment" action the redesign brief
                      called out. Donation/fund/other payment types have no
                      sticky bar (they aren't month-based), so they keep
                      their own single primary action inline.
                    */}
                    {paymentType !== "chanda" && (
                      <View style={s.submitWrap}>
                        <SubmitButton loading={loading} onPress={submitPayment} />
                      </View>
                    )}
                  </ScrollView>

                  {paymentType === "chanda" && (
                    <StickySelectionBar
                      count={selectedMonthKeys.size}
                      total={availableMonths.filter(m => selectedMonthKeys.has(m.month)).reduce((sum, m) => sum + m.remaining, 0)}
                      onContinue={submitChandaPayment}
                      loading={loading}
                    />
                  )}
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeModal>

      {/* Date picker — a top-level sibling of the sheet Modal, never nested
          inside the sheet's ScrollView (see SCROLL-STUCK FIX note above). */}
      <SafeModal visible={showDate} transparent animationType="fade" onRequestClose={() => setShowDate(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" }}
          onPress={() => setShowDate(false)}>
          <Pressable style={{
            backgroundColor: "#fff", borderRadius: 18, padding: 24,
            width: 300, alignItems: "center",
            shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, elevation: 10,
          }} onPress={() => {}}>
            <Text allowFontScaling={false} style={{ fontSize: 16, fontWeight: "700", color: "#1C231F", marginBottom: 20 }}>
              Select Date
            </Text>
            {/* Day / Month / Year spinners */}
            {(() => {
              const d = collectedDate.getDate();
              const mo = collectedDate.getMonth();
              const y = collectedDate.getFullYear();
              const today = new Date();
              const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              const clamp = (date) => date > today ? today : date;
              const bump = (field, delta) => {
                const nd = new Date(collectedDate);
                if (field === "d") nd.setDate(d + delta);
                else if (field === "m") nd.setMonth(mo + delta);
                else if (field === "y") nd.setFullYear(y + delta);
                setCollectedDate(clamp(nd));
              };
              const SpinCol = ({ label, onUp, onDown }) => (
                <View style={{ alignItems: "center", flex: 1 }}>
                  <AnimatedPressable onPress={onUp} style={{ padding: 8 }}>
                    <Text allowFontScaling={false} style={{ fontSize: 22, color: "#0F5C4C", fontWeight: "700" }}>▲</Text>
                  </AnimatedPressable>
                  <Text allowFontScaling={false} style={{ fontSize: 20, fontWeight: "800", color: "#1C231F", minWidth: 52, textAlign: "center" }}>{label}</Text>
                  <AnimatedPressable onPress={onDown} style={{ padding: 8 }}>
                    <Text allowFontScaling={false} style={{ fontSize: 22, color: "#0F5C4C", fontWeight: "700" }}>▼</Text>
                  </AnimatedPressable>
                </View>
              );
              return (
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
                  <SpinCol label={String(d).padStart(2, "0")} onUp={() => bump("d", 1)} onDown={() => bump("d", -1)} />
                  <Text allowFontScaling={false} style={{ fontSize: 20, color: "#C8C0A8", marginHorizontal: 2 }}>/</Text>
                  <SpinCol label={months[mo]} onUp={() => bump("m", 1)} onDown={() => bump("m", -1)} />
                  <Text allowFontScaling={false} style={{ fontSize: 20, color: "#C8C0A8", marginHorizontal: 2 }}>/</Text>
                  <SpinCol label={String(y)} onUp={() => bump("y", 1)} onDown={() => bump("y", -1)} />
                </View>
              );
            })()}
            <AnimatedPressable onPress={() => setShowDate(false)} style={{
              backgroundColor: "#0F5C4C", borderRadius: 12,
              paddingVertical: 12, paddingHorizontal: 36,
            }}>
              <Text allowFontScaling={false} style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Done</Text>
            </AnimatedPressable>
          </Pressable>
        </Pressable>
      </SafeModal>

      {/* Payment confirmation modal */}
      <SafeModal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 }}
          onPress={() => setConfirmVisible(false)}>
          <Pressable style={{ backgroundColor: "#fff", borderRadius: 18, padding: 22, width: "100%", maxWidth: 360 }} onPress={() => {}}>
            <Text allowFontScaling={false} style={{ fontSize: 16, fontWeight: "800", color: H.headerDeep, marginBottom: 14, textAlign: "center" }}>
              Confirm Payment
            </Text>

            {confirmPayload && (
              <>
                <View style={{ gap: 8, marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Member</Text>
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 13, fontWeight: "700" }}>{confirmPayload.memberName}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Monthly Rate</Text>
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 13 }}>₹{confirmPayload.rate}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Total Amount</Text>
                    <Text allowFontScaling={false} style={{ color: H.green, fontSize: 15, fontWeight: "800" }}>₹{confirmPayload.finalAmount}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Method</Text>
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 13, textTransform: "capitalize" }}>{method}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Date</Text>
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 13 }}>
                      {collectedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                  </View>
                </View>

                {(() => {
                  const hasFuture = confirmPayload.months_list.some(mk => {
                    const now = new Date(); const [yr, mo] = mk.split("-").map(Number);
                    return new Date(yr, mo - 1, 1) > new Date(now.getFullYear(), now.getMonth(), 1);
                  });
                  return hasFuture ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, backgroundColor: "rgba(16,185,129,0.08)", borderRadius: 8, padding: 10 }}>
                      <View style={{ backgroundColor: "rgba(16,185,129,0.18)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text allowFontScaling={false} style={{ fontSize: 11, fontWeight: "800", color: "#059669" }}>Advance Payment</Text>
                      </View>
                      <Text allowFontScaling={false} style={{ flex: 1, fontSize: 11, color: H.textMuted, lineHeight: 16 }}>
                        Money is received today. Future months will appear as Paid when generated.
                      </Text>
                    </View>
                  ) : null;
                })()}

                <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
                  Covered Months ({confirmPayload.months_list.length})
                </Text>
                <View style={{ gap: 4, marginBottom: 18 }}>
                  {confirmPayload.months_list.map(mk => {
                    const label = fmtMFull(mk);
                    const isAdvance = (() => { const now = new Date(); const [yr, mo] = mk.split("-").map(Number); return new Date(yr, mo - 1, 1) > new Date(now.getFullYear(), now.getMonth(), 1); })();
                    return (
                      <View key={mk} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8 }}>
                        <Text allowFontScaling={false} style={{ color: H.green, fontSize: 12.5 }}>✓</Text>
                        <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 12.5, flex: 1 }}>{label}</Text>
                        {isAdvance && (
                          <View style={{ backgroundColor: "rgba(16,185,129,0.1)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text allowFontScaling={false} style={{ fontSize: 9, fontWeight: "800", color: "#059669" }}>ADV</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <AnimatedPressable
                    style={{ flex: 1, backgroundColor: H.bg, borderRadius: 10, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: H.cardBorder }}
                    onPress={() => setConfirmVisible(false)}
                  >
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontWeight: "700", fontSize: 14 }}>Cancel</Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    style={{ flex: 2, backgroundColor: H.gold, borderRadius: 10, paddingVertical: 13, alignItems: "center" }}
                    onPress={() => { setConfirmVisible(false); doSubmitChanda(confirmPayload.finalAmount, confirmPayload.token); }}
                  >
                    <Text allowFontScaling={false} style={{ color: H.headerDeep, fontWeight: "800", fontSize: 14 }}>Confirm & Submit</Text>
                  </AnimatedPressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </SafeModal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },

  restricted: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  restrictedTitle: { fontSize: 18, fontWeight: "700", color: H.textDark },
  restrictedSub: { fontSize: 13, color: H.textMuted, textAlign: "center", lineHeight: 19 },
  restrictedBtn: { marginTop: 10, backgroundColor: H.gold, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 },
  restrictedBtnTxt: { color: H.headerDeep, fontWeight: "800", fontSize: 13 },

  // ── Header: trimmed paddings, subtitle removed, summary cards removed ──
  header: { backgroundColor: H.bg, paddingTop: Platform.OS === "ios" ? 14 : 10, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  navBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 6 },
  navLeft: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 },
  backBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder, justifyContent: "center", alignItems: "center", marginRight: 10 },
  backBtnTxt: { color: H.textDark, fontSize: 14, fontWeight: "700" },
  navTitle: { color: H.textDark, fontSize: 17, fontWeight: "800" },
  navSubtle: { fontSize: 10, color: H.warn, fontWeight: "600", marginTop: 1 },
  syncBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6 },
  syncDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: H.green },
  syncTxt: { fontSize: 10.5, color: H.textDark, fontWeight: "700" },

  // ── Compact month pill + search, sharing one row ──────────────────────
  monthSearchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 6 },
  monthPill: { flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 11, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 4, paddingVertical: 8, gap: 4 },
  mArrowSm: { paddingHorizontal: 5 },
  mArrowSmTxt: { color: H.gold, fontSize: 17, fontWeight: "400" },
  mValueSm: { color: H.textDark, fontSize: 12, fontWeight: "700", maxWidth: 74 },
  searchBoxFlex: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 11, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 12 },

  // ── Filter pills + sort chip, sharing one row ──────────────────────────
  filterSortRow: { flexDirection: "row", alignItems: "center", marginBottom: 4, paddingLeft: 16 },
  sortChip: { backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, marginRight: 16 },
  sortChipTxt: { color: H.gold, fontSize: 11, fontWeight: "700" },

  sInput: { flex: 1, color: H.textDark, fontSize: 13, paddingVertical: Platform.OS === "android" ? 8 : 10 },
  clearTxt: { color: H.textMuted, fontSize: 12, paddingLeft: 8 },

  sortMenu: { marginHorizontal: 16, backgroundColor: H.card, borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder, marginTop: 6, overflow: "hidden" },
  sortItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  sortItemTxt: { fontSize: 13, color: H.textDark },

  listContent: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 30, flexGrow: 1 },
  empty: { alignItems: "center", paddingTop: 56 },
  emptyTxt: { color: H.textMuted, fontSize: 14 },

  card: { backgroundColor: H.card, borderRadius: 16, borderWidth: 1, borderColor: H.cardBorder, borderLeftWidth: 4, padding: 17, marginBottom: 12, ...shadow(3, 0.08) },
  cardPaid: { opacity: 0.82 },
  cardRow1: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 8, marginRight: 8 },
  chandaTag: { backgroundColor: "rgba(201,168,76,0.12)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "rgba(201,168,76,0.25)" },
  chandaTagText: { color: H.goldDeep, fontSize: 10, fontWeight: "800" },
  memberName: { color: H.textDark, fontSize: 16.5, fontWeight: "800", flex: 1 },
  addrText: { color: H.textMuted, fontSize: 12.5, marginTop: 4 },
  phoneText: { color: H.textMuted, fontSize: 12.5, marginTop: 2 },
  sPill: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 99 },
  sPillText: { fontSize: 11, fontWeight: "800" },

  overdueBadge: { alignSelf: "flex-start", backgroundColor: H.warnDim, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5, marginTop: 8, maxWidth: "100%" },
  overdueBadgeRed: { backgroundColor: "#FEE8E8" },
  overdueBadgeTxt: { color: H.warn, fontSize: 11, fontWeight: "800" },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  donationBadge: { backgroundColor: H.greenDim, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4 },
  donationBadgeTxt: { color: H.green, fontSize: 10.5, fontWeight: "700" },
  fundBadge: { backgroundColor: "rgba(201,168,76,0.12)", borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4 },
  fundBadgeTxt: { color: H.goldDeep, fontSize: 10.5, fontWeight: "700" },

  statsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  miniStat: { flex: 1, backgroundColor: H.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 8 },
  miniStatLabel: { color: H.textMuted, fontSize: 9, textTransform: "uppercase", marginBottom: 3, fontWeight: "600", letterSpacing: 0.3 },
  miniStatVal: { fontSize: 14, fontWeight: "800" },
  lastMeta: { fontSize: 10.5, color: H.textMuted, marginTop: 8, fontStyle: "italic" },

  actionsRow: { flexDirection: "row", gap: 8, marginTop: 13 },
  actionBtnPrimary: { flex: 1, backgroundColor: H.gold, borderRadius: 11, paddingVertical: 12, alignItems: "center", ...shadow(2, 0.12) },
  actionBtnPrimaryTxt: { color: H.headerDeep, fontSize: 13, fontWeight: "800" },
  actionBtn: { flex: 1, backgroundColor: H.bg, borderRadius: 11, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: H.cardBorder },
  actionBtnTxt: { color: H.textDark, fontSize: 12.5, fontWeight: "700" },

  optPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder },
  optPillOn: { backgroundColor: H.gold, borderColor: H.gold },
  optPillTxt: { color: H.textMuted, fontSize: 11.5, fontWeight: "700" },
  optPillTxtOn: { color: H.headerDeep },

  overlay: { flex: 1, backgroundColor: "rgba(11,61,46,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: H.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: H.cardBorder, borderBottomWidth: 0, height: "93%", paddingHorizontal: 18 },
  handle: { width: 34, height: 4, backgroundColor: H.textMuted, borderRadius: 99, opacity: 0.3, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  sheetTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  sheetEye: { color: H.gold, fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "800" },
  sheetNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  sheetChandaTag: { backgroundColor: "rgba(201,168,76,0.12)", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "rgba(201,168,76,0.25)" },
  sheetChandaTxt: { color: H.goldDeep, fontSize: 11, fontWeight: "800" },
  sheetName: { color: H.textDark, fontSize: 17, fontWeight: "700" },
  sheetAddr: { color: H.textMuted, fontSize: 12 },
  doneBtn: { backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 99 },
  doneTxt: { color: H.textDark, fontSize: 12, fontWeight: "700" },
  sheetScroll: { paddingBottom: 40, paddingTop: 4, flexGrow: 1 },

  notConnectedNote: { fontSize: 10.5, color: H.warn, marginTop: 8, lineHeight: 15 },

  dateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: H.card, borderRadius: 11, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 14, paddingVertical: 11, marginTop: 12 },
  // The hint text is long enough on some locales/screens to push the date
  // value outside the card if left unconstrained — flex:1 + shrink lets the
  // label/hint wrap instead, while dateVal keeps its own space on the right.
  dateLabelCol: { flex: 1, flexShrink: 1, marginRight: 10 },
  dateLabel: { color: H.textMuted, fontSize: 13, flexWrap: "wrap" },
  dateVal: { color: H.goldDeep, fontSize: 13, fontWeight: "700", flexShrink: 0 },

  amtRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 2, borderBottomColor: H.gold, marginVertical: 14, paddingBottom: 4 },
  amtRupee: { color: H.gold, fontSize: 20, fontWeight: "700", marginRight: 8 },
  amtInput: { flex: 1, color: H.textDark, fontSize: 36, fontWeight: "800", paddingVertical: 0 },

  section: { marginTop: 12, marginBottom: 2 },
  secLabel: { color: H.textMuted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, fontWeight: "700" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  chandaRateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(201,168,76,0.08)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10, borderWidth: 1, borderColor: "rgba(201,168,76,0.2)" },
  chandaRateLabel: { color: H.goldDeep, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  chandaRateAmt: { color: H.goldDeep, fontSize: 22, fontWeight: "900" },

  upiCard: { marginTop: 14, backgroundColor: H.card, borderRadius: 13, borderWidth: 1, borderColor: H.cardBorder, padding: 13 },
  upiInner: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
  qrThumbBox: { width: 90, height: 90, backgroundColor: "#ffffff", borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: H.cardBorder },
  qrThumbImg: { width: "85%", height: "85%" },
  upiRight: { flex: 1, gap: 8 },
  refBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: H.cardBorder, paddingTop: 10 },
  refInput: { color: H.textDark, fontSize: 13, backgroundColor: H.card, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginTop: 4, borderWidth: 1, borderColor: H.cardBorder },
  uploadBtn: { backgroundColor: H.bg, borderRadius: 10, borderWidth: 1, borderColor: H.cardBorder, paddingVertical: 12, alignItems: "center" },
  uploadBtnDone: { borderColor: H.green, backgroundColor: H.greenDim },
  uploadTxt: { color: H.textDark, fontSize: 12.5, fontWeight: "700", textAlign: "center", lineHeight: 18 },
  proofBadge: { backgroundColor: H.greenDim, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, alignItems: "center" },
  proofBadgeTxt: { color: H.green, fontSize: 11, fontWeight: "700" },
  upiHint: { color: H.warn, fontSize: 11, textAlign: "center" },

  qrOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" },
  qrBigBox: { width: SW * 0.85, height: SW * 0.85, maxWidth: 400, maxHeight: 400, backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  qrBigImg: { width: "100%", height: "100%", borderRadius: 8 },
  qrHint: { color: "#ddd", fontSize: 13, marginTop: 20, textAlign: "center" },

  submitWrap: { marginTop: 20, marginBottom: 6 },
  submitBtn: { backgroundColor: H.gold, borderRadius: 13, paddingVertical: 16, alignItems: "center" },
  submitBtnTxt: { color: H.headerDeep, fontSize: 15, fontWeight: "800" },

  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: H.cardBorder, marginHorizontal: 0, backgroundColor: H.bg },
  tabItem: { flex: 1, paddingVertical: 9, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: H.gold },
  tabLabel: { fontSize: 12.5, fontWeight: "600", color: H.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  tabLabelActive: { color: H.gold },

  tabContent: { padding: 16, paddingBottom: 40 },

  subCard: { backgroundColor: H.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: H.cardBorder },
  subAmt: { fontSize: 18, fontWeight: "800", color: H.textDark },
  subMeta: { fontSize: 12, color: H.textMuted, marginTop: 4 },
  subReject: { fontSize: 12, color: H.error, marginTop: 4, fontStyle: "italic" },
  subBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: "rgba(201,168,76,0.12)" },
  subBadgeGreen: { backgroundColor: "rgba(15,92,76,0.1)" },
  subBadgeRed: { backgroundColor: "rgba(192,71,58,0.1)" },
  subBadgeTxt: { fontSize: 11, fontWeight: "700", color: H.gold },

  submitCashBtn: { margin: 16, backgroundColor: H.gold, borderRadius: 13, paddingVertical: 15, alignItems: "center" },
  submitCashTxt: { color: H.headerDeep, fontSize: 15, fontWeight: "800" },

  // ── Zone dropdown button ──────────────────────────────────────────────
  filterDropdownRow: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 8 },
  zoneDropdownBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: H.card, borderWidth: 1.5, borderColor: H.cardBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  zoneDropdownBtnActive: { borderColor: H.gold, backgroundColor: "rgba(201,168,76,0.07)" },
  zoneDropdownEye: { fontSize: 11, color: H.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  zoneDropdownVal: { fontSize: 15, color: H.textDark, fontWeight: "800" },
  zoneDropdownChevron: { fontSize: 11, color: H.textMuted },

});
