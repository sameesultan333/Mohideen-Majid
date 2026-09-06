import React, { useEffect, useRef } from "react";
import {
  View,
  Animated,
  Easing,
  StatusBar,
  StyleSheet,
  Dimensions,
} from "react-native";
import Svg, {
  Path,
  Circle,
  Rect,
  Defs,
  LinearGradient,
  Stop,
  G,
} from "react-native-svg";
import { getToken } from "../utils/secureStorage";
import { authApiFetch } from "../config/server";
import { colors } from "../config/theme";

const { width } = Dimensions.get("window");

// ─── Timing budget ───────────────────────────────────────────────
// Was 3000. This is a floor, not a duration: the auth check (decideRoute)
// runs in parallel and usually resolves in a few hundred ms, so the app sat
// on the splash doing nothing for the remainder — dead time on every single
// launch, before the user could even reach the login form. Measured on a
// physical device: splash still up at 3.5s, login form only at 5.5s.
//
// 1800 is chosen against the animation timeline below, not picked at random:
// the mark lands at ~1000ms (t1 200 + 800), the divider at ~1400ms (t2 900 +
// 500) and the title at ~1850ms (t3 1300 + 550). Exiting at 1800ms + the
// 320ms fade lets every meaningful element land; only the decorative shimmer
// (t4, starts 1900ms) is cut. Going much below this starts the fade-out
// before the title has appeared, which looks broken rather than fast.
const MIN_DISPLAY_MS = 1800;
const MAX_DISPLAY_MS = 4800; // hard safety ceiling (< 5000ms requirement)
const FADE_OUT_MS = 320;

// Key used when the OTP login flow stores the session token.
// IMPORTANT: align this with whatever key LoginScreen/AuthComponents
// actually uses when it persists the token after /auth/verify-login-otp.
const TOKEN_KEY = "auth_token";

// ─── Mosque silhouette (gold on emerald) ─────────────────────────
const MosqueMark = ({ size = 180 }) => (
  <Svg width={size} height={size * 0.85} viewBox="0 0 200 170">
    <Defs>
      <LinearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
        <Stop offset={0} stopColor={colors.gold.light} />
        <Stop offset={1} stopColor={colors.gold.base} />
      </LinearGradient>
      <LinearGradient id="domeGrad" x1="0" y1="0" x2="0" y2="1">
        <Stop offset={0} stopColor={colors.gold.light} />
        <Stop offset={1} stopColor={colors.gold.deep} />
      </LinearGradient>
    </Defs>

    <Rect x="10" y="80" width="18" height="70" rx="2" fill="url(#goldGrad)" />
    <Rect x="8" y="100" width="22" height="5" rx="1" fill={colors.gold.light} />
    <Rect x="8" y="120" width="22" height="5" rx="1" fill={colors.gold.light} />
    <Rect x="6" y="75" width="26" height="8" rx="3" fill={colors.gold.light} />
    <Path d="M14 75 Q19 58 24 75 Z" fill="url(#domeGrad)" />

    <Rect x="172" y="80" width="18" height="70" rx="2" fill="url(#goldGrad)" />
    <Rect x="170" y="100" width="22" height="5" rx="1" fill={colors.gold.light} />
    <Rect x="170" y="120" width="22" height="5" rx="1" fill={colors.gold.light} />
    <Rect x="168" y="75" width="26" height="8" rx="3" fill={colors.gold.light} />
    <Path d="M176 75 Q181 58 186 75 Z" fill="url(#domeGrad)" />

    <Rect x="30" y="105" width="140" height="65" rx="3" fill="url(#goldGrad)" />

    {[55, 91, 127].map((x, i) => (
      <G key={i}>
        <Path
          d={`M${x} 148 L${x} 135 A9 9 0 0 1 ${x + 18} 135 L${x + 18} 148 Z`}
          fill={colors.emerald.deep}
        />
      </G>
    ))}

    <Path
      d="M83 170 L83 130 A17 17 0 0 1 117 130 L117 170 Z"
      fill={colors.emerald.deep}
    />

    <Path d="M30 105 A20 22 0 0 1 70 105 Z" fill="url(#domeGrad)" />
    <Path d="M130 105 A20 22 0 0 1 170 105 Z" fill="url(#domeGrad)" />

    <Path d="M55 105 A45 50 0 0 1 145 105 Z" fill="url(#domeGrad)" />
    <Rect x="94" y="56" width="12" height="12" rx="2" fill={colors.gold.light} />
    <Path d="M100 42 L101.5 47 L100 46 L98.5 47 Z" fill={colors.gold.light} />

    <Rect x="30" y="102" width="140" height="4" rx="1" fill={colors.gold.light} />
    <Rect x="5" y="168" width="190" height="2" rx="1" fill={colors.gold.deep} />
  </Svg>
);

