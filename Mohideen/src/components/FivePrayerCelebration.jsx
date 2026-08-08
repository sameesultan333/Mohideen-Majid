/**
 * Shown once, on the day the fifth prayer is confirmed.
 *
 * The brief is calm and respectful rather than celebratory in a party sense —
 * so: no confetti, no bounce, no sound. A slow gold pulse over the app's deep
 * emerald, the Arabic الحمد لله settling into place, and the five prayers
 * lighting in sequence to acknowledge what was actually completed. Everything
 * eases over ~1.5s and then simply rests; it dismisses on tap or on its own.
 *
 * Purely presentational. Whether it should appear at all — the once-per-day
 * rule and the transition check — is decided by the caller.
 */

import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Pressable, Dimensions } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop, Rect } from "react-native-svg";

import SafeModal from "./SafeModal";
import { COLORS as C, FONTS } from "../config/theme";

const { width: SW, height: SH } = Dimensions.get("window");
const RING = Math.min(SW * 0.62, 260);

/** How long it rests on screen before dismissing itself. */
const AUTO_DISMISS_MS = 5200;

export default function FivePrayerCelebration({ visible, onDismiss, t }) {
  const label = (key, fallback) => (t ? t(key, fallback) : fallback);

  const fade = useRef(new Animated.Value(0)).current;      // backdrop
  const rise = useRef(new Animated.Value(0)).current;      // the wordmark
  const pulse1 = useRef(new Animated.Value(0)).current;    // expanding rings
  const pulse2 = useRef(new Animated.Value(0)).current;
  // One value per prayer, lit in order.
  const dots = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!visible) return;

    fade.setValue(0);
    rise.setValue(0);
    pulse1.setValue(0);
    pulse2.setValue(0);
    dots.forEach((d) => d.setValue(0));

    const ease = Easing.bezier(0.22, 1, 0.36, 1);   // slow settle, no overshoot

    const entrance = Animated.sequence([
      Animated.timing(fade, {
        toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(rise, { toValue: 1, duration: 900, easing: ease, useNativeDriver: true }),
        // The five prayers acknowledged one at a time rather than all at once.
        Animated.stagger(130, dots.map((d) =>
          Animated.timing(d, { toValue: 1, duration: 420, easing: ease, useNativeDriver: true }),
        )),
      ]),
    ]);

    // A single unhurried breath, repeated — not a flashing loop.
    const ring = (value, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1, duration: 2600, easing: Easing.out(Easing.quad), useNativeDriver: true,
          }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );

    const rings = Animated.parallel([ring(pulse1, 0), ring(pulse2, 1300)]);

    entrance.start();
    rings.start();

    const timer = setTimeout(() => onDismiss?.(), AUTO_DISMISS_MS);
    return () => {
      clearTimeout(timer);
      rings.stop();
    };
  }, [visible]);

  if (!visible) return null;

  const ringStyle = (value) => ({
    opacity: value.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.7] }) }],
  });

  return (
    <SafeModal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={st.root} onPress={onDismiss} accessibilityRole="button">
        {/* Deep emerald with a soft gold bloom behind the wordmark. */}
        <Svg width={SW} height={SH} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="44%" r="62%">
              <Stop offset="0%" stopColor={C.gold} stopOpacity={0.20} />
              <Stop offset="55%" stopColor={C.bg} stopOpacity={0.96} />
              <Stop offset="100%" stopColor={C.bg} stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={SW} height={SH} fill="url(#glow)" />
        </Svg>

        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
          <View style={st.center}>
            {/* Expanding rings, staggered so there is always one mid-breath. */}
            <Animated.View style={[st.ring, ringStyle(pulse1)]} />
            <Animated.View style={[st.ring, ringStyle(pulse2)]} />

            <Svg width={RING} height={RING} style={st.ringSvg}>
              <Circle
                cx={RING / 2} cy={RING / 2} r={RING / 2 - 2}
                stroke={C.gold} strokeOpacity={0.28} strokeWidth={1} fill="none"
              />
            </Svg>

            <Animated.View
              style={{
                opacity: rise,
                transform: [
                  { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
                  { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                ],
                alignItems: "center",
              }}
            >
              <Text allowFontScaling={false} style={st.arabic}>الحمد لله</Text>
              <View style={st.rule} />
              <Text allowFontScaling={false} style={st.title}>
                {label("home.celebration.title", "Alhamdulillah")}
              </Text>
              <Text allowFontScaling={false} style={st.subtitle}>
                {label("home.celebration.subtitle", "All five daily prayers completed.")}
              </Text>
            </Animated.View>

            <View style={st.dots}>
              {dots.map((d, i) => (
                <Animated.View
                  key={i}
                  style={[
                    st.dot,
                    {
                      opacity: d,
                      transform: [{ scale: d.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </SafeModal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  ring: {
    position: "absolute",
    width: RING, height: RING, borderRadius: RING / 2,
    borderWidth: 1, borderColor: C.gold,
  },
  ringSvg: { position: "absolute" },

  arabic: {
    fontSize: 40, color: C.gold, letterSpacing: 1,
    textAlign: "center", marginBottom: 14,
  },
  rule: { width: 46, height: 1, backgroundColor: C.gold, opacity: 0.45, marginBottom: 14 },
  title: {
    fontSize: 24, fontWeight: "800", color: C.ivory,
    letterSpacing: 0.5, fontFamily: FONTS?.display, marginBottom: 8,
  },
  subtitle: {
    fontSize: 13.5, color: "rgba(255,255,255,0.62)",
    letterSpacing: 0.3, textAlign: "center", paddingHorizontal: 32,
  },

  dots: { position: "absolute", bottom: SH * 0.24, flexDirection: "row", gap: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.gold },
});
