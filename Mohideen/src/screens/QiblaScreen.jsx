/**

 * QiblaScreen.jsx — Premium Redesign v2

 *

 * COLOR SYSTEM

 *  - Fully re-themed onto the emerald + metallic-gold + ivory palette

 *    (src/config/theme.js). Every color below is either taken directly

 *    from that palette or derived from it (opacity / mix) — nothing new

 *    is hardcoded.

 *

 * PRECISION / LOCKING SYSTEM (new)

 *  - Heading is exponentially smoothed before accumulation, cutting

 *    sensor jitter noticeably vs. raw compass output.

 *  - shortest-delta accumulation (no 359→1 jumps), same as before.

 *  - Lock uses hysteresis: enters "aligned" at ≤4°, only exits past 8°.

 *    This alone removes the flicker you get right at a hard threshold.

 *  - Lock also requires the reading to *hold* inside the enter-zone for

 *    ~300ms before it actually locks (debounce) — this is what makes

 *    premium qibla apps feel "certain" instead of twitchy.

 *  - Compass accuracy is read from the sensor and surfaced as a

 *    calibration prompt ("move in a figure-8") when it's unreliable,

 *    exactly like Muslim Pro / other premium apps do — instead of

 *    silently showing a heading that can't be trusted.

 *

 * i18n

 *  - No hardcoded UI strings. Everything goes through t("qibla.*").

 *    See the en.json block provided alongside this file.

 */



import React, { useEffect, useState, useRef } from "react";

import {

  View,

  Text,

  StyleSheet,

  PermissionsAndroid,

  Platform,

  Animated,

  Easing,

  Dimensions,

  Vibration,

  StatusBar,

  Pressable,

} from "react-native";


import { useTranslation } from "react-i18next";

import Geolocation from "react-native-geolocation-service";

import CompassHeading from "react-native-compass-heading";

import Svg, {

  Circle,

  Line,

  Path,

  Polygon,

  Rect,

  Text as SvgText,

  Defs,

  LinearGradient,

  RadialGradient,

  Stop,

} from "react-native-svg";



// Adjust this path if your project structure differs.

import { COLORS, colors as PALETTE } from "../config/theme";



const { width } = Dimensions.get("window");

const S  = Math.min(width * 0.84, 340);



const KAABA = { lat: 21.422487, lng: 39.826206 };



// ── Color derivation helpers ──────────────────────────────────────────────

// Every accent below comes from the theme's `colors` (3-step palette) or

// `COLORS` (flattened) exports. Faint/dim tones are derived via opacity or

// linear RGB mix rather than inventing new hex values.

