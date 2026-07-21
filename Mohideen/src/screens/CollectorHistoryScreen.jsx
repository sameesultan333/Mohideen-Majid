/**
 * CollectorHistoryScreen — Mohideen Masjid
 *
 * Shows the logged-in collector's own payment collection history.
 * Offline-first: cache shown immediately, network refresh in background.
 * Max 2-second wait before falling back to cache.
 * Local search + filter after first load (no API call per keystroke).
 */

import React, {
  useEffect, useRef, useState, useCallback, useMemo,
} from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, Animated, Platform, StatusBar, Dimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import { useIsFocused } from "@react-navigation/native";
import { authApiFetch } from "../config/server";
import { COLORS as C, RADII, FONTS } from "../config/theme";
import { useTranslation } from "react-i18next";
import BottomNav from "../components/BottomNav";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
const STATUSBAR_H = IOS ? 48 : (StatusBar.currentHeight || 0) + 6;
const HEADER_H = 130;
const BOTTOM_NAV_H = Platform.select({ ios: 89, android: 73 });
const CACHE_KEY = "collector_history_cache";
const FETCH_TIMEOUT = 2000;

// ── Palette ──────────────────────────────────────────────────────────────────
const H = {
  bg:         "#FBF9F4",
  card:       "#FFFFFF",
  cardBorder: "rgba(11,61,46,0.08)",
  headerDeep: C.bg,
  headerLight:C.bgVivid,
  gold:       C.gold,
  goldDeep:   C.goldDeep,
  goldLight:  C.goldLight,
  green:      "#0E6B45",
  textDark:   C.textDark,
  textMuted:  C.textMuted,
  amber:      "#9A6B2E",
  amberBg:    "rgba(154,107,46,0.1)",
  errorBg:    C.errorBg,
  error:      C.error,
};

const sh = (y = 6, op = 0.1) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: op, shadowRadius: y * 1.6 },
    android: { elevation: Math.round(y * 1.2) },
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
  // Add Z so JS treats it as UTC, then format in device local timezone (IST)
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
  verified: { label: (t) => t("collectorHistory.status.verified"),   color: H.green,  bg: "rgba(14,107,69,0.1)" },
  pending:  { label: (t) => t("collectorHistory.status.pending"),    color: H.amber,  bg: H.amberBg },
  partial:  { label: (t) => t("collectorHistory.status.partial"),    color: "#6B3FA0", bg: "rgba(107,63,160,0.1)" },
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

// ── Header pattern ────────────────────────────────────────────────────────────
const HeaderPattern = () => {
  const step = 42;
  const cols = Math.ceil(SW / step) + 1;
  const rows = Math.ceil(HEADER_H / step) + 1;
  const stars = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = c * step + (r % 2 === 0 ? 0 : step / 2);
      const cy = r * step;
      stars.push(`M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`);
    }
  return (
    <Svg width={SW} height={HEADER_H} style={StyleSheet.absoluteFill}>
      {stars.map((d, i) => <Path key={i} d={d} fill={H.gold} opacity={0.06} />)}
    </Svg>
  );
};

