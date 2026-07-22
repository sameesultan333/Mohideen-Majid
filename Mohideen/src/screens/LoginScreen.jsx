import React, { useState, useRef, useEffect, useCallback, memo } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Easing,
  Modal,
} from "react-native";
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop, G } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveToken, saveRefreshToken } from "../utils/secureStorage";
import { apiAxios } from "../config/server";
import { PasswordInput } from "../components/AuthComponents";
import { COLORS as C, RADII, SPACING, FONTS } from "../config/theme";

const { width } = Dimensions.get("window");

const normalizePhone = (value) => {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length >= 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length > 10 ? digits.slice(0, 10) : digits;
};

const MosqueMark = memo(({ size = 100 }) => (
  <Svg width={size} height={size * 0.85} viewBox="0 0 200 170">
    <Defs>
      <LinearGradient id="lgLogin1" x1="0" y1="0" x2="0" y2="1">
        <Stop offset={0} stopColor={C.goldLight} />
        <Stop offset={1} stopColor={C.gold} />
      </LinearGradient>
      <LinearGradient id="lgLogin2" x1="0" y1="0" x2="0" y2="1">
        <Stop offset={0} stopColor={C.goldLight} />
        <Stop offset={1} stopColor={C.goldDeep} />
      </LinearGradient>
    </Defs>
    <Rect x="10" y="80" width="18" height="70" rx="2" fill="url(#lgLogin1)" />
    <Rect x="6" y="75" width="26" height="8" rx="3" fill={C.goldLight} />
    <Path d="M14 75 Q19 58 24 75 Z" fill="url(#lgLogin2)" />
    <Rect x="172" y="80" width="18" height="70" rx="2" fill="url(#lgLogin1)" />
    <Rect x="168" y="75" width="26" height="8" rx="3" fill={C.goldLight} />
    <Path d="M176 75 Q181 58 186 75 Z" fill="url(#lgLogin2)" />
    <Rect x="30" y="105" width="140" height="65" rx="3" fill="url(#lgLogin1)" />
    {[55, 91, 127].map((x, i) => (
      <G key={i}>
        <Path d={`M${x} 148 L${x} 135 A9 9 0 0 1 ${x + 18} 135 L${x + 18} 148 Z`} fill={C.bg} />
      </G>
    ))}
    <Path d="M83 170 L83 130 A17 17 0 0 1 117 130 L117 170 Z" fill={C.bg} />
    <Path d="M30 105 A20 22 0 0 1 70 105 Z" fill="url(#lgLogin2)" />
    <Path d="M130 105 A20 22 0 0 1 170 105 Z" fill="url(#lgLogin2)" />
    <Path d="M55 105 A45 50 0 0 1 145 105 Z" fill="url(#lgLogin2)" />
    <Rect x="94" y="56" width="12" height="12" rx="2" fill={C.goldLight} />
    <Path d="M100 42 L101.5 47 L100 46 L98.5 47 Z" fill={C.goldLight} />
    <Rect x="30" y="102" width="140" height="4" rx="1" fill={C.goldLight} />
  </Svg>
));

const RingBg = memo(({ size = 168 }) => {
  const count = 22;
  const cx = size / 2;
  const r = size / 2 - 3;
  const innerR = r - 9;
  const dashes = Array.from({ length: count }).map((_, i) => {
    const angle = (i / count) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cx + r * Math.sin(angle);
    const x2 = cx + innerR * Math.cos(angle);
    const y2 = cx + innerR * Math.sin(angle);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  });
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Circle cx={cx} cy={cx} r={r - 1} stroke={C.goldLight} strokeWidth="0.8" fill="none" strokeDasharray="4 6" opacity={0.75} />
      <Circle cx={cx} cy={cx} r={innerR - 6} stroke={C.goldLight} strokeWidth="0.5" fill="none" opacity={0.4} />
      {dashes.map((d, i) => (
        <Path key={i} d={d} stroke={C.goldLight} strokeWidth="1" opacity={0.6} />
      ))}
    </Svg>
  );
});