// ─── Ornamental ring ─────────────────────────────────────────────
const GeometricRing = ({ size = 260 }) => {
  const count = 24;
  const cx = size / 2;
  const r = size / 2 - 4;
  const innerR = r - 10;

  const dashes = Array.from({ length: count }).map((_, i) => {
    const angle = (i / count) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cx + r * Math.sin(angle);
    const x2 = cx + innerR * Math.cos(angle);
    const y2 = cx + innerR * Math.sin(angle);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  });

  return (
    <Svg width={size} height={size}>
      <Circle
        cx={cx}
        cy={cx}
        r={r - 2}
        stroke={colors.gold.base}
        strokeWidth="0.8"
        fill="none"
        strokeDasharray="4 6"
      />
      <Circle
        cx={cx}
        cy={cx}
        r={innerR - 4}
        stroke={colors.gold.base}
        strokeWidth="0.5"
        fill="none"
        opacity={0.5}
      />
      {dashes.map((d, i) => (
        <Path key={i} d={d} stroke={colors.gold.base} strokeWidth="1" opacity={0.7} />
      ))}
    </Svg>
  );
};

// NOTE: component name stays "LogoScreen" and default-exports the
// same way, so AppNavigator's `import LogoScreen from "../screens/LogoScreen"`
// keeps working unchanged.
const LogoScreen = ({ navigation }) => {
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.6)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const markY = useRef(new Animated.Value(30)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(14)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const dividerWidth = useRef(new Animated.Value(0)).current;
  const shimmerX = useRef(new Animated.Value(-1)).current;

  // Exit veil — fades the whole screen out as one unit right before
  // navigation.reset() fires, so the cut to Login/Home feels intentional.
  const exitOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let isMounted = true;
    StatusBar.setBarStyle("light-content");

    Animated.timing(bgOpacity, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    const t1 = setTimeout(() => {
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: 1,
          duration: 800,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(markY, {
          toValue: 0,
          duration: 800,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }),
        Animated.timing(markOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200);

    const t2 = setTimeout(() => {
      Animated.timing(dividerWidth, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }, 900);

    const t3 = setTimeout(() => {
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 550,
          useNativeDriver: true,
        }),
        Animated.timing(titleY, {
          toValue: 0,
          duration: 550,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(subtitleOpacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]).start();
    }, 1300);

    const t4 = setTimeout(() => {
      Animated.timing(shimmerX, {
        toValue: 1,
        duration: 900,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start();
    }, 1900);

    // ── Auth check, runs in parallel with the animation ──
    const start = Date.now();

    const decideRoute = async () => {
      try {
        const token = await getToken();
        if (!token) return "Login";
        // Check live status — catches pending/rejected/disabled users
        try {
          const res = await authApiFetch("/auth/me");
          const me = res && res.ok ? await res.json() : null;
          if (me && me.status === "PENDING_APPROVAL") return "PendingApproval";
          if (me && me.status === "REJECTED") return "Login";
          if (me && me.status === "DISABLED") return "Login";
          if (me && me.must_change_password) return "ForceChangePassword";
        } catch (_) {
          // If /me fails (offline or expired), fall through to Home so
          // the app still opens — route guards handle edge cases
        }
        return "Home";
      } catch (e) {
        return "Login";
      }
    };

    const goToRoute = (route) => {
      if (!isMounted || !navigation) return;
      Animated.timing(exitOpacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        if (!isMounted) return;
        // reset() removes "Logo" from the stack entirely — there is
        // no history entry left to swipe/back-button into.
        navigation.reset({
          index: 0,
          routes: [{ name: route }],
        });
      });
    };

    const run = async () => {
      const route = await decideRoute();
      const elapsed = Date.now() - start;
      const remaining = Math.max(MIN_DISPLAY_MS - elapsed, 0);
      setTimeout(() => {
        if (isMounted) goToRoute(route);
      }, remaining);
    };

    run();

    const safety = setTimeout(() => {
      goToRoute("Login");
    }, MAX_DISPLAY_MS);

    return () => {
      isMounted = false;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(safety);
    };
  }, []);

  const shimmerTranslate = shimmerX.interpolate({
    inputRange: [-1, 1],
    outputRange: [-120, 120],
  });

  return (
    <Animated.View style={[styles.container, { opacity: bgOpacity }]}>

      <View style={styles.glowCircle} />

      <Animated.View
        style={[
          styles.ringWrapper,
          { opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      >
        <GeometricRing size={280} />
      </Animated.View>

      <Animated.View
        style={{
          opacity: markOpacity,
          transform: [{ translateY: markY }],
          marginTop: -10,
        }}
      >
        <MosqueMark size={180} />
      </Animated.View>

      <View style={styles.dividerContainer}>
        <Animated.View
          style={[styles.divider, { transform: [{ scaleX: dividerWidth }] }]}
        >
          <Animated.View
            style={[
              styles.shimmer,
              { transform: [{ translateX: shimmerTranslate }] },
            ]}
          />
        </Animated.View>
        <View style={styles.diamond} />
      </View>

      <Animated.Text
        style={[
          styles.title,
          { opacity: titleOpacity, transform: [{ translateY: titleY }] },
        ]}
      >
        Mohideen Masjid
      </Animated.Text>

      <Animated.Text style={[styles.subtitle, { opacity: subtitleOpacity }]}>
        مسجد المحيدين
      </Animated.Text>

      <Animated.Text style={[styles.tagline, { opacity: subtitleOpacity }]}>
        A Place of Peace &amp; Worship
      </Animated.Text>

      <Animated.View style={[styles.dotsRow, { opacity: subtitleOpacity }]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, i === 1 && styles.dotCenter]} />
        ))}
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colors.emerald.deep,
            opacity: exitOpacity.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
          },
        ]}
      />
    </Animated.View>
  );
};

export default LogoScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.emerald.deep,
    alignItems: "center",
    justifyContent: "center",
  },
  glowCircle: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: colors.emerald.base,
    opacity: 0.35,
  },
  ringWrapper: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  dividerContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 18,
  },
  divider: {
    width: 160,
    height: 1.5,
    backgroundColor: colors.gold.base,
    borderRadius: 1,
    overflow: "hidden",
  },
  shimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 60,
    height: "100%",
    backgroundColor: colors.gold.light,
    opacity: 0.8,
    borderRadius: 1,
  },
  diamond: {
    position: "absolute",
    width: 7,
    height: 7,
    backgroundColor: colors.gold.base,
    transform: [{ rotate: "45deg" }],
  },
  title: {
    fontSize: 26,
    color: "#FFFFFF",
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 18,
    color: colors.gold.base,
    fontWeight: "400",
    letterSpacing: 3,
    textAlign: "center",
    marginBottom: 8,
  },
  tagline: {
    fontSize: 11,
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 2.5,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 28,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.gold.deep,
  },
  dotCenter: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold.base,
  },
});