// ── Summary card ──────────────────────────────────────────────────────────────
const SummaryCard = ({ today, stats, isOffline, lastSync }) => {
  const { t } = useTranslation();
  return (
  <View style={s.summaryCard}>
    <View style={s.summaryHeader}>
      <Text allowFontScaling={false} style={s.summaryTitle}>
        {t("collectorHistory.todayCollection")}
      </Text>
      {isOffline ? (
        <View style={s.offlinePill}>
          <Text allowFontScaling={false} style={s.offlinePillTxt}>{t("collectorHistory.cached")}</Text>
        </View>
      ) : null}
    </View>
    <View style={s.summaryRow}>
      <View style={s.summaryItem}>
        <Text allowFontScaling={false} style={s.summaryVal}>₹{(today?.total || 0).toLocaleString("en-IN")}</Text>
        <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.totalCollected")}</Text>
      </View>
      <View style={s.summaryDivider} />
      <View style={s.summaryItem}>
        <Text allowFontScaling={false} style={s.summaryVal}>{today?.count || 0}</Text>
        <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.payments")}</Text>
      </View>
      <View style={s.summaryDivider} />
      <View style={s.summaryItem}>
        <Text allowFontScaling={false} style={s.summaryVal}>₹{(today?.cash || 0).toLocaleString("en-IN")}</Text>
        <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.cash")}</Text>
      </View>
      <View style={s.summaryDivider} />
      <View style={s.summaryItem}>
        <Text allowFontScaling={false} style={s.summaryVal}>₹{(today?.upi || 0).toLocaleString("en-IN")}</Text>
        <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.upi")}</Text>
      </View>
    </View>
    {(today?.partial > 0 || today?.advance > 0) && (
      <View style={s.summaryRow2}>
        {today?.partial > 0 && (
          <View style={s.tagPill}>
            <Text allowFontScaling={false} style={s.tagPillTxt}>{today.partial} {t("collectorHistory.filters.partial")}</Text>
          </View>
        )}
        {today?.advance > 0 && (
          <View style={[s.tagPill, { backgroundColor: "rgba(14,107,69,0.1)", borderColor: H.green }]}>
            <Text allowFontScaling={false} style={[s.tagPillTxt, { color: H.green }]}>{today.advance} {t("collectorHistory.filters.advance")}</Text>
          </View>
        )}
      </View>
    )}
    {stats ? (
      <>
        <View style={s.statsDivider} />
        <View style={s.summaryRow}>
          <View style={s.summaryItem}>
            <Text allowFontScaling={false} style={s.summaryValSm}>₹{(stats.monthly_chanda_total || 0).toLocaleString("en-IN")}</Text>
            <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.stats.chanda")}</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <Text allowFontScaling={false} style={s.summaryValSm}>₹{(stats.donations_total || 0).toLocaleString("en-IN")}</Text>
            <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.stats.donations")}</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <Text allowFontScaling={false} style={s.summaryValSm}>₹{(stats.funds_total || 0).toLocaleString("en-IN")}</Text>
            <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.stats.funds")}</Text>
          </View>
        </View>
        <View style={s.summaryRow}>
          <View style={s.summaryItem}>
            <Text allowFontScaling={false} style={s.summaryVal}>₹{(stats.total_collection || 0).toLocaleString("en-IN")}</Text>
            <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.stats.totalCollection")}</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <Text allowFontScaling={false} style={[s.summaryVal, stats.pending_count > 0 && { color: H.amber }]}>{stats.pending_count || 0}</Text>
            <Text allowFontScaling={false} style={s.summaryLbl}>{t("collectorHistory.stats.pending")}</Text>
          </View>
        </View>
      </>
    ) : null}
    {lastSync ? (
      <Text allowFontScaling={false} style={s.lastSyncTxt}>
        {t("collectorHistory.lastSync")}: {fmtTime(lastSync.toISOString())}
      </Text>
    ) : null}
  </View>
);
};

