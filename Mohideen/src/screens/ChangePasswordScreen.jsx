import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";
import { saveToken, saveRefreshToken, deleteToken, deleteRefreshToken } from "../utils/secureStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApiAxios } from "../config/server";
import { PasswordInput } from "../components/AuthComponents";
import { COLORS as C, RADII, SPACING, FONTS } from "../config/theme";

const IOS = Platform.OS === "ios";

export default function ChangePasswordScreen({ navigation }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const showError = useCallback((msg) => setError(msg), []);

  const validate = () => {
    if (!current) { showError(t("changePassword.errorCurrent")); return false; }
    if (next.length < 8) { showError(t("changePassword.errorLength")); return false; }
    if (next !== confirm) { showError(t("changePassword.errorMatch")); return false; }
    if (next === current) { showError(t("changePassword.errorSame")); return false; }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await authApiAxios({
        method: "post",
        url: "/auth/change-password",
        data: { current_password: current, new_password: next, confirm_new_password: confirm },
      });
      if (data.access_token) await saveToken(data.access_token);
      if (data.refresh_token) await saveRefreshToken(data.refresh_token);
      setSuccess(true);
      Alert.alert(
        t("changePassword.successTitle"),
        t("changePassword.successMessage"),
        [{ text: t("changePassword.ok"), onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      const msg =
        e.response?.data?.detail ||
        e.response?.data?.message ||
        (e.request ? t("changePassword.errorNetwork") : t("changePassword.errorGeneric"));
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={[s.header, { paddingTop: IOS ? 52 : (StatusBar.currentHeight || 0) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <View style={s.backArrow} />
        </TouchableOpacity>
        <Text allowFontScaling={false} style={s.headerTitle}>{t("changePassword.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.card}>
          <View style={s.cardAccent} />

          <Text allowFontScaling={false} style={s.sectionTitle}>{t("changePassword.sectionTitle")}</Text>
          <Text allowFontScaling={false} style={s.sectionSub}>{t("changePassword.subtitle")}</Text>

          {!!error && (
            <View style={s.errBox}>
              <View style={s.errBar} />
              <Text allowFontScaling={false} style={s.errTxt}>{error}</Text>
            </View>
          )}

          <View style={s.fields}>
            <PasswordInput
              label={t("changePassword.currentLabel")}
              value={current}
              onChangeText={(v) => { setCurrent(v); setError(""); }}
            />
            <PasswordInput
              label={t("changePassword.newLabel")}
              value={next}
              onChangeText={(v) => { setNext(v); setError(""); }}
              helper={t("changePassword.newHelper")}
            />
            <PasswordInput
              label={t("changePassword.confirmLabel")}
              value={confirm}
              onChangeText={(v) => { setConfirm(v); setError(""); }}
            />
          </View>

          <TouchableOpacity
            style={[s.saveBtn, (loading || !current || !next || !confirm) && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={loading || !current || !next || !confirm}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={C.bg} size="small" />
            ) : (
              <Text allowFontScaling={false} style={s.saveBtnTxt}>{t("changePassword.save")}</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text allowFontScaling={false} style={s.hint}>
          {t("changePassword.hint")}
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingBottom: 16,
  },
  backBtn: { width: 40, height: 40, alignItems: "flex-start", justifyContent: "center" },
  backArrow: {
    width: 10,
    height: 10,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: C.goldLight,
    transform: [{ rotate: "45deg" }],
    marginLeft: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: C.white,
    letterSpacing: 0.3,
  },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: 40,
  },

  card: {
    backgroundColor: C.white,
    borderRadius: RADII.xl,
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 0,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 10,
  },
  cardAccent: { height: 4, marginBottom: 24, backgroundColor: C.gold, marginHorizontal: -24 },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: C.textDark,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 20,
    lineHeight: 18,
  },

  errBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.errorBg,
    borderRadius: RADII.sm,
    padding: 12,
    marginBottom: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(181,67,46,0.25)",
  },
  errBar: { width: 3, height: "100%", minHeight: 16, borderRadius: 2, backgroundColor: C.error },
  errTxt: { flex: 1, color: C.error, fontSize: 13, fontWeight: "500", lineHeight: 18 },

  fields: { marginBottom: 8 },

  saveBtn: {
    height: 52,
    borderRadius: RADII.sm,
    backgroundColor: C.gold,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginTop: 4,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnTxt: { fontSize: 13, fontWeight: "800", letterSpacing: 1.4, color: C.bg },

  hint: {
    marginTop: 20,
    fontSize: 11,
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
    letterSpacing: 0.3,
    lineHeight: 17,
  },
});
