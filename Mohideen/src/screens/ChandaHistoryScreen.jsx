import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApiFetch, getWsUrl } from "../config/server";
import { formatCoveredMonths, formatServerDateTime } from "../utils/datetime";

const HistoryScreen = ({ navigation }) => {
  const [data, setData] = useState([]);
  const isFocused = useIsFocused();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
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
      Animated.timing(translateY, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
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
      ) {
        return;
      }

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
  }, [isFocused]);

  const fetchPayments = async () => {
    // Cache-first: show cached data immediately, then refresh from network
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
  };

  const getStatusStyle = (status) => {
    if (status === "verified") {
      return {
        backgroundColor: "#E6F4EA",
        color: "#1C7C54",
      };
    }
    return {
      backgroundColor: "#FFF4E5",
      color: "#B26A00",
    };
  };

  const lastPressRef = useRef(0);

const handlePress = (item) => {
  const now = Date.now();

  // 🚨 Rate limit: 1 click per 800ms
  if (now - lastPressRef.current < 800) return;

  lastPressRef.current = now;

  navigation.replace("Receipt", {
    payment: {
      ...item,
      purpose: item.purpose || item.note || "Donation",
    },
  });
};

  const renderItem = ({ item }) => {
    const statusStyle = getStatusStyle(item.status);

    return (
      <TouchableOpacity onPress={() => handlePress(item)} activeOpacity={0.8}>
        <View style={styles.card}>
          <View style={styles.cardLeft}>
            <Text style={styles.amount}>Rs {item.amount}</Text>
            <Text style={styles.purpose}>{item.purpose || item.note || "Donation"}</Text>
            <Text style={styles.meta}>
              {item.receipt_id || "No Receipt"} {item.transaction_ref ? `(${item.transaction_ref})` : ""} - {(item.method || "UPI").toUpperCase()} - {item.created_by}
            </Text>
            <Text style={styles.timeline}>Paid: {formatServerDateTime(item.created_at)}</Text>
            {item.verified_at ? (
              <Text style={styles.timeline}>Verified: {formatServerDateTime(item.verified_at)}</Text>
            ) : null}
            {item.covered_months?.length ? (
              <Text style={styles.timeline}>Covers: {formatCoveredMonths(item.covered_months)}</Text>
            ) : null}
            {item.collected_by ? (
              <Text style={styles.timeline}>Recorded by: {item.collected_by}</Text>
            ) : null}
          </View>

          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusStyle.backgroundColor },
            ]}
          >
            <Text style={[styles.statusText, { color: statusStyle.color }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (data.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No transactions yet</Text>
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity: fadeAnim, transform: [{ translateY }] },
      ]}
    >
      <FlatList
        data={data}
        keyExtractor={(item) => `${item.created_by || "user"}-${item.collection_id || 0}-${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={false}
      />
    </Animated.View>
  );
};

export default HistoryScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F9F8",
  },
  card: {
    backgroundColor: "#FFFFFF",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "#E6ECE8",
    gap: 12,
  },
  cardLeft: {
    flex: 1,
  },
  amount: {
    fontSize: 18,
    fontWeight: "800",
    color: "#06281C",
  },
  purpose: {
    fontSize: 14,
    color: "#1C3B2C",
    marginTop: 2,
  },
  meta: {
    fontSize: 11,
    color: "#7A9C8B",
    marginTop: 4,
  },
  timeline: {
    fontSize: 11,
    color: "#4E6B5E",
    marginTop: 3,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: "#7A9C8B",
  },
});
