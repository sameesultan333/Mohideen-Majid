import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
} from "react-native";
import Svg, { Path, Line, Circle } from "react-native-svg";
import { COLORS as C, RADII, SPACING } from "../config/theme";

// SVG eye icons — avoids react-native-vector-icons font linking requirement
const EyeIcon = ({ size = 20, color = C.textMuted }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={1.8} />
  </Svg>
);

const EyeOffIcon = ({ size = 20, color = C.textMuted }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <Line x1="1" y1="1" x2="23" y2="23" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

const { width } = Dimensions.get("window");

// ─── GEOMETRIC STAR TILE ────────────────────────────────────────────────────
export const GeomStar = ({ size = 40, color = C.goldDim, opacity = 0.3 }) => {
  const s = size;
  const sq = s * 0.41;
  return (
    <View style={{ width: s, height: s, position: "relative", opacity }}>
      <View style={{ position: "absolute", top: s * 0.3, left: s * 0.09, width: s * 0.82, height: s * 0.4, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: "absolute", top: s * 0.09, left: s * 0.3, width: s * 0.4, height: s * 0.82, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: "absolute", top: s * 0.09, left: s * 0.09, width: sq, height: sq, backgroundColor: color, transform: [{ rotate: "45deg" }], borderRadius: 1 }} />
      <View style={{ position: "absolute", top: s * 0.09, right: s * 0.09, width: sq, height: sq, backgroundColor: color, transform: [{ rotate: "45deg" }], borderRadius: 1 }} />
      <View style={{ position: "absolute", bottom: s * 0.09, left: s * 0.09, width: sq, height: sq, backgroundColor: color, transform: [{ rotate: "45deg" }], borderRadius: 1 }} />
      <View style={{ position: "absolute", bottom: s * 0.09, right: s * 0.09, width: sq, height: sq, backgroundColor: color, transform: [{ rotate: "45deg" }], borderRadius: 1 }} />
    </View>
  );
};

// ─── BACKGROUND GEOMETRIC GRID ──────────────────────────────────────────────
export const GeometricBg = ({ opacity }) => {
  const cols = 5;
  const rows = 8;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => (
          <View
            key={`${r}-${c}`}
            style={{
              position: "absolute",
              top: r * 82 - 20,
              left: c * (width / cols) - 10,
              opacity: ((r + c) % 2 === 0) ? 0.9 : 0.4,
            }}
          >
            <GeomStar size={54} color={C.goldDim} />
          </View>
        ))
      )}
    </Animated.View>
  );
};

