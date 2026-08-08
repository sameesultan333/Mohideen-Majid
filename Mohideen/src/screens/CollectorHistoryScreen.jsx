/**
 * CollectorHistoryScreen — Mohideen Masjid (Premium Compact)
 *
 * Clean, premium design with search outside header.
 * Compact cards with elegant typography.
 */

import React, {
  useEffect, useRef, useState, useCallback, useMemo,
} from "react";
import { View, Text, FlatList, StyleSheet, TextInput, Animated, Platform, StatusBar, Dimensions, RefreshControl } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import { useIsFocused } from "@react-navigation/native";
import { authApiFetch } from "../config/server";
import { COLORS as C, RADII, FONTS } from "../config/theme";
import { useTranslation } from "react-i18next";
import BottomNav from "../components/BottomNav";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { STATUSBAR_HEIGHT as STATUSBAR_H } from "../utils/statusBar";
const HEADER_H = 110;
const BOTTOM_NAV_H = Platform.select({ ios: 89, android: 73 });
const CACHE_KEY = "collector_history_cache";
const FETCH_TIMEOUT = 2000;

// ── Palette ──────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalize = (s) => (s || "").toLowerCase().replace(/[-\s]+/g, "");

const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso.includes("Z") ? iso : iso + "Z");
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso.includes("Z") ? iso : iso + "Z");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const yesterdayStr = () => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const itemDateStr = (item) => {
  const iso = item.collected_at || item.created_at || "";
  if (!iso) return "";
  const d = new Date(iso.includes("Z") ? iso : iso + "Z");
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const groupLabel = (dateStr, t) => {
  const today = todayStr();
  const yesterday = yesterdayStr();
  if (dateStr === today) return t("collectorHistory.today");
  if (dateStr === yesterday) return t("collectorHistory.yesterday");
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.floor((new Date(today) - d) / 86400000);
  if (diff <= 7) return t("collectorHistory.thisWeek");
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  verified: { label: (t) => t("collectorHistory.status.verified"),   color: H.green,  bg: "rgba(14,107,69,0.06)" },
  pending:  { label: (t) => t("collectorHistory.status.pending"),    color: H.amber,  bg: H.amberBg },
  partial:  { label: (t) => t("collectorHistory.status.partial"),    color: "#6B3FA0", bg: "rgba(107,63,160,0.06)" },
  rejected: { label: (t) => t("collectorHistory.status.rejected"),   color: H.error,  bg: H.errorBg },
};

const cfgFor = (item) => {
  if (item.status === "verified") return STATUS_CFG.verified;
  if (item.status === "rejected") return STATUS_CFG.rejected;
  if (item.status === "partial")  return STATUS_CFG.partial;
  return STATUS_CFG.pending;
};

// ── Filter chips ──────────────────────────────────────────────────────────────
const FILTERS = [
  { key: "all",       label: (t) => t("collectorHistory.filters.all") },
  { key: "chanda",    label: (t) => t("collectorHistory.filters.chanda") },
  { key: "donation",  label: (t) => t("collectorHistory.filters.donation") },
  { key: "fund",      label: (t) => t("collectorHistory.filters.fund") },
  { key: "today",     label: (t) => t("collectorHistory.filters.today") },
  { key: "yesterday", label: (t) => t("collectorHistory.filters.yesterday") },
  { key: "thisWeek",  label: (t) => t("collectorHistory.filters.thisWeek") },
  { key: "thisMonth", label: (t) => t("collectorHistory.filters.thisMonth") },
  { key: "lastMonth", label: (t) => t("collectorHistory.filters.lastMonth") },
  { key: "cash",      label: (t) => t("collectorHistory.filters.cash") },
  { key: "upi",       label: (t) => t("collectorHistory.filters.upi") },
  { key: "partial",   label: (t) => t("collectorHistory.filters.partial") },
  { key: "advance",   label: (t) => t("collectorHistory.filters.advance") },
  { key: "verified",  label: (t) => t("collectorHistory.filters.verified") },
];

function passesFilter(item, filterKey) {
  const ds = itemDateStr(item);
  const today = todayStr();
  const yesterday = yesterdayStr();
  switch (filterKey) {
    case "all":       return true;
    case "today":     return ds === today;
    case "yesterday": return ds === yesterday;
    case "thisWeek":  {
      const d = new Date(today); d.setDate(d.getDate() - 6);
      return ds >= d.toISOString().slice(0, 10);
    }
    case "thisMonth": return ds.slice(0, 7) === today.slice(0, 7);
    case "lastMonth": {
      const d = new Date(today); d.setDate(1); d.setMonth(d.getMonth() - 1);
      return ds.slice(0, 7) === d.toISOString().slice(0, 7);
    }
    case "chanda":   return item.entry_type === "chanda";
    case "donation": return item.entry_type === "donation";
    case "fund":     return item.entry_type === "fund";
    case "cash":     return item.method === "cash";
    case "upi":      return item.method !== "cash";
    case "partial":  return item.status === "partial";
    case "advance":  return !!item.is_advance;
    case "verified": return item.status === "verified";
    default: return true;
  }
}

// ─── SVG Icons ───────────────────────────────────────────────────────────────
const SearchIcon = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24">
    <Path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19 Z" stroke="#5A7B65" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M21 21 L17 17" stroke="#5A7B65" strokeWidth={1.8} fill="none" strokeLinecap="round" />
  </Svg>
);

const CloseIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 24 24">
    <Path d="M6 6 L18 18 M6 18 L18 6" stroke="#5A7B65" strokeWidth={2} fill="none" strokeLinecap="round" />
  </Svg>
);

const RupeeIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 24 24">
    <Path d="M6 3H18M6 8H18M10 8L6 17H18L14 8" stroke={H.goldDeep} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const CashIcon = () => (
  <Svg width={12} height={12} viewBox="0 0 24 24">
    <Rect x="2" y="6" width="20" height="12" rx="2" stroke={H.green} strokeWidth={1.8} fill="none" />
    <Path d="M6 12H6.01M12 12H12.01M18 12H18.01" stroke={H.green} strokeWidth={2} fill="none" strokeLinecap="round" />
  </Svg>
);

const UpiIcon = () => (
  <Svg width={12} height={12} viewBox="0 0 24 24">
    <Path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#2563EB" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M2 17L12 22L22 17" stroke="#2563EB" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M2 12L12 17L22 12" stroke="#2563EB" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ReceiptIcon = () => (
  <Svg width={11} height={11} viewBox="0 0 24 24">
    <Path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke={H.textMuted} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M14 2V8h6M16 13H8M16 17H8M10 9H8" stroke={H.textMuted} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ─── Header pattern ────────────────────────────────────────────────────────────
const HeaderPattern = () => {
  const step = 48;
  const cols = Math.ceil(SW / step) + 1;
  const rows = Math.ceil(HEADER_H / step) + 1;
  const stars = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = c * step + (r % 2 === 0 ? 0 : step / 2);
      const cy = r * step;
      stars.push(`M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z`);
    }
  return (
    <Svg width={SW} height={HEADER_H} style={StyleSheet.absoluteFill}>
      {stars.map((d, i) => <Path key={i} d={d} fill={C.gold} opacity={0.04} />)}
    </Svg>
  );
};