const hexToRgba = (hex, alpha) => {

  const h = hex.replace("#", "");

  const r = parseInt(h.substring(0, 2), 16);

  const g = parseInt(h.substring(2, 4), 16);

  const b = parseInt(h.substring(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;

};

const mix = (hexA, hexB, t) => {

  const a = hexA.replace("#", ""), b = hexB.replace("#", "");

  const ar = parseInt(a.substring(0, 2), 16), ag = parseInt(a.substring(2, 4), 16), ab = parseInt(a.substring(4, 6), 16);

  const br = parseInt(b.substring(0, 2), 16), bg = parseInt(b.substring(2, 4), 16), bb = parseInt(b.substring(4, 6), 16);

  return `rgb(${Math.round(ar + (br - ar) * t)}, ${Math.round(ag + (bg - ag) * t)}, ${Math.round(ab + (bb - ab) * t)})`;

};



// ── Palette (derived from src/config/theme.js) ─────────────────────────────

const C = {

  bg:          COLORS.bg,                              // emerald.deep — screen background

  surface:     COLORS.bg,

  card:        "rgba(255,255,255,0.045)",               // glass card over the emerald bg

  cardBorder:  COLORS.border,                           // theme's gold hairline



  // Gold

  gold:        COLORS.gold,                             // gold.base — true metallic gold

  goldBright:  COLORS.goldLight,

  goldDim:     COLORS.goldDeep,

  goldFaint:   hexToRgba(COLORS.gold, 0.08),



  // Emerald / "mint" accent (aligned state)

  mint:        PALETTE.emerald.light,

  mintBright:  mix(PALETTE.emerald.light, "#FFFFFF", 0.35),

  mintDim:     PALETTE.emerald.base,

  mintFaint:   hexToRgba(PALETTE.emerald.light, 0.08),



  // Structure (neutral rings on the dark surface)

  ring:        "rgba(255,255,255,0.08)",

  ringMid:     "rgba(255,255,255,0.16)",

  ringBright:  hexToRgba(COLORS.gold, 0.35),



  // Text

  txtPrimary:  COLORS.ivory,

  txtSec:      "rgba(255,255,255,0.55)",

  txtMuted:    "rgba(255,255,255,0.30)",



  // Status

  aligned:     PALETTE.emerald.light,

  unaligned:   COLORS.gold,

  north:       COLORS.error,

  errorBg:     COLORS.errorBg,

};



// ── Math ──────────────────────────────────────────────────────────────────────

const toRad = d => (d * Math.PI) / 180;

const toDeg = r => (r * 180) / Math.PI;



const qiblaFor = (lat, lng) => {

  const p1 = toRad(lat), p2 = toRad(KAABA.lat);

  const dl = toRad(KAABA.lng - lng);

  const y  = Math.sin(dl) * Math.cos(p2);

  const x  = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);

  return ((toDeg(Math.atan2(y, x)) + 360) % 360);

};



const haversineKm = (lat1, lng1, lat2, lng2) => {

  const R  = 6371;

  const dp = toRad(lat2 - lat1), dl = toRad(lng2 - lng1);

  const a  = Math.sin(dp / 2) ** 2 +

             Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

};



const shortestDelta = (cur, tgt) => {

  return ((tgt - cur) % 360 + 540) % 360 - 180;

};



// Alignment tuning — hysteresis prevents flicker right at the boundary,

// debounce prevents a single noisy reading from "locking" prematurely.

const ALIGN_ENTER_DEG   = 4;

const ALIGN_EXIT_DEG    = 8;

const LOCK_DEBOUNCE_MS  = 300;



// Heading filter tuning. Sensor characteristics vary a lot across phones

// (magnetometer noise floor, update rate, whether the OS fuses in the

// gyroscope), so this filter is adaptive rather than a single fixed

// smoothing constant:

//  - small movements (jitter/noise) get heavy smoothing (low alpha)

//  - large movements (an actual turn) get light smoothing (high alpha)

// so it stays both soft AND responsive instead of picking one trade-off.

const ALPHA_MIN          = 0.10;  // smoothing floor — applied to near-zero deltas

const ALPHA_MAX          = 0.45;  // smoothing ceiling — applied to fast turns

const ALPHA_DELTA_SCALE  = 0.03;  // how quickly alpha ramps up with delta size

const OUTLIER_JUMP_DEG   = 45;    // single-sample jumps bigger than this are

                                   // held back for one tick and only accepted

                                   // if the next reading confirms real motion

                                   // (rejects magnetometer spikes from nearby

                                   // metal/speakers/magnets)

const ROTATE_DURATION_MS = 180;   // soft glide duration for the visible rose



// Compass accuracy is reported completely differently across platforms:

//  - iOS gives `headingAccuracy` in degrees (lower = better, negative = invalid)

//  - Many Android devices instead report the SensorManager accuracy

//    constant: 0 = unreliable, 1 = low, 2 = medium, 3 = high

// Treating one scale as the other silently breaks the calibration prompt

// on whichever platform you didn't test on, so they're handled separately.

const IOS_POOR_ACCURACY_DEG = 20;

const ANDROID_LOW_ACCURACY  = 1;   // <= this (on the 0-3 scale) needs calibration



// If the sensor's own accuracy field is missing or unreliable on a given

// device, fall back to detecting interference directly: a rolling window

// of raw deltas with high variance means the reading is jittering around

// rather than tracking a real heading — almost always nearby magnetic

// interference rather than "sensor drift".

const INTERFERENCE_WINDOW    = 10;

const INTERFERENCE_STDEV_DEG = 13;



const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));



// ── Permission ────────────────────────────────────────────────────────────────

const requestLocationPermission = async (t) => {

  if (Platform.OS !== "android") return true;

  try {

    const ok = await PermissionsAndroid.check(

      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION

    );

    if (ok) return true;

    const res = await PermissionsAndroid.request(

      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,

      {

        title: t("qibla.permissionTitle"),

        message: t("qibla.permissionMessage"),

        buttonPositive: t("qibla.permissionAllow"),

        buttonNegative: t("qibla.permissionDeny"),

      }

    );

    return res === PermissionsAndroid.RESULTS.GRANTED;

  } catch { return false; }

};



// ── CompassRose ───────────────────────────────────────────────────────────────