// ─── ANIMATED MASJID LOGO ───────────────────────────────────────────────────
export const MasjidLogo = () => {
  const buildAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(buildAnim, { toValue: 1, duration: 1400, delay: 300, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 2200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2200, useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 20000, useNativeDriver: true })
    ).start();
  }, []);

  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={logoStyles.root}>
      <Animated.View style={[logoStyles.outerRing, { transform: [{ rotate }] }]}>
        {Array.from({ length: 16 }).map((_, i) => (
          <View key={i} style={[logoStyles.ringDot, { transform: [{ rotate: `${i * 22.5}deg` }, { translateY: -46 }] }]} />
        ))}
      </Animated.View>
      <Animated.View style={[logoStyles.innerGlow, { transform: [{ scale: pulseAnim }] }]} />
      <Animated.View style={[logoStyles.minaretL, { opacity: buildAnim, transform: [{ scaleY: buildAnim }, { translateX: -28 }] }]}>
        <View style={logoStyles.minaretCap} />
        <View style={logoStyles.minaretShaft} />
        <View style={logoStyles.minaretBase} />
      </Animated.View>
      <Animated.View style={[logoStyles.minaretR, { opacity: buildAnim, transform: [{ scaleY: buildAnim }, { translateX: 28 }] }]}>
        <View style={logoStyles.minaretCap} />
        <View style={logoStyles.minaretShaft} />
        <View style={logoStyles.minaretBase} />
      </Animated.View>
      <Animated.View style={[logoStyles.dome, { opacity: buildAnim, transform: [{ scale: buildAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}>
        <View style={logoStyles.domeCurve} />
        <View style={logoStyles.domeSpire} />
        <View style={logoStyles.domeCrescent} />
      </Animated.View>
      <Animated.View style={[logoStyles.body, { opacity: buildAnim }]}>
        <View style={logoStyles.archCenter} />
      </Animated.View>
    </View>
  );
};

const logoStyles = StyleSheet.create({
  root: { width: 110, height: 120, alignItems: "center", justifyContent: "flex-end", position: "relative" },
  outerRing: { position: "absolute", width: 100, height: 100, top: 5, alignItems: "center", justifyContent: "center" },
  ringDot: { position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: C.gold, opacity: 0.5 },
  innerGlow: { position: "absolute", width: 70, height: 70, borderRadius: 35, backgroundColor: C.goldGlow, top: 20 },
  minaretL: { position: "absolute", alignItems: "center", bottom: 0, left: 14, transformOrigin: "bottom" },
  minaretR: { position: "absolute", alignItems: "center", bottom: 0, right: 14, transformOrigin: "bottom" },
  minaretCap: { width: 6, height: 10, borderRadius: 3, backgroundColor: C.gold, marginBottom: 1 },
  minaretShaft: { width: 8, height: 36, borderRadius: 4, backgroundColor: C.goldDim },
  minaretBase: { width: 12, height: 5, borderRadius: 2, backgroundColor: C.gold },
  dome: { position: "absolute", top: 16, alignItems: "center" },
  domeCurve: { width: 56, height: 32, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: C.gold },
  domeSpire: { position: "absolute", top: -14, width: 6, height: 18, borderRadius: 3, backgroundColor: C.goldBright },
  domeCrescent: { position: "absolute", top: -22, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: C.goldBright, backgroundColor: "transparent" },
  body: { width: 64, height: 22, backgroundColor: C.gold, borderRadius: 3, alignItems: "center", justifyContent: "flex-start", overflow: "hidden" },
  archCenter: { marginTop: -1, width: 20, height: 14, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: C.bg },
});

// ─── OTP INPUT ──────────────────────────────────────────────────────────────
export const OTPInput = ({ value, onChange, length = 6, disabled, error }) => {
  const refs = useRef([]);
  const [focused, setFocused] = useState(0);
  const scales = useRef(Array(length).fill(0).map(() => new Animated.Value(1))).current;
  const glows = useRef(Array(length).fill(0).map(() => new Animated.Value(0))).current;

  useEffect(() => { setTimeout(() => refs.current[0]?.focus(), 300); }, []);

  const pulse = (i) => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(scales[i], { toValue: 1.12, duration: 80, useNativeDriver: true }),
        Animated.timing(scales[i], { toValue: 1, duration: 120, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(glows[i], { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(glows[i], { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();
  };

  const handleChange = (text, i) => {
    const arr = value.split("");
    arr[i] = text;
    onChange(arr.join(""));
    if (text) {
      pulse(i);
      if (i < length - 1) { refs.current[i + 1]?.focus(); setFocused(i + 1); }
    }
  };

  const handleKey = (e, i) => {
    if (e.nativeEvent.key === "Backspace" && !value[i] && i > 0) {
      refs.current[i - 1]?.focus(); setFocused(i - 1);
    }
  };

  return (
    <View style={otpS.row}>
      {Array(length).fill(0).map((_, i) => {
        const filled = !!value[i];
        const isFoc = focused === i;
        return (
          <Animated.View key={i} style={{ transform: [{ scale: scales[i] }] }}>
            <Animated.View style={[otpS.glow, { opacity: glows[i].interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) }]} />
            <TextInput
              ref={r => refs.current[i] = r}
              style={[otpS.box, isFoc && otpS.boxFocused, filled && otpS.boxFilled, error && otpS.boxError]}
              maxLength={1}
              keyboardType="number-pad"
              value={value[i] || ""}
              onChangeText={t => handleChange(t, i)}
              onKeyPress={e => handleKey(e, i)}
              onFocus={() => setFocused(i)}
              editable={!disabled}
              caretHidden
              contextMenuHidden
              selectionColor={C.gold}
            />
          </Animated.View>
        );
      })}
    </View>
  );
};

const otpS = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", gap: 10, marginVertical: SPACING.xl },
  glow: { ...StyleSheet.absoluteFillObject, borderRadius: RADII.md, backgroundColor: C.goldGlow },
  box: { width: 46, height: 54, borderRadius: RADII.md, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surfaceRaise, textAlign: "center", fontSize: 22, fontWeight: "700", color: C.goldBright },
  boxFocused: { borderColor: C.gold, borderWidth: 2, backgroundColor: "#152D1E" },
  boxFilled: { borderColor: C.primaryLight },
  boxError: { borderColor: C.error, backgroundColor: C.errorBg },
});

// ─── FIELD INPUT ────────────────────────────────────────────────────────────
export const FieldInput = ({ label, value, onChangeText, secure = false, keyboard = "default", error, rightChild, helper }) => {
  const [foc, setFoc] = useState(false);
  const labelY = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(labelY, { toValue: foc || value ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [foc, value]);

  const labelTop = labelY.interpolate({ inputRange: [0, 1], outputRange: [17, -9] });
  const labelSize = labelY.interpolate({ inputRange: [0, 1], outputRange: [15, 11] });
  const labelColor = error ? C.error : foc ? C.goldBright : C.textMid;

  return (
    <View style={fieldS.wrap}>
      <View style={[fieldS.box, foc && fieldS.boxFoc, error && fieldS.boxErr]}>
        <Animated.Text style={[fieldS.label, { top: labelTop, fontSize: labelSize, color: labelColor }]}>
          {label}
        </Animated.Text>
        <TextInput
          style={fieldS.input}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFoc(true)}
          onBlur={() => setFoc(false)}
          secureTextEntry={secure}
          keyboardType={keyboard}
          placeholderTextColor={C.textDim}
          selectionColor={C.gold}
          contextMenuHidden
        />
        {rightChild && <View style={fieldS.right}>{rightChild}</View>}
      </View>
      {helper && !error && <Text style={fieldS.helper}>{helper}</Text>}
    </View>
  );
};

const fieldS = StyleSheet.create({
  wrap: { marginBottom: SPACING.lg },
  box: { height: 58, borderRadius: RADII.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surfaceRaise, paddingHorizontal: SPACING.md, flexDirection: "row", alignItems: "center", position: "relative" },
  boxFoc: { borderColor: C.gold, backgroundColor: "#152D1E" },
  boxErr: { borderColor: C.error, backgroundColor: C.errorBg },
  label: { position: "absolute", left: 16, backgroundColor: C.surfaceRaise, paddingHorizontal: 4, fontWeight: "600", letterSpacing: 0.3, zIndex: 1 },
  input: { flex: 1, color: C.text, fontSize: 16, paddingTop: 10, paddingBottom: 0, fontWeight: "500" },
  right: { marginLeft: 8, justifyContent: "center" },
  helper: { marginTop: 6, marginLeft: 4, fontSize: 11, color: C.textDim, letterSpacing: 0.2 },
});

// ─── GOLD BUTTON ────────────────────────────────────────────────────────────
export const GoldButton = ({ label, onPress, loading, disabled, outline = false }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const shimX = useRef(new Animated.Value(-width)).current;

  useEffect(() => {
    if (!outline && !disabled && !loading) {
      Animated.loop(
        Animated.timing(shimX, { toValue: width * 1.5, duration: 2800, useNativeDriver: true })
      ).start();
    }
  }, [outline, disabled, loading]);

  const pressIn = () => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, friction: 5, tension: 50, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={loading || disabled}
        activeOpacity={0.88}
        style={[btnS.btn, outline ? btnS.outline : btnS.solid, disabled && btnS.disabled]}
      >
        {!outline && !disabled && (
          <Animated.View style={[btnS.shimmer, { transform: [{ translateX: shimX }] }]} />
        )}
        {loading
          ? <ActivityIndicator color={outline ? C.gold : C.bg} size="small" />
          : <Text style={[btnS.label, outline ? btnS.labelOutline : btnS.labelSolid]}>{label}</Text>
        }
      </TouchableOpacity>
    </Animated.View>
  );
};

const btnS = StyleSheet.create({
  btn: { height: 54, borderRadius: RADII.lg, justifyContent: "center", alignItems: "center", overflow: "hidden", position: "relative" },
  solid: { backgroundColor: C.gold },
  outline: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.gold },
  disabled: { backgroundColor: C.border },
  shimmer: { position: "absolute", top: 0, width: 60, height: "100%", backgroundColor: "rgba(255,255,255,0.22)", transform: [{ skewX: "-25deg" }] },
  label: { fontSize: 15, fontWeight: "700", letterSpacing: 1.2 },
  labelSolid: { color: C.bg },
  labelOutline: { color: C.gold },
});

// ─── DIVIDER ─────────────────────────────────────────────────────────────────
export const Divider = ({ label }) => (
  <View style={divS.row}>
    <View style={divS.line} />
    {label && <Text style={divS.txt}>{label}</Text>}
    {label && <View style={divS.line} />}
  </View>
);

const divS = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", marginVertical: SPACING.lg },
  line: { flex: 1, height: 1, backgroundColor: C.border },
  txt: { marginHorizontal: 12, color: C.textDim, fontSize: 11, letterSpacing: 1.5, fontWeight: "600" },
});