// ─── Premium Today's Collection Card ─────────────────────────────────────────
const TodayCard = ({ today, isOffline, lastSync, t }) => {
  const total = today?.total || 0;
  const count = today?.count || 0;
  const cash = today?.cash || 0;
  const upi = today?.upi || 0;
  const partial = today?.partial || 0;
  const advance = today?.advance || 0;

  return (
    <View style={s.todayCard}>
      <View style={s.todayAccentLine} />
      <View style={s.todayHeaderRow}>
        <View>
          <Text allowFontScaling={false} style={s.todayLabel}>
            {t("collectorHistory.todayCollection")}
          </Text>
          <Text allowFontScaling={false} style={s.todayDate}>
            {fmtDate(new Date().toISOString())}
          </Text>
        </View>
        {isOffline && (
          <View style={s.offlinePill}>
            <View style={[s.dot, { backgroundColor: H.amber }]} />
            <Text allowFontScaling={false} style={s.offlinePillTxt}>{t("collectorHistory.cached")}</Text>
          </View>
        )}
      </View>

      <View style={s.todayTotalWrap}>
        <View style={s.rupeeWrap}>
          <RupeeIcon />
        </View>
        <Text allowFontScaling={false} style={s.todayTotal}>
          {total.toLocaleString("en-IN")}
        </Text>
      </View>

      <View style={s.todayDivider} />

      <View style={s.todayStatsRow}>
        <View style={s.todayStatItem}>
          <Text allowFontScaling={false} style={s.todayStatValue}>{count}</Text>
          <Text allowFontScaling={false} style={s.todayStatLabel}>{t("collectorHistory.payments")}</Text>
        </View>
        <View style={s.todayStatDivider} />
        <View style={s.todayStatItem}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <CashIcon />
            <Text allowFontScaling={false} style={s.todayStatValue}>₹{cash.toLocaleString("en-IN")}</Text>
          </View>
          <Text allowFontScaling={false} style={s.todayStatLabel}>{t("collectorHistory.cash")}</Text>
        </View>
        <View style={s.todayStatDivider} />
        <View style={s.todayStatItem}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <UpiIcon />
            <Text allowFontScaling={false} style={s.todayStatValue}>₹{upi.toLocaleString("en-IN")}</Text>
          </View>
          <Text allowFontScaling={false} style={s.todayStatLabel}>{t("collectorHistory.upi")}</Text>
        </View>
      </View>

      {(partial > 0 || advance > 0) && (
        <View style={s.todayTags}>
          {partial > 0 && (
            <View style={[s.tagPill, { backgroundColor: H.amberBg }]}>
              <Text allowFontScaling={false} style={[s.tagPillTxt, { color: H.amber }]}>
                {partial} {t("collectorHistory.filters.partial")}
              </Text>
            </View>
          )}
          {advance > 0 && (
            <View style={[s.tagPill, { backgroundColor: H.subtleGreen }]}>
              <Text allowFontScaling={false} style={[s.tagPillTxt, { color: H.green }]}>
                {advance} {t("collectorHistory.filters.advance")}
              </Text>
            </View>
          )}
        </View>
      )}

      {lastSync && (
        <Text allowFontScaling={false} style={s.lastSyncTxt}>
          {t("collectorHistory.lastSync")}: {fmtTime(lastSync.toISOString())}
        </Text>
      )}
    </View>
  );
};

// ─── Overall Stats Card ─────────────────────────────────────────────────────
const StatsCard = ({ stats, t }) => {
  if (!stats) return null;
  return (
    <View style={s.statsCard}>
      <Text allowFontScaling={false} style={s.statsTitle}>
        {t("collectorHistory.stats.overall")}
      </Text>
      <View style={s.statsGrid}>
        <View style={s.statsItem}>
          <Text allowFontScaling={false} style={s.statsVal}>₹{(stats.monthly_chanda_total || 0).toLocaleString("en-IN")}</Text>
          <Text allowFontScaling={false} style={s.statsLbl}>{t("collectorHistory.stats.chanda")}</Text>
        </View>
        <View style={s.statsItem}>
          <Text allowFontScaling={false} style={s.statsVal}>₹{(stats.donations_total || 0).toLocaleString("en-IN")}</Text>
          <Text allowFontScaling={false} style={s.statsLbl}>{t("collectorHistory.stats.donations")}</Text>
        </View>
        <View style={s.statsItem}>
          <Text allowFontScaling={false} style={s.statsVal}>₹{(stats.funds_total || 0).toLocaleString("en-IN")}</Text>
          <Text allowFontScaling={false} style={s.statsLbl}>{t("collectorHistory.stats.funds")}</Text>
        </View>
        <View style={[s.statsItem, s.statsItemHighlight]}>
          <Text allowFontScaling={false} style={[s.statsVal, { color: H.goldDeep }]}>₹{(stats.total_collection || 0).toLocaleString("en-IN")}</Text>
          <Text allowFontScaling={false} style={s.statsLbl}>{t("collectorHistory.stats.totalCollection")}</Text>
        </View>
        <View style={s.statsItem}>
          <Text allowFontScaling={false} style={[s.statsVal, stats.pending_count > 0 && { color: H.amber }]}>{stats.pending_count || 0}</Text>
          <Text allowFontScaling={false} style={s.statsLbl}>{t("collectorHistory.stats.pending")}</Text>
        </View>
      </View>
    </View>
  );
};