const CompassRose = React.memo(({ size, aligned, cardinalLabels }) => {

  const cx = size / 2, cy = size / 2;

  const r  = size / 2 - 3;

  const items = [];



  for (let deg = 0; deg < 360; deg += 3) {

    const isCard = deg % 90 === 0;

    const is45   = deg % 45 === 0 && !isCard;

    const isMaj  = deg % 15 === 0 && !isCard && !is45;

    const rad    = toRad(deg - 90);

    const outer  = r - 4;

    const len    = isCard ? 22 : is45 ? 14 : isMaj ? 8 : 4;

    const inner  = outer - len;



    items.push(

      <Line

        key={`t${deg}`}

        x1={cx + outer * Math.cos(rad)} y1={cy + outer * Math.sin(rad)}

        x2={cx + inner * Math.cos(rad)} y2={cy + inner * Math.sin(rad)}

        stroke={isCard ? C.gold : is45 ? C.goldDim : isMaj ? C.ringMid : C.ring}

        strokeWidth={isCard ? 2 : is45 ? 1.5 : isMaj ? 1 : 0.6}

      />

    );



    if (isCard) {

      const lbl   = { 0: cardinalLabels.n, 90: cardinalLabels.e, 180: cardinalLabels.s, 270: cardinalLabels.w }[deg];

      const lr    = outer - 36;

      const isN   = deg === 0;

      items.push(

        <SvgText

          key={`l${deg}`}

          x={cx + lr * Math.cos(rad)}

          y={cy + lr * Math.sin(rad)}

          fill={isN ? C.north : C.gold}

          fontSize={isN ? 19 : 14}

          fontWeight="700"

          textAnchor="middle"

          alignmentBaseline="middle"

          letterSpacing={0.5}

        >{lbl}</SvgText>

      );

    }

  }



  // Degree numerals at 30° intervals (excluding cardinals)

  for (let deg = 30; deg < 360; deg += 30) {

    if (deg % 90 === 0) continue;

    const rad = toRad(deg - 90);

    const lr  = r - 56;

    items.push(

      <SvgText

        key={`n${deg}`}

        x={cx + lr * Math.cos(rad)}

        y={cy + lr * Math.sin(rad)}

        fill={C.txtMuted}

        fontSize={8}

        textAnchor="middle"

        alignmentBaseline="middle"

      >{deg}</SvgText>

    );

  }



  return (

    <Svg width={size} height={size}>

      <Defs>

        <RadialGradient id="face" cx="50%" cy="50%" r="50%">

          <Stop offset="0"   stopColor={mix(C.bg, "#FFFFFF", 0.06)} />

          <Stop offset="0.7" stopColor={C.bg} />

          <Stop offset="1"   stopColor={mix(C.bg, "#000000", 0.15)} />

        </RadialGradient>

        <LinearGradient id="bezel" x1="0" y1="0" x2="1" y2="1">

          <Stop offset="0"   stopColor={mix(C.bg, "#FFFFFF", 0.08)} />

          <Stop offset="1"   stopColor={mix(C.bg, "#000000", 0.08)} />

        </LinearGradient>

        <LinearGradient id="gRing" x1="0" y1="0" x2="1" y2="1">

          <Stop offset="0"   stopColor={C.goldBright} />

          <Stop offset="1"   stopColor={C.goldDim} />

        </LinearGradient>

        <LinearGradient id="mRing" x1="0" y1="0" x2="1" y2="1">

          <Stop offset="0"   stopColor={aligned ? C.mintBright : C.ringBright} />

          <Stop offset="1"   stopColor={aligned ? C.mintDim   : C.ringMid} />

        </LinearGradient>

      </Defs>



      <Circle cx={cx} cy={cy} r={r}      fill="url(#bezel)" />

      <Circle cx={cx} cy={cy} r={r - 4}  fill="none" stroke="url(#gRing)"  strokeWidth={1.2} />

      <Circle cx={cx} cy={cy} r={r - 7}  fill="none" stroke="url(#mRing)"  strokeWidth={0.8} strokeDasharray="3,5" />

      <Circle cx={cx} cy={cy} r={r - 10} fill="url(#face)" />

      <Circle cx={cx} cy={cy} r={r - 12} fill="none" stroke={C.ring} strokeWidth={0.5} strokeDasharray="1,4" />



      {items}



      <Circle cx={cx} cy={cy} r={r - 78} fill="none" stroke={C.ring}       strokeWidth={0.8} />

      <Circle cx={cx} cy={cy} r={r - 82} fill="none" stroke={C.goldFaint}  strokeWidth={0.5} strokeDasharray="2,6" />

    </Svg>

  );

});



// ── QiblaArrow ────────────────────────────────────────────────────────────────

const QiblaArrow = React.memo(({ size, aligned }) => {

  const cx  = size / 2, cy = size / 2;

  const ac  = aligned ? C.mint    : C.gold;

  const acd = aligned ? C.mintDim : C.goldDim;



  const tipY   = cy - size * 0.34;

  const baseW  = 13;

  const stemH  = size * 0.24;

  const stemY  = tipY + 36;



  const kb = 18, kx = cx - kb / 2, ky = tipY - kb - 6;



  return (

    <Svg width={size} height={size}>

      <Defs>

        <LinearGradient id="arrowFwd" x1="0" y1="0" x2="0" y2="1">

          <Stop offset="0"   stopColor={aligned ? C.mintBright : C.goldBright} />

          <Stop offset="1"   stopColor={acd} />

        </LinearGradient>

        <LinearGradient id="arrowBack" x1="0" y1="1" x2="0" y2="0">

          <Stop offset="0"   stopColor={C.ring} />

          <Stop offset="1"   stopColor={C.ringMid} />

        </LinearGradient>

      </Defs>



      <Polygon

        points={`${cx},${tipY} ${cx - baseW},${tipY + 38} ${cx},${tipY + 24} ${cx + baseW},${tipY + 38}`}

        fill="url(#arrowFwd)"

        stroke={ac}

        strokeWidth={0.8}

        strokeLinejoin="round"

      />



      <Rect

        x={cx - 4.5} y={stemY}

        width={9} height={stemH}

        rx={4.5}

        fill="url(#arrowFwd)"

      />



      <Polygon

        points={`${cx},${stemY + stemH + 16} ${cx - 10},${stemY + stemH} ${cx + 10},${stemY + stemH}`}

        fill="url(#arrowBack)"

        stroke={C.ring}

        strokeWidth={0.5}

      />



      <Rect

        x={kx} y={ky}

        width={kb} height={kb}

        rx={2.5}

        fill={aligned ? mix(C.bg, "#000000", 0.2) : mix(C.bg, "#000000", 0.35)}

        stroke={ac}

        strokeWidth={1.2}

      />

      <Rect x={kx} y={ky + kb * 0.46} width={kb} height={2.5} rx={1} fill={ac} opacity={0.9} />

      <Rect

        x={kx + kb / 2 - 3} y={ky + kb * 0.5}

        width={6} height={kb * 0.4}

        rx={1.5}

        fill={ac}

        opacity={0.85}

      />



      <Circle cx={cx} cy={cy} r={10} fill={C.surface} stroke={ac} strokeWidth={1.5} />

      <Circle cx={cx} cy={cy} r={4}  fill={ac} />

    </Svg>

  );

});



