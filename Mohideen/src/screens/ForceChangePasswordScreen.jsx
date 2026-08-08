// screens/ForceChangePasswordScreen.jsx
// Shown when must_change_password=true (admin set a temporary password).
// User MUST change it before accessing any other screen.
import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, StatusBar, Platform, ActivityIndicator, SafeAreaView } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import { saveToken, saveRefreshToken, deleteToken, deleteRefreshToken } from "../utils/secureStorage";
import { authApiAxios } from "../config/server";
import { PasswordInput } from "../components/AuthComponents";
import { COLORS as C } from "../config/theme";

export default function ForceChangePasswordScreen({ navigation }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = useCallback(async () => {
    setError("");
    if (!current.trim()) { setError(t("forceChangePassword.errorCurrent")); return; }
    if (next.length < 8)  { setError(t("forceChangePassword.errorLength")); return; }
    if (next !== confirm) { setError(t("forceChangePassword.errorMatch")); return; }
    setLoading(true);
    try {
      const res = await authApiAxios({
        method: "post",
        url: "/auth/change-password",
        data: { current_password: current, new_password: next, confirm_new_password: confirm },
      });
      const { access_token, refresh_token } = res.data;
      if (access_token) await saveToken(access_token);
      if (refresh_token) await saveRefreshToken(refresh_token);
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    } catch (e) {
      const msg = e?.response?.data?.detail || t("common.error");
      setError(Array.isArray(msg) ? msg[0]?.msg ?? String(msg) : String(msg));
    } finally {
      setLoading(false);
    }
  }, [current, next, confirm, navigation, t]);

  const handleLogout = useCallback(async () => {
    try { await authApiAxios({ method: "post", url: "/auth/logout" }); } catch (_) {}
    await deleteToken();
    await deleteRefreshToken();
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        <View style={styles.iconWrap}>
          <Text style={styles.icon}>🔑</Text>
        </View>

        <Text style={styles.title}>{t("forceChangePassword.title")}</Text>
        <Text style={styles.subtitle}>{t("forceChangePassword.subtitle")}</Text>

        <View style={styles.card}>
          <Text style={styles.infoText}>{t("forceChangePassword.info")}</Text>
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTxt}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Text style={styles.label}>{t("forceChangePassword.current")}</Text>
          <PasswordInput
            value={current}
            onChangeText={setCurrent}
            placeholder={t("forceChangePassword.currentPlaceholder")}
          />

          <Text style={[styles.label, { marginTop: 16 }]}>{t("forceChangePassword.new")}</Text>
          <PasswordInput
            value={next}
            onChangeText={setNext}
            placeholder={t("forceChangePassword.newPlaceholder")}
          />

          <Text style={[styles.label, { marginTop: 16 }]}>{t("forceChangePassword.confirm")}</Text>
          <PasswordInput
            value={confirm}
            onChangeText={setConfirm}
            placeholder={t("forceChangePassword.confirmPlaceholder")}
          />
        </View>

        <AnimatedPressable
          style={[styles.submitBtn, loading && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#0D2B1A" />
          ) : (
            <Text style={styles.submitTxt}>{t("forceChangePassword.submit")}</Text>
          )}
        </AnimatedPressable>

        <AnimatedPressable style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutTxt}>{t("forceChangePassword.logout")}</Text>
        </AnimatedPressable>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#0D2B1A" },
  scroll:         { flex: 1 },
  scrollContent:  { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, paddingBottom: 48 },
  iconWrap:       { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.1)",
                    alignItems: "center", justifyContent: "center", marginBottom: 20 },
  icon:           { fontSize: 32 },
  title:          { fontSize: 22, fontWeight: "700", color: "#FFFFFF", textAlign: "center", marginBottom: 8 },
  subtitle:       { fontSize: 14, color: "rgba(255,255,255,0.65)", textAlign: "center", marginBottom: 20, lineHeight: 20 },
  card:           { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 16, width: "100%",
                    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", marginBottom: 20 },
  infoText:       { fontSize: 13, color: "rgba(255,255,255,0.8)", textAlign: "center", lineHeight: 19 },
  errorBox:       { backgroundColor: "rgba(220,38,38,0.18)", borderRadius: 10, padding: 12, width: "100%",
                    borderWidth: 1, borderColor: "rgba(220,38,38,0.4)", marginBottom: 16 },
  errorTxt:       { color: "#FCA5A5", fontSize: 13, textAlign: "center" },
  form:           { width: "100%", marginBottom: 24 },
  label:          { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.6)",
                    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  submitBtn:      { backgroundColor: "#C9A84C", borderRadius: 12, paddingVertical: 15, width: "100%",
                    alignItems: "center", marginBottom: 16 },
  submitDisabled: { opacity: 0.6 },
  submitTxt:      { color: "#0D2B1A", fontSize: 15, fontWeight: "800" },
  logoutBtn:      { paddingVertical: 10, paddingHorizontal: 24 },
  logoutTxt:      { color: "rgba(255,255,255,0.45)", fontSize: 13, fontWeight: "600", textAlign: "center" },
});