// ─── STEP INDICATOR ──────────────────────────────────────────────────────────
// Generic — pass your own step labels so Register/other flows can reuse it.
export const Steps = ({ labels, activeIndex, doneIndex }) => (
  <View style={stepS.row}>
    {labels.map((s, i) => {
      const active = activeIndex === i;
      const done = doneIndex !== undefined && i <= doneIndex && i !== activeIndex;
      return (
        <React.Fragment key={i}>
          {i > 0 && <View style={[stepS.connector, done && stepS.connectorDone]} />}
          <View style={[stepS.step, active && stepS.stepActive, done && stepS.stepDone]}>
            <Text style={[stepS.num, (active || done) && stepS.numActive]}>
              {done ? "+" : i + 1}
            </Text>
          </View>
          <Text style={[stepS.lbl, active && stepS.lblActive]}>{s}</Text>
        </React.Fragment>
      );
    })}
  </View>
);

const stepS = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: SPACING.xl },
  step: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: C.border, justifyContent: "center", alignItems: "center" },
  stepActive: { borderColor: C.gold, backgroundColor: C.goldGlow },
  stepDone: { borderColor: C.primaryLight, backgroundColor: C.primaryLight },
  connector: { width: 24, height: 1.5, backgroundColor: C.border, marginHorizontal: 6 },
  connectorDone: { backgroundColor: C.primaryLight },
  num: { fontSize: 12, fontWeight: "700", color: C.textDim },
  numActive: { color: C.gold },
  lbl: { fontSize: 11, color: C.textDim, marginHorizontal: 6, fontWeight: "600", letterSpacing: 0.5 },
  lblActive: { color: C.text },
});

