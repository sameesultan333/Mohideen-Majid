import React, { useEffect, useState, useRef, useCallback, memo } from "react";
import { View, Text, StyleSheet, ScrollView, StatusBar, Animated, Platform, Dimensions, RefreshControl, Image, ActivityIndicator, Modal, Pressable } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import BottomNav from "../components/BottomNav";
import OfflineBanner from "../components/OfflineBanner";
import { apiAxios, getWsUrl, buildAbsoluteUrl } from "../config/server";
import { COLORS as C } from "../config/theme";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { useTopInset } from "../hooks/useSafeArea";

// ─── Palette (exact same as HomeScreen) ─────────────────────────────
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
const ArrowBackIcon = memo(({ color = H.white, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15 18 L9 12 L15 6" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

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

// ─── Compact Header for AnnouncementScreen ──────────────────────────
const CompactHeader = ({ onBack, title, hijriDate, gregorianDate }) => {
  const topInset = useTopInset();
  // Ensure all props are strings (fallback to empty string)
  const safeTitle = typeof title === 'string' ? title : '';
  const safeHijri = typeof hijriDate === 'string' ? hijriDate : '';
  const safeGregorian = typeof gregorianDate === 'string' ? gregorianDate : '';

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
        <View style={hs.mid}>
          <Text allowFontScaling={false} style={hs.title}>{safeTitle}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={hs.dateRow}>
        <Text allowFontScaling={false} style={hs.dateTxt}>{safeGregorian}</Text>
        <View style={hs.dateDot} />
        <Text allowFontScaling={false} style={hs.dateTxt}>{safeHijri}</Text>
      </View>
    </View>
  );
};

// ─── Full-screen image preview modal ────────────────────────────────
function ImagePreviewModal({ uri, onClose }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 50, useNativeDriver: true }),
    ]).start();
  }, []);

  const close = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 0.88, duration: 150, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", opacity: fadeAnim, justifyContent: "center", alignItems: "center" }}>
        <Pressable style={{ position: "absolute", inset: 0 }} onPress={close} />
        <Animated.View style={{ transform: [{ scale: scaleAnim }], width: SW - 32, borderRadius: 18, overflow: "hidden", backgroundColor: "#111" }}>
          <Image
            source={{ uri }}
            style={{ width: "100%", aspectRatio: 16 / 9 }}
            resizeMode="contain"
          />
        </Animated.View>
        <AnimatedPressable
          onPress={close}
          style={{ marginTop: 20, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 99, paddingHorizontal: 28, paddingVertical: 10 }}
        >
          <Text allowFontScaling={false} style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Close</Text>
        </AnimatedPressable>
      </Animated.View>
    </Modal>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function AnnouncementScreen({ navigation, route }) {
  const currentRoute = route?.name || "Announcement";
  const { t } = useTranslation();

  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [imageStates, setImageStates] = useState({});
  const [readIds, setReadIds] = useState([]);
  const [readIdsLoaded, setReadIdsLoaded] = useState(false);
  const [previewUri, setPreviewUri] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const currentUserIdRef = useRef(null);
  const wsRef = useRef(null);

  const fade = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(30)).current;

  // ─── Animations ────────────────────────────────────────────────────
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  // ─── Clock update ─────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  // ─── Load current user id + read announcement IDs ─────────────────
  useEffect(() => {
    AsyncStorage.getItem("user").then((u) => {
      if (u) {
        try {
          const uid = JSON.parse(u)?.id ?? null;
          setCurrentUserId(uid);
          currentUserIdRef.current = uid;
        } catch {}
      }
    });
    AsyncStorage.getItem("read_announcements").then((saved) => {
      if (saved) {
        try {
          setReadIds(JSON.parse(saved));
        } catch (e) {
          setReadIds([]);
        }
      }
      setReadIdsLoaded(true);
    });
  }, []);

  // ─── Mark every currently-loaded announcement as read as soon as this
  // screen is opened, so the header bell / bottom-nav badge clears
  // immediately instead of requiring a tap on each individual card.
  useEffect(() => {
    if (!readIdsLoaded || announcements.length === 0) return;
    setReadIds((prev) => {
      const ids = announcements.map((a) => a.id);
      const merged = Array.from(new Set([...prev, ...ids]));
      if (merged.length === prev.length) return prev;
      AsyncStorage.setItem("read_announcements", JSON.stringify(merged)).catch(() => {});
      AsyncStorage.setItem("badge_Announcement", "0").catch(() => {});
      return merged;
    });
  }, [announcements, readIdsLoaded]);

  // ─── Fetch / WebSocket ─────────────────────────────────────────────
  const fetchAnnouncements = useCallback(async () => {
    // 1. Show cache immediately
    try {
      const raw = await AsyncStorage.getItem("cached_announcements");
      if (raw) {
        setAnnouncements(JSON.parse(raw));
        setLoading(false);
      }
    } catch {}

    // 2. Race network vs 4 s timeout
    try {
      const params = currentUserId ? { user_id: currentUserId } : {};
      const res = await Promise.race([
        apiAxios({ method: "get", url: "/announcements/", params }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
      ]);
      const items = res.data || [];
      setAnnouncements(items);
      setIsOffline(false);
      await AsyncStorage.setItem("cached_announcements", JSON.stringify(items));
    } catch {
      setIsOffline(true);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  // Re-fetch whenever user ID loads (so targeted announcements appear)
  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  // WebSocket — set up once on mount
  useEffect(() => {
    const connectWS = async () => {
      try {
        const wsUrl = await getWsUrl("/ws/announcements");
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === "new_announcement") {
            const d = msg.data;
            // currentUserId captured via closure; re-read from ref for live value
            const uid = currentUserIdRef.current;
            const isForMe = !d.target_user_id || d.target_user_id === uid;
            if (isForMe) setAnnouncements((prev) => [d, ...prev]);
          }
        };
      } catch {
        // fallback – no WebSocket, just polling
      }
    };
    connectWS();

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // ─── Pull-to-refresh ─────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAnnouncements();
    setRefreshing(false);
  }, [fetchAnnouncements]);

  // ─── Helpers ──────────────────────────────────────────────────────
  const parseLocalDate = (iso) => {
    if (!iso) return null;
    const s = String(iso).trim().replace(" ", "T").split(".")[0];
    return new Date(s + "Z");   // server returns UTC without Z — append it
  };

  const formatTime = (date) => {
    if (!date) return "";
    const d = parseLocalDate(date);
    if (!d || Number.isNaN(d.getTime())) return "";
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const isToday = d.toDateString() === today.toDateString();
    const isYesterday = d.toDateString() === yesterday.toDateString();
    
    const timeStr = d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    
    if (isToday) {
      return `Today · ${timeStr}`;
    }
    if (isYesterday) {
      return `Yesterday · ${timeStr}`;
    }
    
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }) + ` · ${timeStr}`;
  };

  const handleImageLoad = useCallback((id) => {
    setImageStates(prev => ({ ...prev, [id]: { loaded: true, error: false } }));
  }, []);

  const handleImageError = useCallback((id) => {
    setImageStates(prev => ({ ...prev, [id]: { loaded: false, error: true } }));
  }, []);

  const markAsRead = useCallback((id) => {
    if (!readIds.includes(id)) {
      const newReadIds = [...readIds, id];
      setReadIds(newReadIds);
      AsyncStorage.setItem("read_announcements", JSON.stringify(newReadIds)).catch(() => {});
      const remaining = announcements.filter(a => !newReadIds.includes(a.id)).length;
      AsyncStorage.setItem("badge_Announcement", String(remaining)).catch(() => {});
    }
  }, [readIds, announcements]);

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
        onBack={() => navigation.goBack()}
        title={t("announcement.title")}
        hijriDate={hijriDate}
        gregorianDate={gregorianDate}
      />

      {isOffline && <OfflineBanner lastUpdated={null} onRetry={() => fetchAnnouncements()} />}

      <Animated.ScrollView
        style={{ flex: 1, opacity: fade, transform: [{ translateY: translate }] }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={H.gold} />
        }
        showsVerticalScrollIndicator={false}
      >
        {announcements.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("announcement.emptyTitle")}</Text>
            <Text style={styles.emptySub}>{t("announcement.emptySub")}</Text>
          </View>
        ) : (
          <>
            {announcements.map((item, index) => {
              const imageState = imageStates[item.id] || { loaded: false, error: false };
              const resolvedImageUrl = item.image_url ? buildAbsoluteUrl(item.image_url) : null;
              const hasImage = !!resolvedImageUrl && !imageState.error;
              const isRead = readIds.includes(item.id);
              
              return (
                <AnimatedPressable
                  key={item.id || index}
                  activeOpacity={0.85}
                  onPress={() => markAsRead(item.id)}
                >
                  <Animated.View
                    style={[
                      styles.card,
                      item.pinned && styles.pinnedCard,
                      !isRead && styles.unreadCard,
                    ]}
                  >
                  {hasImage && (
                    <AnimatedPressable
                      activeOpacity={0.88}
                      onPress={() => setPreviewUri(resolvedImageUrl)}
                      style={styles.imageContainer}
                    >
                      {!imageState.loaded && (
                        <View style={styles.imagePlaceholder}>
                          <ActivityIndicator size="small" color={H.gold} />
                        </View>
                      )}
                      <Image
                        source={{ uri: resolvedImageUrl }}
                        style={styles.cardImage}
                        onLoad={() => handleImageLoad(item.id)}
                        onError={() => handleImageError(item.id)}
                        resizeMode="cover"
                      />
                      {imageState.loaded && (
                        <View style={styles.zoomHint}>
                          <Text allowFontScaling={false} style={styles.zoomHintTxt}>Tap to view</Text>
                        </View>
                      )}
                    </AnimatedPressable>
                  )}
                  
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {item.pinned && (
                      <View style={styles.pinnedBadge}>
                        <Text style={styles.pinnedBadgeText}>{t("announcement.pinned")}</Text>
                      </View>
                    )}
                    {item.target_user_id && (
                      <View style={[styles.pinnedBadge, { backgroundColor: "rgba(11,61,46,0.08)" }]}>
                        <Text style={[styles.pinnedBadgeText, { color: H.textDark }]}>Private</Text>
                      </View>
                    )}
                  </View>
                  
                  {item.title ? (
                    <Text style={styles.cardTitle}>{item.title}</Text>
                  ) : null}
                  
                  <Text style={styles.cardBody}>
                    {item.body || item.message}
                  </Text>
                  
                  <View style={styles.metaRow}>
                    <Text style={styles.time}>{formatTime(item.created_at)}</Text>
                    {item.posted_by && (
                      <Text style={styles.postedBy}>{t("announcement.postedBy")} {item.posted_by}</Text>
                    )}
                  </View>
                </Animated.View>
                </AnimatedPressable>
              );
            })}
          </>
        )}
      </Animated.ScrollView>

      <BottomNav navigation={navigation} currentRoute={currentRoute} />
      {previewUri && <ImagePreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  scrollContent: { padding: 16, paddingBottom: 120 },

  empty: {
    marginTop: 80,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: H.textDark,
    fontFamily: "Georgia",
  },
  emptySub: {
    marginTop: 6,
    fontSize: 13,
    color: H.textMuted,
  },

  card: {
    backgroundColor: H.card,
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: H.cardBorder,
    overflow: "hidden",
    ...shadow(4, 0.06),
  },
  pinnedCard: {
    borderLeftWidth: 4,
    borderLeftColor: H.gold,
  },
  unreadCard: {
    borderLeftWidth: 4,
    borderLeftColor: H.gold,
  },
  imageContainer: {
    marginBottom: 12,
    borderRadius: 16,
    overflow: "hidden",
    aspectRatio: 16 / 9,
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: H.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  zoomHint: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  zoomHintTxt: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  pinnedBadge: {
    alignSelf: "flex-start",
    backgroundColor: H.goldLight + "30",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  pinnedBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: H.goldDeep,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: H.textDark,
    marginBottom: 6,
    fontFamily: "Georgia",
  },
  cardBody: {
    fontSize: 14,
    color: H.textDark,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: H.cardBorder,
  },
  time: {
    fontSize: 11,
    color: H.textMuted,
    fontWeight: "600",
  },
  postedBy: {
    fontSize: 11,
    color: H.textMuted,
    fontWeight: "500",
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
    marginTop: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  mid: {
    flex: 1,
    marginLeft: 12,
  },
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