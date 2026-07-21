// screens/PendingApprovalScreen.jsx
import React, { useCallback, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, AppState,
} from "react-native";
import { useTranslation } from "react-i18next";
import messaging from "@react-native-firebase/messaging";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { deleteToken, deleteRefreshToken } from "../utils/secureStorage";
import { apiFetch, authApiFetch } from "../config/server";
import { colors } from "../config/theme";

const POLL_INTERVAL_MS = 20_000;

export default function PendingApprovalScreen({ navigation }) {
  const { t } = useTranslation();
  const pollRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  const goHome = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: "Home" }] });
  }, [navigation]);

  const goLogin = useCallback(async () => {
    await deleteToken();
    await deleteRefreshToken();
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }, [navigation]);

  const checkStatus = useCallback(async () => {
    try {
      const res = await authApiFetch("/auth/status");
      if (!res.ok) return;
      const data = await res.json();
      const live = data?.status;
      if (!live) return;

      if (live === "ACTIVE") {
        const raw = await AsyncStorage.getItem("user");
        if (raw) {
          const user = JSON.parse(raw);
          user.status = "ACTIVE";
          await AsyncStorage.setItem("user", JSON.stringify(user));
        }
        goHome();
      } else if (live === "REJECTED") {
        goLogin();
      }
    } catch (_) {}
  }, [goHome, goLogin]);

  // Poll backend every 20s
  useEffect(() => {
    checkStatus();
    pollRef.current = setInterval(checkStatus, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [checkStatus]);

  // Re-check when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === "active") {
        checkStatus();
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [checkStatus]);

  // Listen for FCM push
  useEffect(() => {
    const unsub = messaging().onMessage(async (msg) => {
      const msgType = msg.data?.type;
      if (msgType === "registration_approved") {
        const raw = await AsyncStorage.getItem("user");
        if (raw) {
          const user = JSON.parse(raw);
          user.status = "ACTIVE";
          await AsyncStorage.setItem("user", JSON.stringify(user));
        }
        goHome();
      } else if (msgType === "registration_rejected") {
        goLogin();
      }
    });
    return unsub;
  }, [goHome, goLogin]);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (_) {}
    await deleteToken();
    await deleteRefreshToken();
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.emerald.deep} />
      <View style={styles.container}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>🕌</Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>{t("pendingApproval.title")}</Text>

        {/* Message */}
        <View style={styles.card}>
          <Text style={styles.message}>{t("pendingApproval.message")}</Text>
        </View>

        {/* Status line */}
        <View style={styles.statusRow}>
          <View style={styles.dot} />
          <Text style={styles.statusText}>{t("pendingApproval.waiting")}</Text>
        </View>

        {/* Info */}
        <Text style={styles.info}>{t("pendingApproval.info")}</Text>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t("pendingApproval.logout")}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0D2B1A",
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  icon: {
    fontSize: 38,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 20,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 20,
    width: "100%",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  message: {
    fontSize: 15,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    lineHeight: 22,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F59E0B",
  },
  statusText: {
    fontSize: 13,
    color: "#F59E0B",
    fontWeight: "600",
  },
  info: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    marginBottom: 40,
    lineHeight: 18,
  },
  logoutBtn: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  logoutText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
});