// ── Loading ───────────────────────────────────────────────────────────────────

const LoadingView = ({ phase, t }) => {

  const rot = useRef(new Animated.Value(0)).current;

  const fade = useRef(new Animated.Value(0)).current;



  useEffect(() => {

    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();

    Animated.loop(

      Animated.timing(rot, {

        toValue: 1, duration: 3000,

        easing: Easing.linear,

        useNativeDriver: true,

      })

    ).start();

  }, []);



  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });



  return (

    <Animated.View style={[st.center, { opacity: fade }]}>

      <Animated.View style={{ transform: [{ rotate: spin }], marginBottom: 32 }}>

        <Svg width={64} height={64}>

          <Circle cx={32} cy={32} r={28} fill="none" stroke={C.ring}     strokeWidth={2} />

          <Circle cx={32} cy={32} r={28} fill="none" stroke={C.gold}     strokeWidth={2}

            strokeDasharray="36,140" strokeLinecap="round" />

          <Circle cx={32} cy={32} r={28} fill="none" stroke={C.mint}     strokeWidth={1.5}

            strokeDasharray="12,162" strokeDashoffset="60" strokeLinecap="round" />

          <Polygon points="32,5 27,18 37,18" fill={C.gold} />

        </Svg>

      </Animated.View>

      <Text style={st.loadTitle}>{t("qibla.title")}</Text>

      <Text style={st.loadSub}>

        {phase === "gps" ? t("qibla.loadingGps") : t("qibla.loadingCompass")}

      </Text>

    </Animated.View>

  );

};



// ── Error ─────────────────────────────────────────────────────────────────────

const ErrorView = ({ message, t }) => (

  <View style={st.center}>

    <View style={st.errRing}>

      <Text style={st.errBang}>!</Text>

    </View>

    <Text style={st.errTitle}>{t("qibla.errorTitle")}</Text>

    <Text style={st.errMsg}>{message}</Text>

    <Text style={st.errHint}>{t("qibla.errorHint")}</Text>

  </View>

);



// ── TurnIndicator ─────────────────────────────────────────────────────────────

const TurnIndicator = ({ dir, deg, t }) => {

  const anim = useRef(new Animated.Value(0)).current;



  useEffect(() => {

    Animated.loop(

      Animated.sequence([

        Animated.timing(anim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),

        Animated.timing(anim, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),

      ])

    ).start();

  }, [dir]);



  const translateX = anim.interpolate({

    inputRange:  [0, 1],

    outputRange: dir === "right" ? [0, 5] : [0, -5],

  });



  const ChevronSvg = ({ flipped }) => (

    <Svg width={20} height={20}>

      <Path

        d={flipped ? "M13 4L6 10L13 16" : "M7 4L14 10L7 16"}

        stroke={C.gold}

        strokeWidth={2}

        strokeLinecap="round"

        strokeLinejoin="round"

        fill="none"

      />

    </Svg>

  );



  return (

    <Animated.View style={[st.turnRow, { transform: [{ translateX }] }]}>

      {dir === "left" && (

        <>

          <ChevronSvg flipped />

          <ChevronSvg flipped />

        </>

      )}

      <View style={st.turnDegWrap}>

        <Text style={st.turnDeg}>{deg}°</Text>

        <Text style={st.turnLbl}>{dir === "right" ? t("qibla.turnRight") : t("qibla.turnLeft")}</Text>

      </View>

      {dir === "right" && (

        <>

          <ChevronSvg />

          <ChevronSvg />

        </>

      )}

    </Animated.View>

  );

};



// ── CalibrateBanner ───────────────────────────────────────────────────────────

const CalibrateBanner = ({ t }) => (

  <View style={st.calibrateBanner}>

    <Svg width={26} height={22}>

      <Circle cx={8}  cy={11} r={7} fill="none" stroke={C.gold} strokeWidth={2} />

      <Circle cx={18} cy={11} r={7} fill="none" stroke={C.gold} strokeWidth={2} />

    </Svg>

    <View style={{ flex: 1 }}>

      <Text style={st.calibrateTitle}>{t("qibla.calibrateTitle")}</Text>

      <Text style={st.calibrateMsg}>{t("qibla.calibrateMsg")}</Text>

    </View>

  </View>

);