// ── Payment card ──────────────────────────────────────────────────────────────
const PaymentCard = ({ item }) => {
  const { t } = useTranslation();
  const cfg = cfgFor(item);
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text allowFontScaling={false} style={s.cardName} numberOfLines={1}>{item.head_name}</Text>
            {item.entry_type !== "chanda" && (
              <View style={s.purposePill}>
                <Text allowFontScaling={false} style={s.purposePillTxt}>{item.purpose}</Text>
              </View>
            )}
          </View>
          {item.chanda_no ? (
            <Text allowFontScaling={false} style={s.cardChandaNo}>{item.chanda_no}</Text>
          ) : null}
        </View>
        <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
          <Text allowFontScaling={false} style={[s.statusTxt, { color: cfg.color }]}>{cfg.label(t)}</Text>
        </View>
      </View>

      <View style={s.cardMid}>
        <Text allowFontScaling={false} style={s.cardAmount}>₹{Number(item.amount).toLocaleString("en-IN")}</Text>
        <View style={s.cardMeta}>
          <Text allowFontScaling={false} style={s.cardMetaTxt}>
            {(item.method || "cash").toUpperCase()}
          </Text>
          {item.is_advance && (
            <View style={s.advancePill}>
              <Text allowFontScaling={false} style={s.advancePillTxt}>{t("collectorHistory.filters.advance")}</Text>
            </View>
          )}
          {item.status === "partial" && (
            <View style={[s.advancePill, { backgroundColor: "rgba(107,63,160,0.1)", borderColor: "#6B3FA0" }]}>
              <Text allowFontScaling={false} style={[s.advancePillTxt, { color: "#6B3FA0" }]}>{t("collectorHistory.filters.partial")}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={s.cardBottom}>
        <Text allowFontScaling={false} style={s.cardReceipt} numberOfLines={1}>
          {item.receipt_id || "—"}
        </Text>
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
};

// ── Date group header ─────────────────────────────────────────────────────────
const GroupHeader = ({ label }) => (
  <View style={s.groupHeader}>
    <Text allowFontScaling={false} style={s.groupHeaderTxt}>{label}</Text>
  </View>
);

// ── Main screen ───────────────────────────────────────────────────────────────
export default function CollectorHistoryScreen({ navigation }) {
  const { t } = useTranslation();
  const isFocused = useIsFocused();

  const [allItems, setAllItems]   = useState([]);
  const [todaySummary, setToday]  = useState(null);
  const [stats, setStats]         = useState(null);
  const [search, setSearch]       = useState("");
  const [activeFilters, setFilters] = useState(new Set(["all"]));
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | offline
  const [lastSync, setLastSync]    = useState(null);
  const [page, setPage]            = useState(1);
  const [hasMore, setHasMore]      = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const debounceRef = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const headerFade = useRef(new Animated.Value(0)).current;
  const listFade   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFade, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(listFade,   { toValue: 1, duration: 360, delay: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  // Debounce search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const fetchHistory = useCallback(async (pageNum = 1, append = false) => {
    if (pageNum === 1) setSyncStatus("syncing");

    // Cache-first: load immediately
    if (pageNum === 1) {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          setAllItems(cached.entries || []);
          setToday(cached.today || null);
          setStats(cached.stats || null);
          setLastSync(cached.cachedAt ? new Date(cached.cachedAt) : null);
          setSyncStatus("offline");
        }
      } catch {}
    }

    // Network with 2-second timeout
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
    }
  }, []);

  useEffect(() => {
    if (isFocused) fetchHistory(1);
  }, [isFocused, fetchHistory]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await fetchHistory(page + 1, true);
  }, [hasMore, loadingMore, page, fetchHistory]);

  // Toggle filter — "all" is exclusive
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

  // Local filter + search
  const displayed = useMemo(() => {
    const q = normalize(debouncedSearch);
    const filters = [...activeFilters];

    return allItems.filter(item => {
      // filter chips
      const matchesFilter = filters.every(f => f === "all" || passesFilter(item, f));
      if (!matchesFilter) return false;
      // search
      if (!q) return true;
      const hay = normalize(
        `${item.head_name} ${item.chanda_no} ${item.phone} ${item.address} ${item.receipt_id}`
      );
      return hay.includes(q);
    });
  }, [allItems, debouncedSearch, activeFilters]);

  // Group by date
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
      items.forEach(item => result.push({ type: "item", key: `i-${item.id}`, item }));
    }
    return result;
  }, [displayed]);

  const syncDotColor =
    syncStatus === "synced"  ? H.green :
    syncStatus === "syncing" ? H.gold  : H.amber;
  const syncLabel =
    syncStatus === "synced"  ? t("collectorHistory.synced")  :
    syncStatus === "syncing" ? t("collectorHistory.syncing") : t("collectorHistory.offline");

  const renderRow = ({ item: row }) => {
    if (row.type === "header") return <GroupHeader label={row.label} />;
    return <PaymentCard item={row.item} />;
  };

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
    if (!hasMore) return <View style={{ height: 100 }} />;
    return (
      <TouchableOpacity style={s.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
        <Text allowFontScaling={false} style={s.loadMoreTxt}>
          {loadingMore ? t("collectorHistory.loading") : t("collectorHistory.loadMore")}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      {/* ── Header ── */}
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
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => navigation.replace("Home")}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text allowFontScaling={false} style={s.backArrow}>←</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text allowFontScaling={false} style={s.headerEyebrow}>Mohideen Masjid</Text>
            <Text allowFontScaling={false} style={s.headerTitle}>{t("collectorHistory.title")}</Text>
          </View>
          <View style={[s.syncBadge, { borderColor: syncDotColor + "44" }]}>
            <View style={[s.syncDot, { backgroundColor: syncDotColor }]} />
            <Text allowFontScaling={false} style={[s.syncTxt, { color: syncDotColor }]}>{syncLabel}</Text>
          </View>
        </View>

        {/* Search */}
        <View style={s.searchBox}>
          <Text allowFontScaling={false} style={s.searchIcon}>⌕</Text>
          <TextInput
            style={s.searchInput}
            placeholder={t("collectorHistory.searchPlaceholder")}
            placeholderTextColor={H.textMuted}
            value={search}
            onChangeText={setSearch}
            allowFontScaling={false}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text allowFontScaling={false} style={s.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
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
          ListHeaderComponent={() => (
            <View>
              <SummaryCard
                today={todaySummary}
                stats={stats}
                isOffline={syncStatus === "offline"}
                lastSync={lastSync}
              />
              {/* Filter chips */}
              <FlatList
                horizontal
                data={FILTERS}
                keyExtractor={f => f.key}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.filterRow}
                renderItem={({ item: f }) => {
                  const isActive = activeFilters.has(f.key);
                  return (
                    <TouchableOpacity
                      style={[s.filterChip, isActive && s.filterChipActive]}
                      onPress={() => toggleFilter(f.key)}
                      activeOpacity={0.75}
                    >
                      <Text allowFontScaling={false} style={[s.filterChipTxt, isActive && s.filterChipTxtActive]}>
                        {f.label(t)}
                      </Text>
                    </TouchableOpacity>
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },

  // Header
  header: {
    height: HEADER_H,
    paddingTop: STATUSBAR_H,
    paddingHorizontal: 16,
    overflow: "hidden",
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    ...sh(8, 0.16),
  },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  backBtn: {
    width: 34, height: 34, borderRadius: RADII.sm,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: 1, borderColor: "rgba(212,175,55,0.35)",
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  backArrow: { color: H.gold, fontSize: 17, lineHeight: 18 },
  headerEyebrow: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.6)", letterSpacing: 1.3, textTransform: "uppercase" },
  headerTitle: { fontSize: 19, fontWeight: "800", color: H.gold, fontFamily: FONTS.display, letterSpacing: -0.2 },

  syncBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,255,255,0.11)",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
  },
  syncDot: { width: 6, height: 6, borderRadius: 3 },
  syncTxt: { fontSize: 10, fontWeight: "700" },

  searchBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.13)",
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(212,175,55,0.25)",
    paddingHorizontal: 10, gap: 6, height: 36,
  },
  searchIcon: { color: "rgba(255,255,255,0.55)", fontSize: 15 },
  searchInput: { flex: 1, color: "#fff", fontSize: 13, paddingVertical: 0 },
  searchClear: { color: "rgba(255,255,255,0.55)", fontSize: 13 },

  // Summary card
  summaryCard: {
    backgroundColor: H.card, borderRadius: 14, borderWidth: 1,
    borderColor: H.cardBorder, marginHorizontal: 14, marginTop: 14, marginBottom: 4,
    padding: 14, ...sh(4, 0.07),
  },
  summaryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  summaryTitle: { fontSize: 12, fontWeight: "800", color: H.textDark, textTransform: "uppercase", letterSpacing: 0.7 },
  offlinePill: { backgroundColor: H.amberBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  offlinePillTxt: { fontSize: 10, fontWeight: "700", color: H.amber },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryVal: { fontSize: 15, fontWeight: "800", color: H.textDark },
  summaryValSm: { fontSize: 13, fontWeight: "800", color: H.textDark },
  summaryLbl: { fontSize: 9, fontWeight: "600", color: H.textMuted, marginTop: 2, textAlign: "center" },
  summaryDivider: { width: 1, height: 30, backgroundColor: H.cardBorder },
  statsDivider: { height: 1, backgroundColor: H.cardBorder, marginVertical: 10 },
  summaryRow2: { flexDirection: "row", gap: 6, marginTop: 10 },
  tagPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: H.amberBg, borderWidth: 1, borderColor: H.amber },
  tagPillTxt: { fontSize: 10, fontWeight: "700", color: H.amber },
  lastSyncTxt: { fontSize: 10, color: H.textMuted, marginTop: 8 },

  // Filter chips
  filterRow: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  filterChip: {
    borderRadius: 20, borderWidth: 1, borderColor: H.cardBorder,
    backgroundColor: H.card, paddingHorizontal: 12, paddingVertical: 6,
  },
  filterChipActive: { backgroundColor: H.green, borderColor: H.green },
  filterChipTxt: { fontSize: 12, fontWeight: "600", color: H.textMuted },
  filterChipTxtActive: { color: "#fff" },

  // Group header
  groupHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  groupHeaderTxt: { fontSize: 11, fontWeight: "800", color: H.textMuted, textTransform: "uppercase", letterSpacing: 0.8 },

  // Card
  card: {
    backgroundColor: H.card, borderRadius: 12, borderWidth: 1,
    borderColor: H.cardBorder, marginHorizontal: 14, marginBottom: 8,
    padding: 14, ...sh(3, 0.06),
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  cardName: { fontSize: 14, fontWeight: "700", color: H.textDark },
  cardChandaNo: { fontSize: 11, color: H.textMuted, marginTop: 1 },
  purposePill: { backgroundColor: H.goldLight, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  purposePillTxt: { fontSize: 9, fontWeight: "800", color: H.goldDeep, textTransform: "uppercase" },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusTxt: { fontSize: 10, fontWeight: "800" },
  cardMid: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  cardAmount: { fontSize: 20, fontWeight: "800", color: H.textDark },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardMetaTxt: { fontSize: 11, fontWeight: "700", color: H.textMuted },
  advancePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "rgba(14,107,69,0.1)", borderWidth: 1, borderColor: H.green },
  advancePillTxt: { fontSize: 9, fontWeight: "800", color: H.green },
  cardBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardReceipt: { fontSize: 11, color: H.textMuted, fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace", flex: 1 },
  cardTime: { fontSize: 11, color: H.textMuted, fontWeight: "600" },
  cardCovered: { fontSize: 11, color: H.green, marginTop: 6, fontWeight: "600" },

  listContent: { paddingBottom: BOTTOM_NAV_H + 16 },

  loadMoreBtn: {
    marginHorizontal: 14, marginTop: 8, marginBottom: 16,
    borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder,
    backgroundColor: H.card, paddingVertical: 14, alignItems: "center",
  },
  loadMoreTxt: { fontSize: 13, fontWeight: "700", color: H.textMuted },

  empty: { padding: 40, alignItems: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: H.textDark, marginBottom: 6 },
  emptyHint: { fontSize: 12, color: H.textMuted, textAlign: "center" },
});
