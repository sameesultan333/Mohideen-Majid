import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";
import { authApiAxios } from "../config/server";
import { PasswordInput } from "../components/AuthComponents";
import { clearAuthSession } from "../utils/authSession";
import { COLORS as C, RADII, SPACING } from "../config/theme";

const IOS = Platform.OS === "ios";

export default function DeleteAccountScreen({ navigation }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const removedItems = t("deleteAccount.removedList", { returnObjects: true });
  const retainedItems = t("deleteAccount.retainedList", { returnObjects: true });

  const handleDelete = async () => {
    if (!password) {
      setError(t("deleteAccount.errorPassword"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      await authApiAxios({
        method: "post",
        url: "/auth/delete-account",
        data: { password, reason: reason.trim() || undefined },
      });
      await clearAuthSession();
      Alert.alert(
        t("deleteAccount.successTitle"),
        t("deleteAccount.successMessage"),
        [{ text: t("deleteAccount.ok"), onPress: () => navigation.replace("Login") }]
      );
    } catch (e) {
      const msg =
        e.response?.data?.detail ||
        e.response?.data?.message ||
        (e.request ? t("deleteAccount.errorNetwork") : t("deleteAccount.errorGeneric"));
      setError(msg);
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
        <Text allowFontScaling={false} style={s.headerTitle}>{t("deleteAccount.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.card}>
          <View style={s.cardAccent} />

          <Text allowFontScaling={false} style={s.sectionTitle}>{t("deleteAccount.sectionTitle")}</Text>
          <Text allowFontScaling={false} style={s.sectionSub}>{t("deleteAccount.intro")}</Text>

          <View style={s.listBlock}>
            <Text allowFontScaling={false} style={s.listTitle}>{t("deleteAccount.removedTitle")}</Text>
            {(Array.isArray(removedItems) ? removedItems : []).map((item, i) => (
              <Text allowFontScaling={false} key={i} style={s.listItem}>{"• "}{item}</Text>
            ))}
          </View>

          <View style={s.listBlock}>
            <Text allowFontScaling={false} style={s.listTitle}>{t("deleteAccount.retainedTitle")}</Text>
            {(Array.isArray(retainedItems) ? retainedItems : []).map((item, i) => (
              <Text allowFontScaling={false} key={i} style={s.listItem}>{"• "}{item}</Text>
            ))}
            <Text allowFontScaling={false} style={s.listNote}>{t("deleteAccount.retainedNote")}</Text>
          </View>

          {!!error && (
            <View style={s.errBox}>
              <View style={s.errBar} />
              <Text allowFontScaling={false} style={s.errTxt}>{error}</Text>
            </View>
          )}

          <View style={s.fields}>
            <Text allowFontScaling={false} style={s.fieldLabel}>{t("deleteAccount.reasonLabel")}</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder={t("deleteAccount.reasonPlaceholder")}
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={3}
              style={s.reasonInput}
              allowFontScaling={false}
            />

            <PasswordInput
              label={t("deleteAccount.passwordLabel")}
              value={password}
              onChangeText={(v) => { setPassword(v); setError(""); }}
              error={!!error}
            />
          </View>

          <TouchableOpacity
            style={s.cancelBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
            disabled={loading}
          >
            <Text allowFontScaling={false} style={s.cancelBtnTxt}>{t("deleteAccount.cancel")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.deleteBtn, (loading || !password) && s.deleteBtnDisabled]}
            onPress={handleDelete}
            disabled={loading || !password}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={C.white} size="small" />
            ) : (
              <Text allowFontScaling={false} style={s.deleteBtnTxt}>{t("deleteAccount.confirm")}</Text>
            )}
          </TouchableOpacity>
        </View>
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
  cardAccent: { height: 4, marginBottom: 24, backgroundColor: C.error, marginHorizontal: -24 },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: C.textDark,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 18,
    lineHeight: 18,
  },

  listBlock: { marginBottom: 16 },
  listTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: C.textDark,
    marginBottom: 6,
  },
  listItem: {
    fontSize: 12.5,
    color: C.textMuted,
    lineHeight: 19,
  },
  listNote: {
    fontSize: 11,
    color: C.textMuted,
    fontStyle: "italic",
    marginTop: 6,
    lineHeight: 16,
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
  fieldLabel: { fontSize: 11, color: C.textMuted, fontWeight: "700", letterSpacing: 0.5, marginBottom: 5 },
  reasonInput: {
    height: 78,
    borderWidth: 1.5,
    borderColor: "rgba(21,34,25,0.15)",
    borderRadius: RADII.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: C.ivory,
    fontSize: 14,
    color: C.textDark,
    textAlignVertical: "top",
    marginBottom: SPACING.md,
  },

  cancelBtn: {
    height: 48,
    borderRadius: RADII.sm,
    borderWidth: 1.5,
    borderColor: "rgba(21,34,25,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    marginBottom: 10,
  },
  cancelBtnTxt: { fontSize: 13, fontWeight: "700", color: C.textDark },

  deleteBtn: {
    height: 52,
    borderRadius: RADII.sm,
    backgroundColor: C.error,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.error,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  deleteBtnDisabled: { opacity: 0.4 },
  deleteBtnTxt: { fontSize: 13, fontWeight: "800", letterSpacing: 1.4, color: C.white },
});