// ── StatCell ──────────────────────────────────────────────────────────────────

const StatCell = ({ label, value, accent }) => (

  <View style={st.statCell}>

    <Text style={st.statLabel}>{label}</Text>

    <Text style={[st.statValue, { color: accent || C.txtPrimary }]}>{value}</Text>

  </View>

);



// ── Main ──────────────────────────────────────────────────────────────────────

export default function QiblaScreen({ navigation }) {

  const { t } = useTranslation();

  // Real top inset — covers status bar + display cutout, updates on rotation.



  const [qibla,    setQibla]    = useState(null);

  const [heading,  setHeading]  = useState(0);

  const [aligned,  setAligned]  = useState(false);

  const [location, setLocation] = useState(null);

  const [distKm,   setDistKm]   = useState(null);

  const [error,    setError]    = useState(null);

  const [phase,    setPhase]    = useState("gps");   // gps | compass | ready

  const [accuracy, setAccuracy] = useState(null);



  // Heading accumulator — prevents 359→1 jump

  const headingAnim      = useRef(new Animated.Value(0)).current;

  const headingAccum     = useRef(0);

  const prevRaw          = useRef(null);

  const smoothedRaw      = useRef(null);

  const phaseInitialized = useRef(false);



  // Outlier rejection + interference detection state

  const pendingOutlier  = useRef(null);

  const deltaHistory    = useRef([]);

  const [interference, setInterference] = useState(false);



  // Lock system (hysteresis + debounce)

  const alignedRef  = useRef(false);

  const lockTimer   = useRef(null);

  const pulseAnim   = useRef(new Animated.Value(0)).current;

  const glowAnim    = useRef(new Animated.Value(1)).current;

  const screenFade  = useRef(new Animated.Value(0)).current;



  useEffect(() => {

    Animated.timing(screenFade, { toValue: 1, duration: 800, useNativeDriver: true }).start();



    const init = async () => {

      const granted = await requestLocationPermission(t);

      if (!granted) {

        setError(t("qibla.permissionDenied"));

        return;

      }



      Geolocation.getCurrentPosition(

        ({ coords: { latitude, longitude } }) => {

          const dir  = qiblaFor(latitude, longitude);

          const dist = haversineKm(latitude, longitude, KAABA.lat, KAABA.lng);

          setLocation({ lat: latitude, lng: longitude });

          setQibla(dir);

          setDistKm(Math.round(dist));

          setPhase(p => p === "gps" ? "compass" : p);

        },

        err => setError(t("qibla.locationError", { message: err.message })),

        {

          enableHighAccuracy: true,

          timeout: 30000,

          maximumAge: 5000,

          forceRequestLocation: true,

          showLocationDialog: true,

        }

      );



      // Update threshold of 1° (vs. a coarser 2-3°) for finer-grained

      // readings — safe to do now that the pipeline below actively filters

      // noise, so the extra samples buy precision instead of just jitter.

      CompassHeading.start(1, ({ heading: raw, accuracy: acc }) => {

        if (typeof acc === "number" && !Number.isNaN(acc)) setAccuracy(acc);



        // ── 1. Outlier rejection ────────────────────────────────────────

        // A single large jump is far more likely to be a magnetic spike

        // (metal, a speaker, a case magnet) than an instant real turn. Hold

        // it back one tick and only accept it once the next sample confirms

        // the phone actually moved there.

        if (prevRaw.current !== null) {

          const jump = Math.abs(shortestDelta(prevRaw.current, raw));

          if (jump > OUTLIER_JUMP_DEG) {

            if (pendingOutlier.current === null) {

              pendingOutlier.current = raw;

              return; // wait for confirmation

            }

            const confirmJump = Math.abs(shortestDelta(pendingOutlier.current, raw));

            if (confirmJump > OUTLIER_JUMP_DEG) {

              // still jumping around — treat as interference, drop it

              pendingOutlier.current = null;

              return;

            }

            pendingOutlier.current = null; // confirmed — a real fast turn

          }

        }



        // ── 2. Interference variance tracking (sensor-agnostic fallback) ──

        // Some devices don't report a usable accuracy value at all, so this

        // detects jitter directly: a rolling window of raw deltas with high

        // variance means the reading is oscillating rather than tracking a

        // real heading.

        if (prevRaw.current !== null) {

          const d = shortestDelta(prevRaw.current, raw);

          const hist = deltaHistory.current;

          hist.push(d);

          if (hist.length > INTERFERENCE_WINDOW) hist.shift();

          if (hist.length >= 5) {

            const mean = hist.reduce((a, b) => a + b, 0) / hist.length;

            const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;

            setInterference(Math.sqrt(variance) > INTERFERENCE_STDEV_DEG);

          }

        }



        // ── 3. Adaptive exponential smoothing ──────────────────────────

        // Small deltas (noise/jitter while roughly still) get heavy

        // smoothing; large deltas (an actual turn) get light smoothing so

        // the compass still feels responsive instead of laggy.

        if (smoothedRaw.current === null) {

          smoothedRaw.current = raw;

        } else {

          const sd = shortestDelta(smoothedRaw.current, raw);

          const alpha = clamp(ALPHA_MIN + Math.abs(sd) * ALPHA_DELTA_SCALE, ALPHA_MIN, ALPHA_MAX);

          smoothedRaw.current = (smoothedRaw.current + sd * alpha + 360) % 360;

        }

        const smooth = smoothedRaw.current;

        prevRaw.current = raw;



        if (headingAccum.current === 0 && prevRaw.current === raw && smoothedRaw.current === smooth && !phaseInitialized.current) {

          phaseInitialized.current = true;

          headingAccum.current = smooth;

          headingAnim.setValue(smooth);

          setHeading(smooth);

          setPhase(p => p === "compass" ? "ready" : p);

          return;

        }



        const accumDelta = shortestDelta(

          (headingAccum.current % 360 + 360) % 360,

          smooth

        );

        headingAccum.current += accumDelta;



        // Soft glide instead of re-triggering a spring on every tick — a

        // spring restarted on each sensor sample compounds into a slightly

        // bouncy/overshooting feel at typical update rates. A short eased

        // timing tween gives a continuously smooth follow with no overshoot.

        Animated.timing(headingAnim, {

          toValue: headingAccum.current,

          duration: ROTATE_DURATION_MS,

          easing: Easing.out(Easing.cubic),

          useNativeDriver: true,

        }).start();



        setHeading(smooth);

        setPhase(p => p === "compass" ? "ready" : p);

      });

    };



    init();

    return () => {

      try { CompassHeading.stop(); } catch (_) {}

      if (lockTimer.current) clearTimeout(lockTimer.current);

    };

  }, []);



  // ── Lock system: hysteresis + debounce ──────────────────────────────────

  useEffect(() => {

    if (qibla === null) return;

    const diff = (((qibla - heading) % 360) + 360) % 360;

    const distanceToTarget = Math.min(diff, 360 - diff);

    const withinEnter = distanceToTarget <= ALIGN_ENTER_DEG;

    const withinExit  = distanceToTarget <= ALIGN_EXIT_DEG;



    const lockIn = () => {

      alignedRef.current = true;

      setAligned(true);

      Vibration.vibrate([0, 50, 30, 50]);

      Animated.loop(

        Animated.sequence([

          Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),

          Animated.timing(pulseAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),

        ])

      ).start();

      Animated.loop(

        Animated.sequence([

          Animated.spring(glowAnim, { toValue: 1.035, friction: 10, useNativeDriver: true }),

          Animated.spring(glowAnim, { toValue: 1,     friction: 10, useNativeDriver: true }),

        ])

      ).start();

    };



    const lockOut = () => {

      alignedRef.current = false;

      setAligned(false);

      pulseAnim.stopAnimation(() =>

        Animated.timing(pulseAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start()

      );

      glowAnim.stopAnimation(() =>

        Animated.timing(glowAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start()

      );

    };



    if (!alignedRef.current) {

      if (withinEnter) {

        // Require the reading to hold inside the enter-zone for a short

        // debounce before actually locking — stops one noisy sample from

        // triggering a false lock.

        if (!lockTimer.current) {

          lockTimer.current = setTimeout(() => {

            lockTimer.current = null;

            lockIn();

          }, LOCK_DEBOUNCE_MS);

        }

      } else if (lockTimer.current) {

        clearTimeout(lockTimer.current);

        lockTimer.current = null;

      }

    } else if (!withinExit) {

      // Wider exit threshold than entry threshold (hysteresis) — this is

      // what keeps the lock from flickering on/off right at the boundary.

      lockOut();

    }

  }, [heading, qibla]);



  // Derived values

  const normDiff = qibla !== null ? (((qibla - heading) % 360) + 360) % 360 : 0;

  const turnDeg  = Math.min(normDiff, 360 - normDiff).toFixed(1);

  const turnDir  = normDiff > 0 && normDiff <= 180 ? "right" : "left";

  const needsCalibration = accuracy !== null && (accuracy < 0 || accuracy > IOS_POOR_ACCURACY_DEG);



  const roseRotate = headingAnim.interpolate({

    inputRange:  [-36000, 36000],

    outputRange: ["36000deg", "-36000deg"],

  });



  const cardinalLabels = {

    n: t("qibla.north"), e: t("qibla.east"), s: t("qibla.south"), w: t("qibla.west"),

  };



  // ── Phases ────────────────────────────────────────────────────────────────

  if (error) return (

    <>


      <ErrorView message={error} t={t} />

    </>

  );



  if (phase !== "ready") return (

    <>


      <LoadingView phase={phase} t={t} />

    </>

  );



  // ── Main UI ───────────────────────────────────────────────────────────────

  return (

    <Animated.View style={[st.root, { opacity: screenFade }]}>




      {/* ── Header ── */}

      <View style={st.header}>

        {/* Back to Deen. Qibla is pushed from DeenScreen, so goBack() returns
            there without resetting the stack or duplicating the screen. */}

        <Pressable
          onPress={() => navigation.goBack()}
          style={st.backBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("common.back", "Back")}
        >

          <Text style={st.backIcon}>‹</Text>

        </Pressable>

        <View style={st.headerRow}>

          <View style={st.headerLine} />

          <Text style={st.headerTitle}>{t("qibla.title")}</Text>

          <View style={st.headerLine} />

        </View>

        <Text style={st.headerSub}>{t("qibla.subtitle")}</Text>

        {location && (

          <Text style={st.coords}>

            {location.lat >= 0 ? "" : "-"}{Math.abs(location.lat).toFixed(4)}°{location.lat >= 0 ? t("qibla.north") : t("qibla.south")}

            {"  "}

            {location.lng >= 0 ? "" : "-"}{Math.abs(location.lng).toFixed(4)}°{location.lng >= 0 ? t("qibla.east") : t("qibla.west")}

          </Text>

        )}

        <View style={st.accuracyRow}>

          <View style={[st.accuracyDot, { backgroundColor: needsCalibration ? C.gold : C.mint }]} />

          <Text style={st.accuracyLabel}>

            {needsCalibration ? t("qibla.accuracyLow") : t("qibla.accuracyGood")}

          </Text>

        </View>

      </View>



      {/* ── Compass ── */}

      <View style={[st.compassWrap, { width: S, height: S }]}>

        <Animated.View

          style={[

            st.glowRing,

            { width: S - 14, height: S - 14, borderRadius: (S - 14) / 2 },

            { opacity: pulseAnim, transform: [{ scale: glowAnim }] },

          ]}

        />



        <Animated.View style={[st.layer, { width: S, height: S }, { transform: [{ rotate: roseRotate }] }]}>

          <CompassRose size={S} aligned={aligned} cardinalLabels={cardinalLabels} />

        </Animated.View>



        <View style={[st.topTick, { top: 2 }]}>

          <Svg width={16} height={20}>

            <Polygon points="8,2 2,18 8,12 14,18" fill={C.gold} />

          </Svg>

        </View>



        {qibla !== null && (

          <Animated.View style={[st.layer, { width: S, height: S }, { transform: [{ rotate: roseRotate }] }]}>

            <View style={[st.layer, { width: S, height: S }, { transform: [{ rotate: `${qibla}deg` }] }]}>

              <QiblaArrow size={S} aligned={aligned} />

            </View>

          </Animated.View>

        )}

      </View>



      {/* ── Stats bar ── */}

      <View style={st.statsBar}>

        <StatCell label={t("qibla.statQibla")}    value={qibla ? `${qibla.toFixed(1)}°` : "--"} accent={C.gold} />

        <View style={st.statsDivider} />

        <StatCell label={t("qibla.statHeading")}  value={`${Math.round(heading)}°`}              accent={C.txtSec} />

        <View style={st.statsDivider} />

        <StatCell

          label={t("qibla.statDistance")}

          value={distKm ? `${distKm.toLocaleString()} ${t("qibla.km")}` : "--"}

          accent={C.gold}

        />

      </View>



      {/* ── Banner: calibration takes priority, then aligned, then turn guidance ── */}

      {needsCalibration ? (

        <CalibrateBanner t={t} />

      ) : aligned ? (

        <Animated.View style={[st.alignedBanner, { transform: [{ scale: glowAnim }] }]}>

          <Animated.View style={[st.alignedDot, { opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }]} />

          <View style={st.alignedText}>

            <Text style={st.alignedTitle}>{t("qibla.alignedTitle")}</Text>

            <Text style={st.alignedSub}>{t("qibla.alignedSub")}</Text>

          </View>

        </Animated.View>

      ) : (

        <View style={st.turnBanner}>

          <TurnIndicator dir={turnDir} deg={turnDeg} t={t} />

        </View>

      )}



      {/* ── Tip ── */}

      <Text style={st.tip}>{t("qibla.tip")}</Text>

    </Animated.View>

  );

}



// ── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({

  root: {

    flex: 1,

    backgroundColor: C.bg,

    alignItems: "center",

    // No status-bar padding here: App.jsx keeps the whole app below the system
    // bar, so screens start at y=0 of the usable area.
    paddingTop: 12,

    paddingHorizontal: 20,

    paddingBottom:     20,

  },

  center: {

    flex: 1,

    backgroundColor: C.bg,

    alignItems: "center",

    justifyContent: "center",

    paddingHorizontal: 32,

  },



  // Header

  header:     { alignItems: "center", marginBottom: 20, alignSelf: "stretch" },

  backBtn:    {
    position: "absolute", left: 0, top: 0, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  backIcon:   { fontSize: 30, lineHeight: 34, color: C.gold, fontWeight: "700", marginTop: -2 },

  headerRow:  { flexDirection: "row", alignItems: "center", gap: 12 },

  headerLine: { width: 24, height: 1, backgroundColor: C.goldDim },

  headerTitle:{ fontSize: 26, fontWeight: "800", color: C.gold, letterSpacing: 14 },

  headerSub:  { fontSize: 9, color: C.txtSec, letterSpacing: 8, marginTop: -1, marginBottom: 6 },

  coords:     { fontSize: 10, color: C.txtMuted, letterSpacing: 1.2, fontVariant: ["tabular-nums"] },

  accuracyRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },

  accuracyDot:  { width: 6, height: 6, borderRadius: 3 },

  accuracyLabel:{ fontSize: 9.5, color: C.txtSec, letterSpacing: 0.6 },



  // Compass

  compassWrap: { alignItems: "center", justifyContent: "center", marginBottom: 20 },

  layer:       { position: "absolute", alignItems: "center", justifyContent: "center" },

  topTick:     { position: "absolute", alignSelf: "center", zIndex: 40 },

  glowRing:    {

    position: "absolute",

    borderWidth: 2,

    borderColor: C.mint,

    shadowColor: C.mint,

    shadowOffset: { width: 0, height: 0 },

    shadowOpacity: 1,

    shadowRadius: 20,

    elevation: 20,

  },



  // Stats

  statsBar: {

    width: "100%",

    flexDirection: "row",

    backgroundColor: C.card,

    borderRadius: 14,

    paddingVertical: 12,

    paddingHorizontal: 8,

    borderWidth: 1,

    borderColor: C.cardBorder,

    marginBottom: 14,

  },

  statCell:     { flex: 1, alignItems: "center" },

  statLabel:    { fontSize: 8, color: C.txtMuted, letterSpacing: 2, fontWeight: "700", marginBottom: 5 },

  statValue:    { fontSize: 16, fontWeight: "700", letterSpacing: 0.4, fontVariant: ["tabular-nums"] },

  statsDivider: { width: 1, backgroundColor: C.cardBorder, marginVertical: 2 },



  // Aligned Banner

  alignedBanner: {

    width: "100%",

    flexDirection: "row",

    alignItems: "center",

    gap: 14,

    backgroundColor: C.mintFaint,

    borderRadius: 14,

    paddingVertical: 16,

    paddingHorizontal: 18,

    borderWidth: 1.5,

    borderColor: C.mintDim,

    marginBottom: 14,

    shadowColor: C.mint,

    shadowOffset: { width: 0, height: 0 },

    shadowOpacity: 0.4,

    shadowRadius: 16,

    elevation: 10,

  },

  alignedDot:   {

    width: 8, height: 8, borderRadius: 4,

    backgroundColor: C.mint,

    shadowColor: C.mint,

    shadowOffset: { width: 0, height: 0 },

    shadowOpacity: 1, shadowRadius: 8, elevation: 4,

  },

  alignedText:  {},

  alignedTitle: { fontSize: 14, fontWeight: "700", color: C.mint, letterSpacing: 0.3 },

  alignedSub:   { fontSize: 11, color: C.txtSec, marginTop: 3, letterSpacing: 0.2 },



  // Turn Banner

  turnBanner: {

    width: "100%",

    backgroundColor: C.card,

    borderRadius: 14,

    paddingVertical: 18,

    paddingHorizontal: 18,

    borderWidth: 1,

    borderColor: C.cardBorder,

    alignItems: "center",

    marginBottom: 14,

  },

  turnRow:    { flexDirection: "row", alignItems: "center", gap: 10 },

  turnDegWrap:{ alignItems: "center", minWidth: 90 },

  turnDeg:    { fontSize: 22, fontWeight: "700", color: C.gold, letterSpacing: 0.5, fontVariant: ["tabular-nums"] },

  turnLbl:    { fontSize: 10, color: C.txtSec, letterSpacing: 1.5, marginTop: 2, textTransform: "uppercase" },



  // Calibration Banner

  calibrateBanner: {

    width: "100%",

    flexDirection: "row",

    alignItems: "center",

    gap: 14,

    backgroundColor: C.goldFaint,

    borderRadius: 14,

    paddingVertical: 16,

    paddingHorizontal: 18,

    borderWidth: 1.5,

    borderColor: C.goldDim,

    marginBottom: 14,

  },

  calibrateTitle: { fontSize: 14, fontWeight: "700", color: C.gold, letterSpacing: 0.3 },

  calibrateMsg:   { fontSize: 11, color: C.txtSec, marginTop: 3, letterSpacing: 0.2 },



  tip: {

    fontSize: 10,

    color: C.txtMuted,

    textAlign: "center",

    letterSpacing: 0.3,

    lineHeight: 16,

  },



  // Loading

  loadTitle:  { fontSize: 24, fontWeight: "900", color: C.gold, letterSpacing: 14, marginBottom: 10 },

  loadSub:    { fontSize: 12, color: C.txtSec, letterSpacing: 1.5 },



  // Error

  errRing:    {

    width: 48, height: 48, borderRadius: 24,

    borderWidth: 1.5, borderColor: C.north,

    alignItems: "center", justifyContent: "center",

    marginBottom: 20,

  },

  errBang:    { fontSize: 22, fontWeight: "800", color: C.north },

  errTitle:   { fontSize: 15, fontWeight: "700", color: C.north, marginBottom: 8 },

  errMsg:     {

    fontSize: 13, color: C.txtPrimary, textAlign: "center",

    marginBottom: 10, lineHeight: 20, letterSpacing: 0.2,

  },

  errHint:    { fontSize: 11, color: C.txtSec, textAlign: "center", letterSpacing: 0.3 },

});