import React, { useState, useRef, useEffect, useCallback, memo } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, Animated, Dimensions, KeyboardAvoidingView, Platform, StatusBar, Easing } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop, G } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveToken, saveRefreshToken } from "../utils/secureStorage";
import { apiAxios } from "../config/server";
import { PasswordInput } from "../components/AuthComponents";
import { COLORS as C, RADII, SPACING, FONTS } from "../config/theme";

const { width, height } = Dimensions.get("window");

const cleanPhone = (p) => {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length >= 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.length > 10 ? d.slice(0, 10) : d;
};

// ── Mosque motif ──────────────────────────────────────────────────────────────

const MosqueMark = memo(({ size = 64 }) => (
  <Svg width={size} height={size * 0.85} viewBox="0 0 200 170">
    <Defs>
      <LinearGradient id="lgReg1" x1="0" y1="0" x2="0" y2="1">
        <Stop offset={0} stopColor={C.goldLight} />
        <Stop offset={1} stopColor={C.gold} />
      </LinearGradient>
      <LinearGradient id="lgReg2" x1="0" y1="0" x2="0" y2="1">
        <Stop offset={0} stopColor={C.goldLight} />
        <Stop offset={1} stopColor={C.goldDeep} />
      </LinearGradient>
    </Defs>
    <Rect x="10" y="80" width="18" height="70" rx="2" fill="url(#lgReg1)" />
    <Rect x="6" y="75" width="26" height="8" rx="3" fill={C.goldLight} />
    <Path d="M14 75 Q19 58 24 75 Z" fill="url(#lgReg2)" />
    <Rect x="172" y="80" width="18" height="70" rx="2" fill="url(#lgReg1)" />
    <Rect x="168" y="75" width="26" height="8" rx="3" fill={C.goldLight} />
    <Path d="M176 75 Q181 58 186 75 Z" fill="url(#lgReg2)" />
    <Rect x="30" y="105" width="140" height="65" rx="3" fill="url(#lgReg1)" />
    {[55, 91, 127].map((x, i) => (
      <G key={i}>
        <Path d={`M${x} 148 L${x} 135 A9 9 0 0 1 ${x + 18} 135 L${x + 18} 148 Z`} fill={C.bg} />
      </G>
    ))}
    <Path d="M83 170 L83 130 A17 17 0 0 1 117 130 L117 170 Z" fill={C.bg} />
    <Path d="M30 105 A20 22 0 0 1 70 105 Z" fill="url(#lgReg2)" />
    <Path d="M130 105 A20 22 0 0 1 170 105 Z" fill="url(#lgReg2)" />
    <Path d="M55 105 A45 50 0 0 1 145 105 Z" fill="url(#lgReg2)" />
    <Rect x="94" y="56" width="12" height="12" rx="2" fill={C.goldLight} />
    <Path d="M100 42 L101.5 47 L100 46 L98.5 47 Z" fill={C.goldLight} />
    <Rect x="30" y="102" width="140" height="4" rx="1" fill={C.goldLight} />
  </Svg>
));

// ── HEAD / MEMBER toggle ──────────────────────────────────────────────────────

const TypeToggle = ({ value, onChange, disabled }) => {
  const options = ["HEAD", "MEMBER"];
  const sliderW = (width - SPACING.lg * 2 - 48) / 2;
  const translateX = useRef(new Animated.Value(value === "HEAD" ? 4 : sliderW)).current;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: value === "HEAD" ? 4 : sliderW,
      friction: 8, tension: 40, useNativeDriver: true,
    }).start();
  }, [value]);

  return (
    <View style={toggleS.container}>
      <Animated.View style={[toggleS.slider, { transform: [{ translateX }] }]} />
      {options.map((option) => (
        <AnimatedPressable
          key={option}
          style={toggleS.option}
          onPress={() => !disabled && onChange(option)}
          activeOpacity={0.8}
          disabled={disabled}
          android_ripple={{ color: "transparent" }}
        >
          <Text allowFontScaling={false} style={[toggleS.text, value === option && toggleS.textActive]}>
            {option}
          </Text>
        </AnimatedPressable>
      ))}
    </View>
  );
};