export default function LoginScreen({ navigation, route }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(route?.params?.sessionExpired ? "Session expired, please sign in again." : "");
  const [forgotVisible, setForgotVisible] = useState(false);

  // Clear the param once shown so backgrounding/resuming the app (or a later,
  // deliberate logout that also lands on this screen) never re-shows a stale
  // "session expired" message.
  useEffect(() => {
    if (route?.params?.sessionExpired) navigation.setParams({ sessionExpired: undefined });
  }, []);

  const bgOpacity    = useRef(new Animated.Value(0)).current;
  const ringScale    = useRef(new Animated.Value(0.7)).current;
  const ringOpacity  = useRef(new Animated.Value(0)).current;
  const markY        = useRef(new Animated.Value(24)).current;
  const markOpacity  = useRef(new Animated.Value(0)).current;
  const brandOpacity = useRef(new Animated.Value(0)).current;
  const brandY       = useRef(new Animated.Value(14)).current;
  const cardAnim     = useRef(new Animated.Value(0)).current;
  const shakeX       = useRef(new Animated.Value(0)).current;
  const ringRotate   = useRef(new Animated.Value(0)).current;
  const glowPulse    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(bgOpacity, { toValue: 1, duration: 450, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.delay(150),
      Animated.parallel([
        Animated.timing(ringScale,   { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(markY,       { toValue: 0, duration: 700, easing: Easing.out(Easing.exp),   useNativeDriver: true }),
        Animated.timing(markOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    ]).start();
    Animated.sequence([
      Animated.delay(650),
      Animated.parallel([
        Animated.timing(brandOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(brandY,       { toValue: 0, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]).start();
    Animated.sequence([
      Animated.delay(500),
      Animated.timing(cardAnim, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    Animated.loop(
      Animated.timing(ringRotate, { toValue: 1, duration: 22000, easing: Easing.linear, useNativeDriver: true })
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 6,  duration: 70, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0,  duration: 70, useNativeDriver: true }),
    ]).start();
  }, [shakeX]);

  const showError = useCallback((msg) => { setError(msg); shake(); }, [shake]);

  const handleLogin = async () => {
    if (!phone || phone.length < 10) return showError("Enter a valid 10-digit phone number.");
    if (!password) return showError("Enter your password.");
    setLoading(true);
    setError("");
    try {
      const { data } = await apiAxios({
        method: "post",
        url: "/auth/login",
        data: { phone: normalizePhone(phone), password },
      });
      await saveToken(data.access_token);
      if (data.refresh_token) await saveRefreshToken(data.refresh_token);
      if (data.user) await AsyncStorage.setItem("user", JSON.stringify(data.user));
      const dest = data.user?.status === "PENDING_APPROVAL" ? "PendingApproval" : "Home";
      navigation.reset({ index: 0, routes: [{ name: dest }] });
    } catch (e) {
      const msg =
        e.response?.data?.detail ||
        e.response?.data?.message ||
        (e.request ? "Cannot reach server. Check your connection." : "Login failed.");
      showError(msg);
      setLoading(false);
    }
  };

  const handleForgotPassword = () => setForgotVisible(true);

  const cardScale   = cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });
  const cardY       = cardAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const ringSpin    = ringRotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const glowScale   = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const glowOpacity = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.6] });
  const canSubmit   = phone.length >= 10 && password.length >= 1;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} translucent={false} />
      <Animated.View style={[s.topGlow, { opacity: bgOpacity }]} pointerEvents="none" />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Animated mosque header */}
          <View style={s.header}>
            <View style={s.markWrap}>
              <Animated.View style={[s.breathGlow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: ringOpacity, transform: [{ scale: ringScale }, { rotate: ringSpin }] }]}>
                <RingBg size={168} />
              </Animated.View>
              <Animated.View style={{ opacity: markOpacity, transform: [{ translateY: markY }] }}>
                <MosqueMark size={96} />
              </Animated.View>
            </View>
            <Animated.View style={{ opacity: brandOpacity, transform: [{ translateY: brandY }], alignItems: "center" }}>
              <Text allowFontScaling={false} style={s.brand}>Mohideen Masjid</Text>
              <View style={s.taglineRow}>
                <View style={s.taglineLine} />
                <Text allowFontScaling={false} style={s.tagline}>MEMBER PORTAL</Text>
                <View style={s.taglineLine} />
              </View>
            </Animated.View>
          </View>

          {/* White card */}
          <Animated.View style={[s.card, { opacity: cardAnim, transform: [{ scale: cardScale }, { translateY: cardY }] }]}>
            <View style={s.cardAccent} />

            <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
              <View style={s.headRow}>
                <View style={s.headAccent} />
                <View>
                  <Text allowFontScaling={false} style={s.title}>Welcome Back</Text>
                  <Text allowFontScaling={false} style={s.subtitle}>Sign in to your account</Text>
                </View>
              </View>

              {!!error && (
                <View style={s.errBox}>
                  <View style={s.errBar} />
                  <Text allowFontScaling={false} style={s.errTxt}>{error}</Text>
                </View>
              )}

              <View style={s.fieldWrap}>
                <Text allowFontScaling={false} style={s.fieldLabel}>Phone Number</Text>
                <TextInput
                  value={phone}
                  onChangeText={(t) => { setPhone(t.replace(/\D/g, "")); setError(""); }}
                  keyboardType="phone-pad"
                  allowFontScaling={false}
                  placeholder="10-digit number"
                  placeholderTextColor={C.textMuted}
                  style={[s.fieldInput, !!error && s.fieldInputError]}
                  maxLength={15}
                />
                <Text allowFontScaling={false} style={s.fieldHelper}>Digits only — country code optional</Text>
              </View>

              <PasswordInput
                label="Password"
                value={password}
                onChangeText={(t) => { setPassword(t); setError(""); }}
              />

              <TouchableOpacity onPress={handleForgotPassword} style={s.forgotRow}>
                <Text allowFontScaling={false} style={s.forgotTxt}>Forgot Password?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.goldBtn, (!canSubmit || loading) && s.goldBtnDisabled]}
                onPress={handleLogin}
                disabled={!canSubmit || loading}
                activeOpacity={0.85}
              >
                <Text allowFontScaling={false} style={s.goldBtnTxt}>{loading ? "SIGNING IN…" : "SIGN IN"}</Text>
              </TouchableOpacity>

              <View style={s.dividerRow}>
                <View style={s.dividerLine} />
                <Text allowFontScaling={false} style={s.dividerLabel}>NEW MEMBER</Text>
                <View style={s.dividerLine} />
              </View>

              <TouchableOpacity style={s.outlineBtn} onPress={() => navigation.navigate("Register")} activeOpacity={0.85}>
                <Text allowFontScaling={false} style={s.outlineBtnTxt}>CREATE ACCOUNT</Text>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          <Text allowFontScaling={false} style={s.footer}>Secured with end-to-end encryption</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Forgot Password modal */}
      <Modal
        visible={forgotVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setForgotVisible(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <View style={s.modalAccent} />
            <Text allowFontScaling={false} style={s.modalTitle}>Forgot Password</Text>
            <View style={s.modalDivider} />
            <Text allowFontScaling={false} style={s.modalBody}>
              Please contact your mosque administrator to reset your password.
            </Text>
            <TouchableOpacity
              style={s.modalBtn}
              onPress={() => setForgotVisible(false)}
              activeOpacity={0.85}
            >
              <Text allowFontScaling={false} style={s.modalBtnTxt}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topGlow: {
    position: "absolute",
    top: -140,
    left: width / 2 - 180,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: C.bgVivid,
    opacity: 0.5,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: Platform.OS === "android" ? 40 : 56,
    paddingBottom: 40,
    alignItems: "center",
  },
  header: { alignItems: "center", marginBottom: SPACING.xxl },
  markWrap: { width: 168, height: 168, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  breathGlow: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: C.glow },
  brand: { marginTop: 2, fontSize: 26, fontFamily: FONTS.display, fontWeight: "700", color: C.white, letterSpacing: 1 },
  taglineRow: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 10 },
  taglineLine: { width: 26, height: 1, backgroundColor: C.goldLight },
  tagline: { fontSize: 11, color: C.goldLight, letterSpacing: 3.5, fontWeight: "700" },

  card: {
    width: "100%",
    backgroundColor: C.white,
    borderRadius: RADII.xl,
    paddingHorizontal: 24,
    paddingBottom: 28,
    paddingTop: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 12,
    overflow: "hidden",
  },
  cardAccent: { height: 4, marginBottom: SPACING.xl, backgroundColor: C.gold, marginHorizontal: -24 },

  headRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: SPACING.xl - 4, gap: 12 },
  headAccent: { width: 3, height: 44, borderRadius: 2, backgroundColor: C.gold, marginTop: 2 },
  title: { fontSize: 23, fontFamily: FONTS.display, fontWeight: "700", color: C.textDark, letterSpacing: 0.2 },
  subtitle: { fontSize: 12, color: C.textMuted, marginTop: 3, letterSpacing: 0.3 },

  errBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.errorBg,
    borderRadius: RADII.sm,
    padding: 12,
    marginBottom: SPACING.lg - 2,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(181,67,46,0.25)",
  },
  errBar: { width: 3, height: "100%", minHeight: 16, borderRadius: 2, backgroundColor: C.error },
  errTxt: { flex: 1, color: C.error, fontSize: 13, fontWeight: "500", lineHeight: 18 },

  fieldWrap: { marginBottom: SPACING.lg },
  fieldLabel: { fontSize: 11, color: C.textMuted, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 },
  fieldInput: {
    height: 50,
    borderWidth: 1.5,
    borderColor: "rgba(21,34,25,0.15)",
    borderRadius: RADII.sm,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "600",
    color: C.textDark,
    backgroundColor: C.ivory,
  },
  fieldInputError: { borderColor: C.error },
  fieldHelper: { fontSize: 10, color: C.textMuted, marginTop: 6 },

  forgotRow: { alignSelf: "flex-end", marginTop: -10, marginBottom: SPACING.lg },
  forgotTxt: { fontSize: 12, color: C.bgVivid, fontWeight: "700", letterSpacing: 0.2 },

  goldBtn: {
    height: 52,
    borderRadius: RADII.sm,
    backgroundColor: C.gold,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.lg,
    shadowColor: C.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  goldBtnDisabled: { opacity: 0.4 },
  goldBtnTxt: { fontSize: 13, fontWeight: "800", letterSpacing: 1.4, color: C.bg },

  outlineBtn: {
    height: 52,
    borderRadius: RADII.sm,
    borderWidth: 2,
    borderColor: C.bgVivid,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineBtnTxt: { fontSize: 13, fontWeight: "800", letterSpacing: 1.4, color: C.bgVivid },

  dividerRow: { flexDirection: "row", alignItems: "center", marginBottom: SPACING.lg, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(21,34,25,0.12)" },
  dividerLabel: { fontSize: 10, color: C.textMuted, letterSpacing: 1.5, fontWeight: "700" },

  footer: { marginTop: 20, fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.2, textAlign: "center" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(5,29,18,0.72)",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 40,
    paddingHorizontal: SPACING.lg,
  },
  modalCard: {
    width: "100%",
    backgroundColor: C.white,
    borderRadius: RADII.xl,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  modalAccent: { height: 4, backgroundColor: C.gold },
  modalTitle: {
    fontSize: 18,
    fontFamily: FONTS.display,
    fontWeight: "700",
    color: C.textDark,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
  },
  modalDivider: { height: 1, backgroundColor: "rgba(21,34,25,0.08)", marginHorizontal: 24 },
  modalBody: {
    fontSize: 14,
    color: C.textMuted,
    lineHeight: 22,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  modalBtn: {
    marginHorizontal: 24,
    marginBottom: 20,
    height: 48,
    borderRadius: RADII.sm,
    backgroundColor: C.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnTxt: { fontSize: 13, fontWeight: "800", letterSpacing: 1.4, color: C.bg },
});
