// screens/HistoryScreen.jsx
import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import { View, Text, FlatList, StyleSheet, Animated, Dimensions, Platform, StatusBar, RefreshControl } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useIsFocused } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { authApiFetch, getWsUrl } from "../config/server";
import { formatCoveredMonths, formatServerDateTime } from "../utils/datetime";
import { COLORS as C, RADII, FONTS } from "../config/theme";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import BottomNav from "../components/BottomNav";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
const HEADER_H = 120;
const BOTTOM_NAV_H = Platform.select({ ios: 89, android: 73 });

// ─── Palette ──────────────────────────────────────────────────────────
const H = {
  bg:         "#FBF9F4",
  card:       "#FFFFFF",
  cardBorder: "rgba(212,175,55,0.15)",   // gold tint
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
  error:      C.error,
  errorBg:    C.errorBg,
};

// ─── Header Pattern ──────────────────────────────────────────────────
const HeaderPattern = memo(({ w = SW, h = HEADER_H }) => {
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

// ─── Premium Header ──────────────────────────────────────────────────
const PremiumHeader = memo(({ title }) => {
  return (
    <View style={headerStyles.wrap}>
      <Svg width={SW} height={HEADER_H} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="historyHeader" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={H.headerDeep} />
            <Stop offset="1" stopColor={H.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={HEADER_H} fill="url(#historyHeader)" />
      </Svg>
      <HeaderPattern w={SW} h={HEADER_H} />

      <View style={headerStyles.content}>
        <Text style={headerStyles.eyebrow}>Mohideen Masjid</Text>
        <Text style={headerStyles.title}>{title}</Text>
      </View>
    </View>
  );
});

const headerStyles = StyleSheet.create({
  wrap: {
    height: HEADER_H,
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
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────
const HistoryScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [data, setData] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const isFocused = useIsFocused();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const shouldReconnectRef = useRef(true);
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const fetchPayments = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem("cache_chanda_history");
      if (raw) setData(JSON.parse(raw));
    } catch {}

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await authApiFetch("/user/payments", { signal: ctrl.signal });
      clearTimeout(timer);
      const json = await res.json();
      setData(json);
      await AsyncStorage.setItem("cache_chanda_history", JSON.stringify(json));
    } catch {}
    setRefreshing(false);
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = isFocused;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        fetchPayments();
      }, 500);
    };

    const connectWebSocket = async () => {
      if (!shouldReconnectRef.current) return;
      if (
        wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING
      ) return;

      const wsUrl = await getWsUrl("/ws/finance");
      wsRef.current = new WebSocket(wsUrl);
      wsRef.current.onmessage = scheduleRefresh;
      wsRef.current.onclose = () => {
        if (shouldReconnectRef.current) {
          reconnectRef.current = setTimeout(connectWebSocket, 2000);
        }
      };
      wsRef.current.onerror = () => {
        wsRef.current?.close();
      };
    };

    if (isFocused) {
      fetchPayments();
      connectWebSocket();
    } else {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    }

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [isFocused, fetchPayments]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPayments();
  }, [fetchPayments]);

  const getStatusStyle = (status) => {
    if (status === "verified") {
      return {
        backgroundColor: "rgba(14,107,69,0.08)",
        color: H.green,
      };
    }
    return {
      backgroundColor: H.amberBg,
      color: H.amber,
    };
  };

  const lastPressRef = useRef(0);

  const handlePress = (item) => {
    const now = Date.now();
    if (now - lastPressRef.current < 800) return;
    lastPressRef.current = now;

    navigation.replace("Receipt", {
      payment: {
        ...item,
        purpose: item.purpose || item.note || t("history.donation"),
      },
    });
  };

  const renderItem = ({ item }) => {
    const statusStyle = getStatusStyle(item.status);
    const statusLabel = item.status === "verified" ? t("history.verified") : t("history.pending");

    return (
      <AnimatedPressable onPress={() => handlePress(item)} activeOpacity={0.7}>
        <View style={styles.card}>
          <View style={styles.cardLeft}>
            <View style={styles.cardTopRow}>
              <Text style={styles.amount}>₹{Number(item.amount).toLocaleString("en-IN")}</Text>
              <View style={[styles.statusBadge, { backgroundColor: statusStyle.backgroundColor }]}>
                <Text style={[styles.statusText, { color: statusStyle.color }]}>
                  {statusLabel}
                </Text>
              </View>
            </View>
            <Text style={styles.purpose} numberOfLines={1}>
              {item.purpose || item.note || t("history.donation")}
            </Text>
            <Text style={styles.meta}>
              {item.receipt_id || t("history.noReceipt")}
              {item.transaction_ref ? ` (${item.transaction_ref})` : ""}
              {" • "}{(item.method || "UPI").toUpperCase()}
              {" • "}{item.created_by}
            </Text>
            <Text style={styles.timeline}>
              {t("history.paidAt")}: {formatServerDateTime(item.created_at)}
            </Text>
            {item.verified_at && (
              <Text style={styles.timeline}>
                {t("history.verifiedAt")}: {formatServerDateTime(item.verified_at)}
              </Text>
            )}
            {item.covered_months?.length > 0 && (
              <Text style={styles.timeline}>
                {t("history.covers")}: {formatCoveredMonths(item.covered_months)}
              </Text>
            )}
            {item.collected_by && (
              <Text style={styles.timeline}>
                {t("history.recordedBy")}: {item.collected_by}
              </Text>
            )}
          </View>
        </View>
      </AnimatedPressable>
    );
  };

  if (data.length === 0) {
    return (
      <View style={styles.container}>
        <PremiumHeader title={t("history.title")} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t("history.noTransactions")}</Text>
        </View>
        <BottomNav navigation={navigation} currentRoute="History" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PremiumHeader title={t("history.title")} />

      <Animated.View
        style={[
          styles.listWrap,
          { opacity: fadeAnim, transform: [{ translateY }] },
        ]}
      >
        <FlatList
          data={data}
          keyExtractor={(item) =>
            `${item.created_by || "user"}-${item.collection_id || 0}-${item.id}`
          }
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.gold}
              colors={[C.gold]}
              progressBackgroundColor="#fff"
            />
          }
        />
      </Animated.View>

      <BottomNav navigation={navigation} currentRoute="History" />
    </View>
  );
};

export default HistoryScreen;

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: H.bg,
  },
  listWrap: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: BOTTOM_NAV_H + 20,
  },
  card: {
    backgroundColor: H.card,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: H.cardBorder,  // gold tint
    padding: 14,
    marginBottom: 10,
    // No shadow/elevation – removes black shadow completely
  },
  cardLeft: {
    flex: 1,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  amount: {
    fontSize: 18,
    fontWeight: "800",
    color: H.textDark,
  },
  purpose: {
    fontSize: 14,
    fontWeight: "600",
    color: H.textDark,
    marginBottom: 4,
  },
  meta: {
    fontSize: 11,
    color: H.textMuted,
    marginBottom: 2,
  },
  timeline: {
    fontSize: 11,
    color: H.textMuted,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    fontWeight: "600",
    color: H.textMuted,
  },
});