// ─── Payment Card ─────────────────────────────────────────────────────────────
const PaymentCard = React.memo(({ item, t }) => {
  const cfg = cfgFor(item);
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text allowFontScaling={false} style={s.cardName} numberOfLines={1}>{item.head_name}</Text>
            {item.entry_type !== "chanda" && (
              <View style={s.purposePill}>
                <Text allowFontScaling={false} style={s.purposePillTxt}>{item.purpose}</Text>
              </View>
            )}
          </View>
          {item.chanda_no && (
            <Text allowFontScaling={false} style={s.cardChandaNo}>{item.chanda_no}</Text>
          )}
        </View>
        <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
          <Text allowFontScaling={false} style={[s.statusTxt, { color: cfg.color }]}>{cfg.label(t)}</Text>
        </View>
      </View>

      <View style={s.cardMid}>
        <Text allowFontScaling={false} style={s.cardAmount}>₹{Number(item.amount).toLocaleString("en-IN")}</Text>
        <View style={s.cardMeta}>
          <Text allowFontScaling={false} style={s.cardMetaTxt}>{(item.method || "cash").toUpperCase()}</Text>
          {item.is_advance && (
            <View style={s.advancePill}>
              <Text allowFontScaling={false} style={s.advancePillTxt}>{t("collectorHistory.filters.advance")}</Text>
            </View>
          )}
          {item.status === "partial" && (
            <View style={[s.advancePill, { backgroundColor: "rgba(107,63,160,0.06)", borderColor: "#6B3FA0" }]}>
              <Text allowFontScaling={false} style={[s.advancePillTxt, { color: "#6B3FA0" }]}>{t("collectorHistory.filters.partial")}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={s.cardBottom}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <ReceiptIcon />
          <Text allowFontScaling={false} style={s.cardReceipt} numberOfLines={1}>
            {item.receipt_id || "—"}
          </Text>
        </View>
        <Text allowFontScaling={false} style={s.cardTime}>
          {fmtTime(item.collected_at || item.created_at)}
        </Text>
      </View>

      {item.covered_months?.length > 0 && (
        <Text allowFontScaling={false} style={s.cardCovered} numberOfLines={1}>
          {item.covered_months.map(ym => {
            const [y, m] = ym.split("-");
            return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
          }).join(", ")}
        </Text>
      )}
    </View>
  );
});

// ─── Group header ────────────────────────────────────────────────────────────
const GroupHeader = React.memo(({ label }) => (
  <View style={s.groupHeader}>
    <View style={s.groupHeaderLine} />
    <Text allowFontScaling={false} style={s.groupHeaderTxt}>{label}</Text>
    <View style={s.groupHeaderLine} />
  </View>
));

// ─── Search Card ─────────────────────────────────────────────────────────────
const SearchCard = ({ search, setSearch, t }) => (
  <View style={s.searchCard}>
    <SearchIcon />
    <TextInput
      style={s.searchInput}
      placeholder={t("collectorHistory.searchPlaceholder")}
      placeholderTextColor="#A0B8AC"
      value={search}
      onChangeText={setSearch}
      allowFontScaling={false}
      returnKeyType="search"
    />
    {search.length > 0 && (
      <AnimatedPressable onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
        <CloseIcon />
      </AnimatedPressable>
    )}
  </View>
);

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CollectorHistoryScreen({ navigation }) {
  const { t } = useTranslation();
  const isFocused = useIsFocused();

  const [allItems, setAllItems]   = useState([]);
  const [todaySummary, setToday]  = useState(null);
  const [stats, setStats]         = useState(null);
  const [search, setSearch]       = useState("");
  const [activeFilters, setFilters] = useState(new Set(["all"]));
  const [syncStatus, setSyncStatus] = useState("idle");
  const [lastSync, setLastSync]    = useState(null);
  const [page, setPage]            = useState(1);
  const [hasMore, setHasMore]      = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const debounceRef = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const headerFade = useRef(new Animated.Value(0)).current;
  const listFade   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFade, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(listFade,   { toValue: 1, duration: 400, delay: 100, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const fetchHistory = useCallback(async (pageNum = 1, append = false, isManualRefresh = false) => {
    if (pageNum === 1 && !isManualRefresh) setSyncStatus("syncing");

    if (pageNum === 1) {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          setAllItems(cached.entries || []);
          setToday(cached.today || null);
          setStats(cached.stats || null);
          setLastSync(cached.cachedAt ? new Date(cached.cachedAt) : null);
          if (!isManualRefresh) setSyncStatus("offline");
        }
      } catch {}
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
      const res = await authApiFetch(`/finance/collector/history?page=${pageNum}&per_page=50`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("not ok");
      const json = await res.json();
      const entries = json.entries || [];
      if (append) {
        setAllItems(prev => [...prev, ...entries]);
      } else {
        setAllItems(entries);
        setToday(json.today || null);
        setStats(json.stats || null);
        const cachePayload = { entries, today: json.today, stats: json.stats, cachedAt: new Date().toISOString() };
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cachePayload));
      }
      setHasMore(entries.length === 50);
      setPage(pageNum);
      setLastSync(new Date());
      setSyncStatus("synced");
    } catch {
      setSyncStatus("offline");
    } finally {
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) fetchHistory(1);
  }, [isFocused, fetchHistory]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistory(1, false, true);
  }, [fetchHistory]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await fetchHistory(page + 1, true);
  }, [hasMore, loadingMore, page, fetchHistory]);

  const toggleFilter = (key) => {
    setFilters(prev => {
      const next = new Set(prev);
      if (key === "all") return new Set(["all"]);
      next.delete("all");
      if (next.has(key)) { next.delete(key); if (next.size === 0) return new Set(["all"]); }
      else next.add(key);
      return next;
    });
  };

  const displayed = useMemo(() => {
    const q = normalize(debouncedSearch);
    const filters = [...activeFilters];
    return allItems.filter(item => {
      const matchesFilter = filters.every(f => f === "all" || passesFilter(item, f));
      if (!matchesFilter) return false;
      if (!q) return true;
      const hay = normalize(
        `${item.head_name} ${item.chanda_no} ${item.phone} ${item.address} ${item.receipt_id}`
      );
      return hay.includes(q);
    });
  }, [allItems, debouncedSearch, activeFilters]);

  const sections = useMemo(() => {
    const map = new Map();
    displayed.forEach(item => {
      const ds = itemDateStr(item);
      if (!map.has(ds)) map.set(ds, []);
      map.get(ds).push(item);
    });
    const result = [];
    for (const [ds, items] of map.entries()) {
      result.push({ type: "header", key: `h-${ds}`, label: groupLabel(ds, t) });
      items.forEach(item => result.push({ type: "item", key: `i-${item.entry_type}-${item.id}`, item }));
    }
    return result;
  }, [displayed]);

  const syncDotColor =
    syncStatus === "synced"  ? H.green :
    syncStatus === "syncing" ? H.gold  : H.amber;

  const renderRow = useCallback(({ item: row }) => {
    if (row.type === "header") return <GroupHeader label={row.label} />;
    return <PaymentCard item={row.item} t={t} />;
  }, [t]);

  const ListEmpty = () => (
    <View style={s.empty}>
      <Text allowFontScaling={false} style={s.emptyTitle}>
        {debouncedSearch || activeFilters.size > 1 || !activeFilters.has("all")
          ? t("collectorHistory.noResults")
          : t("collectorHistory.noHistory")}
      </Text>
      <Text allowFontScaling={false} style={s.emptyHint}>
        {t("collectorHistory.noHistoryHint")}
      </Text>
    </View>
  );

  const ListFooter = () => {
    if (!hasMore) return <View style={{ height: 80 }} />;
    return (
      <AnimatedPressable style={s.loadMoreBtn} onPress={loadMore} disabled={loadingMore} activeOpacity={0.7}>
        <Text allowFontScaling={false} style={s.loadMoreTxt}>
          {loadingMore ? t("collectorHistory.loading") : t("collectorHistory.loadMore")}
        </Text>
      </AnimatedPressable>
    );
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      <Animated.View style={[s.header, { opacity: headerFade }]}>
        <Svg width={SW} height={HEADER_H} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="chGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={H.headerDeep} />
              <Stop offset="100%" stopColor={H.headerLight} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={SW} height={HEADER_H} fill="url(#chGrad)" />
        </Svg>
        <HeaderPattern />

        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text allowFontScaling={false} style={s.headerEyebrow}>Mohideen Masjid</Text>
            <Text allowFontScaling={false} style={s.headerTitle}>{t("collectorHistory.title")}</Text>
          </View>
          <View style={[s.syncBadge, { borderColor: syncDotColor + "33" }]}>
            <View style={[s.syncDot, { backgroundColor: syncDotColor }]} />
            <Text allowFontScaling={false} style={[s.syncTxt, { color: syncDotColor }]}>
              {syncStatus === "synced" ? t("collectorHistory.synced") : syncStatus === "syncing" ? t("collectorHistory.syncing") : t("collectorHistory.offline")}
            </Text>
          </View>
        </View>
      </Animated.View>

      <Animated.View style={[{ flex: 1 }, { opacity: listFade }]}>
        <FlatList
          data={sections}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={s.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={H.gold}
              colors={[H.gold]}
              progressBackgroundColor="#fff"
            />
          }
          ListHeaderComponent={() => (
            <View>
              <SearchCard search={search} setSearch={setSearch} t={t} />
              <TodayCard
                today={todaySummary}
                isOffline={syncStatus === "offline"}
                lastSync={lastSync}
                t={t}
              />
              <StatsCard stats={stats} t={t} />
              <FlatList
                horizontal
                data={FILTERS}
                keyExtractor={f => f.key}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.filterRow}
                renderItem={({ item: f }) => {
                  const isActive = activeFilters.has(f.key);
                  return (
                    <AnimatedPressable
                      style={[s.filterChip, isActive && s.filterChipActive]}
                      onPress={() => toggleFilter(f.key)}
                      activeOpacity={0.75}
                    >
                      <Text allowFontScaling={false} style={[s.filterChipTxt, isActive && s.filterChipTxtActive]}>
                        {f.label(t)}
                      </Text>
                    </AnimatedPressable>
                  );
                }}
              />
            </View>
          )}
          ListEmptyComponent={<ListEmpty />}
          ListFooterComponent={<ListFooter />}
        />
      </Animated.View>
      <BottomNav navigation={navigation} currentRoute="CollectorHistory" />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },

  // Header — Clean, no search
  header: {
    height: HEADER_H,
    paddingTop: STATUSBAR_H,
    paddingHorizontal: 18,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...sh(8, 0.1),
  },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  headerEyebrow: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.55)", letterSpacing: 1.4, textTransform: "uppercase" },
  headerTitle: { fontSize: 20, fontWeight: "800", color: C.gold, fontFamily: FONTS.display, letterSpacing: -0.3, marginTop: 2 },

  syncBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  syncDot: { width: 5, height: 5, borderRadius: 2.5 },
  syncTxt: { fontSize: 10, fontWeight: "700" },

  // Search card
  searchCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: H.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: H.cardBorder,
    marginHorizontal: 16,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...sh(4, 0.05),
    gap: 10,
  },
  searchInput: { flex: 1, color: H.textDark, fontSize: 14, paddingVertical: 0, fontWeight: "500" },

  // ── Premium Today Card ─────────────────────────────────────────────────────
  todayCard: {
    backgroundColor: H.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: H.cardBorder,
    marginHorizontal: 16,
    marginTop: 14,
    padding: 18,
    ...sh(6, 0.06),
    position: "relative",
    overflow: "hidden",
  },
  todayAccentLine: {
    position: "absolute",
    top: 0,
    left: 18,
    right: 18,
    height: 2.5,
    backgroundColor: H.gold,
    borderBottomLeftRadius: 2.5,
    borderBottomRightRadius: 2.5,
    opacity: 0.6,
  },
  todayHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  todayLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: H.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 1,
  },
  todayDate: {
    fontSize: 13,
    fontWeight: "700",
    color: H.textDark,
  },
  offlinePill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: H.amberBg,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  offlinePillTxt: { fontSize: 10, fontWeight: "800", color: H.amber },
  todayTotalWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  rupeeWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(212,175,55,0.08)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  todayTotal: {
    fontSize: 30,
    fontWeight: "800",
    color: H.textDark,
    letterSpacing: -0.8,
  },
  todayDivider: {
    height: 1,
    backgroundColor: "rgba(11,61,46,0.05)",
    marginBottom: 12,
  },
  todayStatsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  todayStatItem: {
    flex: 1,
    alignItems: "center",
  },
  todayStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(11,61,46,0.04)",
  },
  todayStatValue: {
    fontSize: 14,
    fontWeight: "800",
    color: H.textDark,
  },
  todayStatLabel: {
    fontSize: 9,
    fontWeight: "600",
    color: H.textMuted,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  todayTags: {
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(11,61,46,0.03)",
  },
  tagPill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagPillTxt: {
    fontSize: 10,
    fontWeight: "700",
  },
  lastSyncTxt: {
    fontSize: 10,
    color: H.textMuted,
    marginTop: 8,
    textAlign: "right",
  },

  // ── Overall Stats Card ─────────────────────────────────────────────────────
  statsCard: {
    backgroundColor: H.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    ...sh(4, 0.05),
  },
  statsTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: H.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -3,
  },
  statsItem: {
    width: "33.33%",
    paddingHorizontal: 3,
    marginBottom: 8,
    alignItems: "center",
  },
  statsItemHighlight: {
    backgroundColor: "rgba(212,175,55,0.04)",
    borderRadius: 8,
    paddingVertical: 4,
    marginHorizontal: 2,
    width: "32%",
  },
  statsVal: {
    fontSize: 13,
    fontWeight: "800",
    color: H.textDark,
  },
  statsLbl: {
    fontSize: 8,
    fontWeight: "600",
    color: H.textMuted,
    marginTop: 1,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  // Filter chips
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  filterChip: {
    borderRadius: 20, borderWidth: 1, borderColor: H.cardBorder,
    backgroundColor: H.card, paddingHorizontal: 12, paddingVertical: 5,
    ...sh(2, 0.03),
  },
  filterChipActive: { backgroundColor: H.green, borderColor: H.green },
  filterChipTxt: { fontSize: 11, fontWeight: "600", color: H.textMuted },
  filterChipTxtActive: { color: "#fff" },

  // Group header
  groupHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, gap: 8 },
  groupHeaderLine: { flex: 1, height: 1, backgroundColor: "rgba(11,61,46,0.04)" },
  groupHeaderTxt: { fontSize: 10, fontWeight: "800", color: H.textMuted, textTransform: "uppercase", letterSpacing: 0.7 },

  // Compact Payment Card
  card: {
    backgroundColor: H.card, borderRadius: 14, borderWidth: 1,
    borderColor: H.cardBorder, marginHorizontal: 16, marginBottom: 8,
    padding: 14, ...sh(3, 0.04),
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6 },
  cardName: { fontSize: 13, fontWeight: "700", color: H.textDark },
  cardChandaNo: { fontSize: 10, color: H.textMuted, marginTop: 1 },
  purposePill: { backgroundColor: H.goldLight, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  purposePillTxt: { fontSize: 8, fontWeight: "800", color: H.goldDeep, textTransform: "uppercase" },
  statusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  statusTxt: { fontSize: 9, fontWeight: "800" },
  cardMid: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  cardAmount: { fontSize: 18, fontWeight: "800", color: H.textDark },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardMetaTxt: { fontSize: 10, fontWeight: "700", color: H.textMuted },
  advancePill: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, backgroundColor: "rgba(14,107,69,0.06)", borderColor: H.green },
  advancePillTxt: { fontSize: 8, fontWeight: "800", color: H.green },
  cardBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardReceipt: { fontSize: 10, color: H.textMuted, fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace" },
  cardTime: { fontSize: 10, color: H.textMuted, fontWeight: "600" },
  cardCovered: { fontSize: 10, color: H.green, marginTop: 4, fontWeight: "600" },

  listContent: { paddingBottom: BOTTOM_NAV_H + 16 },

  loadMoreBtn: {
    marginHorizontal: 16, marginTop: 6, marginBottom: 16,
    borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder,
    backgroundColor: H.card, paddingVertical: 12, alignItems: "center",
    ...sh(2, 0.03),
  },
  loadMoreTxt: { fontSize: 12, fontWeight: "700", color: H.textMuted },

  empty: { padding: 40, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: H.textDark, marginBottom: 4 },
  emptyHint: { fontSize: 12, color: H.textMuted, textAlign: "center", lineHeight: 18 },
});