const toggleS = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: C.ivory,
    borderRadius: 25,
    padding: 4,
    position: "relative",
    marginBottom: SPACING.md,
    height: 44,
  },
  slider: {
    position: "absolute",
    width: "48%",
    height: 36,
    backgroundColor: C.gold,
    borderRadius: 18,
    top: 4,
  },
  option: { flex: 1, alignItems: "center", justifyContent: "center", zIndex: 1 },
  text: { fontSize: 12, fontWeight: "700", color: C.textMuted },
  textActive: { color: C.bg },
});

// ── Welcome overlay ───────────────────────────────────────────────────────────

const WelcomeOverlay = ({ name, visible }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, overlayS.root, { opacity }]}>
      <Animated.View style={[overlayS.card, { transform: [{ scale }] }]}>
        <MosqueMark size={56} />
        <Text allowFontScaling={false} style={overlayS.title}>Welcome!</Text>
        {!!name && <Text allowFontScaling={false} style={overlayS.name}>{name}</Text>}
        <Text allowFontScaling={false} style={overlayS.sub}>Your account has been created</Text>
        <ActivityIndicator color={C.gold} size="small" style={{ marginTop: 14 }} />
      </Animated.View>
    </Animated.View>
  );
};

const overlayS = StyleSheet.create({
  root: {
    backgroundColor: "rgba(11,36,26,0.88)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  card: {
    backgroundColor: C.white,
    borderRadius: RADII.xl,
    paddingVertical: 32,
    paddingHorizontal: 28,
    alignItems: "center",
    width: width * 0.78,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 16,
  },
  title: { fontSize: 22, fontWeight: "800", color: C.textDark, letterSpacing: 0.5, marginTop: 12, marginBottom: 2 },
  name:  { fontSize: 15, fontWeight: "700", color: C.bgVivid, marginBottom: 4 },
  sub:   { fontSize: 12, color: C.textMuted, letterSpacing: 0.3 },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function RegisterScreen({ navigation }) {
  const [type, setType]               = useState("HEAD");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeName, setWelcomeName] = useState("");
  // phase: 'initial' → first attempt; 'extra' → new user, needs name+address
  const [phase, setPhase]             = useState("initial");

  const [form, setForm] = useState({
    name: "", phone: "", head_phone: "", password: "", confirm_password: "", address: "",
  });

  const cardAnim = useRef(new Animated.Value(0)).current;
  const shakeX   = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(cardAnim, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  // Reset form on type switch
  useEffect(() => {
    setForm({ name: "", phone: "", head_phone: "", password: "", confirm_password: "", address: "" });
    setError("");
    setPhase("initial");
  }, [type]);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 6,  duration: 70, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0,  duration: 70, useNativeDriver: true }),
    ]).start();
  }, [shakeX]);

  const showError = useCallback((msg) => { setError(msg); shake(); }, [shake]);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError("");
  };

  const validate = () => {
    if (type === "MEMBER" && !form.name.trim()) { showError("Please enter your name."); return false; }
    if (type === "HEAD" && phase === "extra" && !form.name.trim()) { showError("Please enter your full name."); return false; }
    if (cleanPhone(form.phone).length < 10) { showError("Enter a valid 10-digit phone number."); return false; }
    if (type === "MEMBER" && cleanPhone(form.head_phone).length < 10) {
      showError("Enter a valid family head phone number."); return false;
    }
    if (form.password.length < 8) { showError("Password must be at least 8 characters."); return false; }
    if (form.password !== form.confirm_password) { showError("Passwords do not match."); return false; }
    return true;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    setError("");
    try {
      const payload = {
        phone: cleanPhone(form.phone),
        password: form.password,
        confirm_password: form.confirm_password,
        ...(type === "MEMBER" && {
          name: form.name.trim(),
          head_phone: cleanPhone(form.head_phone),
        }),
        ...(type === "HEAD" && phase === "extra" && {
          name: form.name.trim(),
          address: form.address.trim() || undefined,
        }),
      };
      const { data } = await apiAxios({ method: "post", url: "/auth/register", data: payload });
      await saveToken(data.access_token);
      if (data.refresh_token) await saveRefreshToken(data.refresh_token);
      if (data.user) await AsyncStorage.setItem("user", JSON.stringify(data.user));
      if (data.pending_approval || data.user?.status === "PENDING_APPROVAL") {
        navigation.reset({ index: 0, routes: [{ name: "PendingApproval" }] });
        return;
      }
      setWelcomeName(data.user?.name || "");
      setShowWelcome(true);
      setTimeout(() => {
        navigation.reset({ index: 0, routes: [{ name: "Home" }] });
      }, 1400);
    } catch (e) {
      const msg =
        e.response?.data?.detail ||
        e.response?.data?.message ||
        (e.request ? "Cannot reach server. Check your connection." : "Registration failed.");
      if (type === "HEAD" && phase === "initial" && msg === "Full name is required for new registration.") {
        setPhase("extra");
        setError("");
        return;
      }
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  const cardY = cardAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  return (
    <View style={s.root}>

      {/* Compact header */}
      <Animated.View style={[s.header, { opacity: fadeAnim }]}>
        <MosqueMark size={56} />
        <View style={s.brandRow}>
          <Text allowFontScaling={false} style={s.brand}>Mohideen Masjid</Text>
          <View style={s.taglineRow}>
            <View style={s.taglineLine} />
            <Text allowFontScaling={false} style={s.tagline}>MEMBER REGISTRATION</Text>
            <View style={s.taglineLine} />
          </View>
        </View>
      </Animated.View>

      {/* Card fills remaining space */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={s.kav}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <Animated.View style={[s.card, { opacity: cardAnim, transform: [{ translateY: cardY }] }]}>
          <View style={s.cardAccent} />

          <Animated.View style={[s.cardInner, { transform: [{ translateX: shakeX }] }]}>
            <View style={s.headRow}>
              <View style={s.headAccent} />
              <View>
                <Text allowFontScaling={false} style={s.title}>Create Account</Text>
                <Text allowFontScaling={false} style={s.subtitle}>Register as a family head or member</Text>
              </View>
            </View>

            {!!error && (
              <View style={s.errBox}>
                <View style={s.errBar} />
                <Text allowFontScaling={false} style={s.errTxt}>{error}</Text>
              </View>
            )}

            <TypeToggle value={type} onChange={setType} disabled={loading} />

            {type === "HEAD" && phase === "extra" && (
              <View style={s.newUserBanner}>
                <View style={s.newUserBar} />
                <Text allowFontScaling={false} style={s.newUserTxt}>
                  Your number is not in our records. Please provide your name and address — we'll send your registration for admin approval.
                </Text>
              </View>
            )}

            {(type === "MEMBER" || (type === "HEAD" && phase === "extra")) && (
              <View style={s.fieldWrap}>
                <Text allowFontScaling={false} style={s.fieldLabel}>Full Name</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(t) => updateForm("name", t)}
                  allowFontScaling={false}
                  placeholder="Enter your full name"
                  placeholderTextColor={C.textMuted}
                  style={s.fieldInput}
                />
              </View>
            )}

            {type === "HEAD" && phase === "extra" && (
              <View style={s.fieldWrap}>
                <Text allowFontScaling={false} style={s.fieldLabel}>Address (optional)</Text>
                <TextInput
                  value={form.address}
                  onChangeText={(t) => updateForm("address", t)}
                  allowFontScaling={false}
                  placeholder="Your home address"
                  placeholderTextColor={C.textMuted}
                  style={s.fieldInput}
                />
              </View>
            )}

            <View style={s.fieldWrap}>
              <Text allowFontScaling={false} style={s.fieldLabel}>Phone Number</Text>
              <TextInput
                value={form.phone}
                onChangeText={(t) => updateForm("phone", t.replace(/\D/g, ""))}
                keyboardType="phone-pad"
                allowFontScaling={false}
                placeholder="10-digit number"
                placeholderTextColor={C.textMuted}
                style={s.fieldInput}
                maxLength={15}
              />
            </View>

            {type === "MEMBER" && (
              <View style={s.fieldWrap}>
                <Text allowFontScaling={false} style={s.fieldLabel}>Family Head Phone</Text>
                <TextInput
                  value={form.head_phone}
                  onChangeText={(t) => updateForm("head_phone", t.replace(/\D/g, ""))}
                  keyboardType="phone-pad"
                  allowFontScaling={false}
                  placeholder="Head's phone number"
                  placeholderTextColor={C.textMuted}
                  style={s.fieldInput}
                  maxLength={15}
                />
              </View>
            )}

            <PasswordInput
              label="Password"
              value={form.password}
              onChangeText={(t) => updateForm("password", t)}
              helper="Minimum 8 characters"
            />
            <PasswordInput
              label="Confirm Password"
              value={form.confirm_password}
              onChangeText={(t) => updateForm("confirm_password", t)}
            />

            <AnimatedPressable
              style={[s.goldBtn, loading && s.goldBtnDisabled]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color={C.bg} size="small" />
                : <Text allowFontScaling={false} style={s.goldBtnTxt}>
                    {type === "HEAD" && phase === "extra" ? "SUBMIT FOR APPROVAL" : "CREATE ACCOUNT"}
                  </Text>
              }
            </AnimatedPressable>

            <View style={s.footerRow}>
              <Text allowFontScaling={false} style={s.footerText}>Already have an account? </Text>
              <AnimatedPressable onPress={() => navigation.goBack()} android_ripple={{ color: "transparent" }}>
                <Text allowFontScaling={false} style={s.footerLink}>Sign In</Text>
              </AnimatedPressable>
            </View>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>

      <WelcomeOverlay name={welcomeName} visible={showWelcome} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingTop: Platform.OS === "android" ? 20 : 28,
    paddingBottom: 12,
    gap: 14,
  },
  brandRow: { flex: 1 },
  brand: {
    fontSize: 20,
    fontFamily: FONTS.display,
    fontWeight: "700",
    color: C.white,
    letterSpacing: 0.5,
  },
  taglineRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 },
  taglineLine: { width: 18, height: 1, backgroundColor: C.goldLight },
  tagline: { fontSize: 9, color: C.goldLight, letterSpacing: 2.5, fontWeight: "700" },

  kav: { flex: 1 },

  card: {
    flex: 1,
    backgroundColor: C.white,
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  cardAccent: { height: 4, backgroundColor: C.gold },
  cardInner: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 16,
  },

  headRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: SPACING.md, gap: 10 },
  headAccent: { width: 3, height: 40, borderRadius: 2, backgroundColor: C.gold, marginTop: 2 },
  title: { fontSize: 21, fontFamily: FONTS.display, fontWeight: "700", color: C.textDark, letterSpacing: 0.2 },
  subtitle: { fontSize: 11, color: C.textMuted, marginTop: 2, letterSpacing: 0.3 },

  newUserBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FEF6E6",
    borderRadius: RADII.sm,
    padding: 10,
    marginBottom: SPACING.md,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(169,131,46,0.3)",
  },
  newUserBar: { width: 3, height: "100%", minHeight: 14, borderRadius: 2, backgroundColor: "#B08A2F" },
  newUserTxt: { flex: 1, color: "#7A5C10", fontSize: 12, fontWeight: "500", lineHeight: 17 },

  errBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.errorBg,
    borderRadius: RADII.sm,
    padding: 10,
    marginBottom: SPACING.md,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(181,67,46,0.25)",
  },
  errBar: { width: 3, height: "100%", minHeight: 14, borderRadius: 2, backgroundColor: C.error },
  errTxt: { flex: 1, color: C.error, fontSize: 13, fontWeight: "500", lineHeight: 18 },

  fieldWrap: { marginBottom: SPACING.md },
  fieldLabel: { fontSize: 11, color: C.textMuted, fontWeight: "700", letterSpacing: 0.5, marginBottom: 5 },
  fieldInput: {
    height: 46,
    borderWidth: 1.5,
    borderColor: "rgba(21,34,25,0.15)",
    borderRadius: RADII.sm,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "600",
    color: C.textDark,
    backgroundColor: C.ivory,
  },

  goldBtn: {
    height: 50,
    borderRadius: RADII.sm,
    backgroundColor: C.gold,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    marginBottom: SPACING.md,
    shadowColor: C.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  goldBtnDisabled: { opacity: 0.5 },
  goldBtnTxt: { fontSize: 13, fontWeight: "800", letterSpacing: 1.4, color: C.bg },

  footerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText: { fontSize: 13, color: C.textMuted },
  footerLink: { fontSize: 13, color: C.bgVivid, fontWeight: "800" },
});