// ─── PASSWORD INPUT ──────────────────────────────────────────────────────────
// Standalone password field with show/hide eye toggle. Matches the ivory card
// style used on Login, Register, and ChangePassword screens.
export const PasswordInput = ({ label = "Password", value, onChangeText, error, helper }) => {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={pwS.wrap}>
      <Text style={pwS.label}>{label}</Text>
      <View style={[pwS.row, focused && pwS.rowFocused, error && pwS.rowError]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={pwS.input}
          placeholderTextColor={C.textMuted}
          selectionColor={C.gold}
          allowFontScaling={false}
        />
        <TouchableOpacity
          onPress={() => setShow(s => !s)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={pwS.eyeBtn}
        >
          {show ? <EyeOffIcon size={20} color={C.textMuted} /> : <EyeIcon size={20} color={C.textMuted} />}
        </TouchableOpacity>
      </View>
      {!!helper && !error && <Text allowFontScaling={false} style={pwS.helper}>{helper}</Text>}
    </View>
  );
};

const pwS = StyleSheet.create({
  wrap: { marginBottom: SPACING.md },
  label: { fontSize: 11, color: C.textMuted, fontWeight: "700", letterSpacing: 0.5, marginBottom: 5 },
  row: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(21,34,25,0.15)",
    borderRadius: RADII.sm,
    paddingHorizontal: 14,
    backgroundColor: C.ivory,
  },
  rowFocused: { borderColor: C.gold },
  rowError: { borderColor: C.error },
  input: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textDark },
  eyeBtn: { paddingLeft: 10, justifyContent: "center" },
  helper: { fontSize: 10, color: C.textMuted, marginTop: 6 },
});