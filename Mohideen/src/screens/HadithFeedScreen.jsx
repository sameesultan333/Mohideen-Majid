/**
 * HadithFeedScreen — Premium Hadith Feed
 * Clean cards · No audio · Navigation to detail
 */

import React, { useEffect, useState, useRef, useCallback, memo } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Image, Dimensions, Platform, StatusBar, SafeAreaView, RefreshControl } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import { apiAxios, buildAbsoluteUrl, getWsUrl } from "../config/server";
import BottomNav from "../components/BottomNav";
import { useBottomNavHeight } from "../hooks/useSafeArea";
import OfflineBanner from "../components/OfflineBanner";
import { COLORS as C } from "../config/theme";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";

// ─── Palette ──────────────────────────────────────────────────────────
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

const shadow = (y = 4, opacity = 0.08) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.6 },
    android: { elevation: y },
  });

// ─── SVG Icons ──────────────────────────────────────────────────────────
const CommentIcon = ({ color = H.textMuted, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill={color} opacity={0.7} />
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

// ─── Hijri Helper ──────────────────────────────────────────────────────
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
  const safeTitle = title ? String(title) : '';
  const safeGregorian = gregorianDate ? String(gregorianDate) : '';
  const safeHijri = hijriDate ? String(hijriDate) : '';

  return (
    <View style={hs.wrap}>
      <Svg width={SW} height={148} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={H.headerDeep} />
            <Stop offset="100%" stopColor={H.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={148} fill="url(#headerGrad)" />
      </Svg>
      <HeaderPattern w={SW} h={148} />

      <View style={hs.row}>
        <View style={hs.titleContainer}>
          <Text style={hs.title}>{safeTitle}</Text>
        </View>
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

// ─── Hadith Card ──────────────────────────────────────────────────────
const HadithCard = memo(({ item, onPress }) => {
  const { t } = useTranslation();
  const imageUrl = buildAbsoluteUrl(item.image_url);

  const safeTimestamp = item && item.created_at ? String(new Date(item.created_at).toLocaleDateString()) : 'Just now';
  const safeSource = item && item.source ? String(item.source) : '';
  const safeTranslation = item && item.translation ? String(item.translation) : '';
  const safeReplyCount = item && item.reply_count !== undefined ? String(item.reply_count) : '0';
  const previewText = safeTranslation.length > 120
    ? safeTranslation.slice(0, 120).trimEnd() + '…'
    : safeTranslation;

  return (
    <AnimatedPressable style={styles.card} onPress={() => onPress(item)} activeOpacity={0.85}>
      <View style={styles.cardHeader}>
        <Text style={styles.timestamp}>{safeTimestamp}</Text>
        {safeSource ? (
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceText}>{safeSource}</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.translation}>{previewText}</Text>
      {safeTranslation.length > 120 && (
        <Text style={styles.readMoreHint}>Tap to see full details</Text>
      )}

      <View style={styles.replyBtn}>
        <View style={styles.replyLeft}>
          <CommentIcon color={H.textMuted} size={18} />
          <Text style={styles.replyCount}>{safeReplyCount}</Text>
        </View>
        <Text style={styles.replyAction}>{t("hadith.viewDiscussion")}</Text>
      </View>
    </AnimatedPressable>
  );
});

// ─── Main Component ──────────────────────────────────────────────────
export default function HadithFeedScreen({ navigation, route }) {
  const { t } = useTranslation();
  const bottomNavHeight = useBottomNavHeight();
  const [hadiths, setHadiths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [readIds, setReadIds] = useState([]);
  const [readIdsLoaded, setReadIdsLoaded] = useState(false);

  const wsRef = useRef(null);

  // ─── Clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  // ─── Load read hadith IDs ─────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem("read_hadiths").then((saved) => {
      if (saved) {
        try { setReadIds(JSON.parse(saved)); } catch { setReadIds([]); }
      }
      setReadIdsLoaded(true);
    });
  }, []);

  // ─── Mark every currently-loaded hadith as read as soon as the feed is
  // opened, so the Deen tab badge clears immediately instead of requiring
  // a tap on each individual card. Waits for the stored read-ids to load
  // first so this merge never clobbers ids read in a previous session.
  useEffect(() => {
    if (!readIdsLoaded || hadiths.length === 0) return;
    setReadIds((prev) => {
      const ids = hadiths.map((h) => h.id);
      const merged = Array.from(new Set([...prev, ...ids]));
      if (merged.length === prev.length) return prev;
      AsyncStorage.setItem("read_hadiths", JSON.stringify(merged)).catch(() => {});
      return merged;
    });
  }, [hadiths, readIdsLoaded]);

  // ─── Fetch (cache-first) ─────────────────────────────────────────────
  const fetchHadiths = useCallback(async (isRefresh = false) => {
    // 1. Load cache immediately so we never show a blank screen
    try {
      const raw = await AsyncStorage.getItem("cache_hadiths");
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw);
        setHadiths(cached);
        setLastUpdated(new Date(ts));
        setLoading(false);
      }
    } catch {}

    if (isRefresh) setRefreshing(true);

    // 2. Try network (race against 4 s timeout)
    try {
      const res = await Promise.race([
        apiAxios({ method: "get", url: "/hadith" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
      ]);
      const filtered = (res.data || []).filter((item) => {
        if (!item.created_at) return true;
        const hoursDiff = (new Date() - new Date(item.created_at)) / 3600000;
        return hoursDiff < 48;
      });
      setHadiths(filtered);
      setIsOffline(false);
      const now = new Date();
      setLastUpdated(now);
      await AsyncStorage.setItem("cache_hadiths", JSON.stringify({ data: filtered, ts: now.getTime() }));
    } catch {
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHadiths();
    let active = true;
    (async () => {
      try {
        const wsUrl = await getWsUrl("/ws/hadith");
        if (!active) return;
        wsRef.current = new WebSocket(wsUrl);
        wsRef.current.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === "NEW_HADITH") {
            setHadiths((prev) => [msg.data, ...prev]);
          }
        };
      } catch (err) {
        // Silent WS error - will retry on next effect
      }
    })();
    return () => {
      active = false;
      wsRef.current?.close();
    };
  }, []);

  const onRefresh = useCallback(() => fetchHadiths(true), [fetchHadiths]);

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // ─── Handle card press ─────────────────────────────────────────────
  const handleCardPress = useCallback((hadith) => {
    // Mark as read
    if (!readIds.includes(hadith.id)) {
      const newReadIds = [...readIds, hadith.id];
      setReadIds(newReadIds);
      AsyncStorage.setItem("read_hadiths", JSON.stringify(newReadIds)).catch(() => {});
    }
    navigation.navigate("HadithDetail", { hadithId: hadith.id, hadith });
  }, [navigation, readIds]);

  // ─── Render ────────────────────────────────────────────────────────
  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.root}>
        <CompactHeader
          title={t("hadith.title")}
          hijriDate={hijriDate}
          gregorianDate={gregorianDate}
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={H.gold} />
          <Text style={styles.loadingText}>{t("hadith.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>

      <CompactHeader
        title={t("hadith.title")}
        hijriDate={hijriDate}
        gregorianDate={gregorianDate}
      />

      {isOffline && <OfflineBanner lastUpdated={lastUpdated} onRetry={() => fetchHadiths(true)} />}

      {hadiths.length === 0 && !loading ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{t("hadith.emptyTitle")}</Text>
          <Text style={styles.emptySub}>{t("hadith.emptySub")}</Text>
        </View>
      ) : (
        <FlatList
          data={hadiths}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <HadithCard item={item} onPress={handleCardPress} />}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomNavHeight + 20 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={H.gold} colors={[H.gold]} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <BottomNav navigation={navigation} currentRoute={route?.name || "Hadith"} />
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    color: H.textMuted,
    fontSize: 14,
    fontWeight: "500",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: H.textDark,
    fontFamily: "Georgia",
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 15,
    color: H.textMuted,
    textAlign: "center",
  },
  // paddingBottom is set dynamically at the call site via useBottomNavHeight()
  listContent: {
    padding: 16,
  },
  card: {
    backgroundColor: H.card,
    borderRadius: 24,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
    overflow: "hidden",
    ...shadow(6, 0.08),
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingBottom: 8,
  },
  timestamp: {
    fontSize: 12,
    color: H.textMuted,
    fontWeight: "600",
  },
  sourceBadge: {
    backgroundColor: H.goldLight + "20",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: H.goldLight + "40",
  },
  sourceText: {
    color: H.goldDeep,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  translation: {
    fontSize: 15,
    fontWeight: "600",
    color: H.textDark,
    lineHeight: 24,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  readMoreHint: {
    fontSize: 13,
    color: H.gold,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  arabic: {
    fontSize: 20,
    textAlign: "right",
    color: H.headerDeep,
    fontWeight: "700",
    lineHeight: 32,
    paddingHorizontal: 16,
    paddingBottom: 12,
    fontFamily: "Georgia",
  },
  imageContainer: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: H.cardBorder,
  },
  image: {
    height: 200,
    width: "100%",
  },
  replyBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: H.cardBorder,
    backgroundColor: H.bg,
  },
  replyLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  replyCount: {
    fontSize: 13,
    color: H.textMuted,
    fontWeight: "600",
  },
  replyAction: {
    fontSize: 13,
    color: H.headerDeep,
    fontWeight: "700",
  },
});

// ─── Header Styles ────────────────────────────────────────────────────
const hs = StyleSheet.create({
  wrap: {
    height: 136,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingTop: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  titleContainer: { flex: 1 },
  title: {
    color: H.white,
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Georgia",
    letterSpacing: 0.5,
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