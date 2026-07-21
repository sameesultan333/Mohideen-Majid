import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ScrollView,
  Platform,
  StatusBar,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import Svg, { Rect, Defs, LinearGradient, Stop, Path } from "react-native-svg";
import { formatCoveredMonths, formatServerDateTime } from "../utils/datetime";
import { getWsUrl } from "../config/server";
import { useIsFocused } from "@react-navigation/native";
import { COLORS as C, RADII, SPACING, FONTS } from "../config/theme";
import { useTranslation } from "react-i18next";

const { width } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
const STATUSBAR_HEIGHT = IOS ? 48 : (StatusBar.currentHeight || 0) + 6;
const HEADER_H = 116;
const MAX_ATTEMPTS = 5;

// ─── Palette — same shared theme as Profile/Donation/Collector, not the
// screen's previous one-off mint-green palette. ─────────────────────────
const G = {
  bg:        "#FBF9F4",
  card:      C.white,
  cardBorder:"rgba(212,175,55,0.16)",
  headerDeep: C.bg,
  headerLight: C.bgVivid,
  gold:      C.gold,
  goldDeep:  C.goldDeep,
  goldLight: C.goldLight,
  textDark:  C.textDark,
  textMuted: C.textMuted,
  white:     C.white,
  success:   C.bgVivid,
  successBg: "rgba(14,107,69,0.1)",
  warn:      "#9A6B2E",
  warnBg:    "rgba(154,107,46,0.12)",
  error:     C.error,
  errorBg:   C.errorBg,
};

const cardShadow = (y = 10, opacity = 0.09) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.8 },
    android: { elevation: y },
  });

// ─── Header pattern (same motif as Profile/Donation/Collector headers) ──
const HeaderPattern = ({ w = width, h = HEADER_H }) => {
  const step = 40;
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const stars = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * step + (r % 2 === 0 ? 0 : step / 2);
      const cy = r * step;
      stars.push(`M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`);
    }
  }
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      {stars.map((d, i) => (
        <Path key={i} d={d} fill={G.gold} opacity={0.06} />
      ))}
    </Svg>
  );
};

// ─── WebSocket Hook ───────────────────────────────────────────────────────────
const useReceiptWebSocket = (receiptId, onUpdate) => {
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const attempts = useRef(0);
  const isMounted = useRef(false);
  const connectingRef = useRef(false); // hard lock against parallel connects
  const onUpdateRef = useRef(onUpdate);

  const [wsStatus, setWsStatus] = useState("idle");

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const cleanup = () => {
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (_) {}
    }

    wsRef.current = null;
    connectingRef.current = false;
  };

  const connect = useCallback(async () => {
    if (!receiptId || !isMounted.current) return;

    if (connectingRef.current) return;
    connectingRef.current = true;

    clearTimeout(reconnectTimer.current);

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      connectingRef.current = false;
      return;
    }

    try {
      const url = await getWsUrl(`/ws/receipts/${receiptId}`);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted.current) return;

        setWsStatus("open");
        attempts.current = 0;
        connectingRef.current = false;

        ws.send(
          JSON.stringify({
            type: "subscribe",
            receipt_id: receiptId,
          })
        );
      };

      ws.onmessage = (e) => {
        if (!isMounted.current) return;

        try {
          const data = JSON.parse(e.data);

          if (data?.type === "receipt_update") {
            onUpdateRef.current?.(data.payload);
          }
        } catch (_) {}
      };

      ws.onerror = () => {
        if (!isMounted.current) return;
        setWsStatus("error");
      };

      ws.onclose = () => {
        if (!isMounted.current) return;

        setWsStatus("closed");
        connectingRef.current = false;

        if (attempts.current < MAX_ATTEMPTS) {
          const delay = Math.min(1000 * 2 ** attempts.current, 15000);

          reconnectTimer.current = setTimeout(() => {
            attempts.current += 1;
            connect();
          }, delay);
        }
      };
    } catch (_) {
      connectingRef.current = false;
      if (isMounted.current) setWsStatus("error");
    }
  }, [receiptId]);

  useEffect(() => {
    if (!receiptId) {
      cleanup();
      setWsStatus("idle");
      return;
    }

    isMounted.current = true;
    setWsStatus("connecting");

    connect();

    return () => {
      isMounted.current = false;
      cleanup();
    };
  }, [receiptId]);

  return { wsStatus };
};

// ─── Config — mapped onto the shared theme's semantic colors ────────────
const STATUS_CFG = {
  verified : { color: G.success, bg: G.successBg, label: (t) => t("receipt.status.verified") },
  pending  : { color: G.warn,    bg: G.warnBg,     label: (t) => t("receipt.status.pending")  },
  failed   : { color: G.error,   bg: G.errorBg,    label: (t) => t("receipt.status.failed")   },
};

const WS_COLOR = {
  open       : G.success,
  connecting : G.warn,
  closed     : G.error,
  error      : G.error,
};

// ─── Pulse hook ───────────────────────────────────────────────────────────────
const usePulse = (active) => {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { anim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.15, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);
  return anim;
};

// ─── WS Badge ─────────────────────────────────────────────────────────────────
const WSBadge = ({ status }) => {
  const { t } = useTranslation();
  const dotOpacity = usePulse(status === "open");
  const color = WS_COLOR[status] || WS_COLOR.error;
  const label =
    status === "open"       ? t("receipt.ws.live")        :
    status === "connecting" ? t("receipt.ws.connecting")  : t("receipt.ws.offline");

  return (
    <View style={[styles.wsBadge, { borderColor: color + "44" }]}>
      <Animated.View style={[styles.wsDot, { backgroundColor: color, opacity: dotOpacity }]} />
      <Text style={[styles.wsText, { color }]}>{label}</Text>
    </View>
  );
};

// ─── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const { t } = useTranslation();
  const cfg        = STATUS_CFG[status] || STATUS_CFG.pending;
  const dotOpacity = usePulse(status !== "verified");

  return (
    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
      <Animated.View style={[styles.statusDot, { backgroundColor: cfg.color, opacity: dotOpacity }]} />
      <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label(t)}</Text>
    </View>
  );
};

// ─── Detail Row ───────────────────────────────────────────────────────────────
const DetailRow = ({ label, value, mono, delay = 0, last = false }) => {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 340, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 340, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.detailRow,
        last && { borderBottomWidth: 0 },
        { opacity, transform: [{ translateY }] },
      ]}
    >
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[styles.detailValue, mono && styles.detailMono]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </Animated.View>
  );
};

// ─── Timeline Row ─────────────────────────────────────────────────────────────
const TimeRow = ({ label, value, done = false, delay = 0 }) => {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(-10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 320, delay, useNativeDriver: true }),
      Animated.timing(translateX, { toValue: 0, duration: 320, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.timeRow, { opacity, transform: [{ translateX }] }]}>
      <View style={[styles.timeDot, done && styles.timeDotDone]} />
      <Text style={styles.timeLabel}>{label}</Text>
      <Text style={[styles.timeValue, done && styles.timeValueDone]}>{value}</Text>
    </Animated.View>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
const ReceiptScreen = ({ route, navigation }) => {
  const { t } = useTranslation();
  const { payment: init } = route.params;
  const [payment, setPayment] = useState(init);
  const isFocused = useIsFocused();
  // Entrance anims
  const screenFade    = useRef(new Animated.Value(0)).current;
  const headerY       = useRef(new Animated.Value(-18)).current;
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const cardY         = useRef(new Animated.Value(32)).current;
  const cardOpacity   = useRef(new Animated.Value(0)).current;
  const amountScale   = useRef(new Animated.Value(0.68)).current;
  const amountOpacity = useRef(new Animated.Value(0)).current;
  const hintOpacity   = useRef(new Animated.Value(0)).current;
  const hintY         = useRef(new Animated.Value(10)).current;
  const shimmerX      = useRef(new Animated.Value(-120)).current;

  const { wsStatus } = useReceiptWebSocket(
  isFocused ? payment?.receipt_id : null,
  (updated) => setPayment(prev => ({ ...prev, ...updated }))
);

  useEffect(() => {
    StatusBar.setBarStyle("light-content", true);
    if (Platform.OS === "android") StatusBar.setBackgroundColor(G.headerDeep);

    const shimmerLoop = Animated.loop(
      Animated.timing(shimmerX, {
        toValue: width + 120,
        duration: 1600,
        useNativeDriver: true,
      })
    );

    Animated.sequence([
      Animated.timing(screenFade, { toValue: 1, duration: 240, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
        Animated.timing(headerY,       { toValue: 0, duration: 360, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(cardOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(cardY, { toValue: 0, friction: 9, tension: 65, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(amountOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(amountScale,   { toValue: 1, friction: 5,  tension: 72, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(hintOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.timing(hintY,       { toValue: 0, duration: 380, useNativeDriver: true }),
      ]),
    ]).start(() => shimmerLoop.start());

    return () => shimmerLoop.stop();
  }, []);

  const cfg = STATUS_CFG[payment.status] || STATUS_CFG.pending;

  return (
    <Animated.View style={[styles.screen, { opacity: screenFade }]}>
      <StatusBar barStyle="light-content" backgroundColor={G.headerDeep} />

      {/* ── Header — same gradient + gold star pattern as Profile/Donation ── */}
      <Animated.View
        style={[
          styles.header,
          { opacity: headerOpacity, transform: [{ translateY: headerY }] },
        ]}
      >
        <Svg width={width} height={HEADER_H} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="receiptHeaderGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={G.headerDeep} />
              <Stop offset="100%" stopColor={G.headerLight} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={width} height={HEADER_H} fill="url(#receiptHeaderGrad)" />
        </Svg>
        <HeaderPattern w={width} h={HEADER_H} />

        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.reset({ index: 0, routes: [{ name: "Home" }] })}
            style={styles.backBtn}
            activeOpacity={0.85}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>Mohideen Masjid</Text>
            <Text style={styles.headerTitle}>{t("receipt.headerTitle")}</Text>
          </View>

          <WSBadge status={wsStatus} />
        </View>
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces
      >
        {/* ── Card */}
        <Animated.View
          style={[
            styles.card,
            { opacity: cardOpacity, transform: [{ translateY: cardY }] },
          ]}
        >
          {/* Accent strip + shimmer */}
          <View style={[styles.accentStrip, { backgroundColor: cfg.color }]}>
            <Animated.View
              style={[styles.shimmerBar, { transform: [{ translateX: shimmerX }] }]}
            />
          </View>

          {/* ── Amount */}
          <Animated.View
            style={[
              styles.amountBlock,
              { opacity: amountOpacity, transform: [{ scale: amountScale }] },
            ]}
          >
            <Text style={styles.amountEyebrow}>{t("receipt.amountPaid")}</Text>
            <View style={styles.amountRow}>
              <Text style={styles.amountCurrency}>₹</Text>
              <Text style={styles.amountFigure}>
                {Number(payment.amount).toLocaleString("en-IN")}
              </Text>
            </View>
            <StatusBadge status={payment.status} />
          </Animated.View>

          {/* ── Divider */}
          <View style={styles.divider} />

          {/* ── Transaction Details */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("receipt.transactionDetails")}</Text>
            <DetailRow
              label={t("receipt.fields.receiptId")}
              value={payment.receipt_id || t("receipt.notAvailable")}
              mono
              delay={60}
            />
            {payment.transaction_ref ? (
              <DetailRow
                label={t("receipt.fields.transactionId")}
                value={payment.transaction_ref}
                mono
                delay={75}
              />
            ) : null}
            <DetailRow
              label={t("receipt.fields.purpose")}
              value={payment.purpose || payment.note || t("receipt.defaultPurpose")}
              delay={90}
            />
            <DetailRow
              label={t("receipt.fields.method")}
              value={(payment.method || "UPI").toUpperCase()}
              delay={120}
            />
            <DetailRow
              label={t("receipt.fields.paidBy")}
              value={payment.payer_name || t("receipt.notAvailable")}
              delay={150}
            />
            <DetailRow
              label={t("receipt.fields.address")}
              value={payment.address || t("receipt.notAvailable")}
              delay={180}
              last
            />
          </View>

          {/* ── Divider */}
          <View style={styles.divider} />

          {/* ── Timeline */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("receipt.timeline")}</Text>
            <View style={styles.timelineContainer}>
              <View style={styles.timelineTrack} />
              <View style={styles.timelineRows}>
                <TimeRow
                  label={t("receipt.timelineLabels.recorded")}
                  value={formatServerDateTime(payment.created_at)}
                  done
                  delay={60}
                />
                <TimeRow
                  label={payment.created_by === "user" ? t("receipt.timelineLabels.submitted") : t("receipt.timelineLabels.collected")}
                  value={
                    payment.created_by === "user"
                      ? formatServerDateTime(payment.created_at)
                      : payment.collected_at
                        ? formatServerDateTime(payment.collected_at)
                        : payment.status === "verified"
                          ? formatServerDateTime(payment.created_at)
                          : t("receipt.timelineLabels.pendingValue")
                  }
                  done={
                    payment.created_by === "user"
                      ? true
                      : payment.status === "verified" || !!payment.collected_at
                  }
                  delay={100}
                />
                <TimeRow
                  label={t("receipt.timelineLabels.verified")}
                  value={
                    payment.verified_at
                      ? formatServerDateTime(payment.verified_at)
                      : payment.status === "verified"
                        ? formatServerDateTime(payment.created_at)
                        : t("receipt.timelineLabels.pendingValue")
                  }
                  done={payment.status === "verified"}
                  delay={140}
                />
                {payment.covered_months?.length ? (
                  <TimeRow
                    label={`${t("receipt.timelineLabels.coveredPrefix")} (${payment.covered_months.length})`}
                    value={formatCoveredMonths(payment.covered_months)}
                    done
                    delay={180}
                  />
                ) : null}
                {payment.collected_by ? (
                  <TimeRow
                    label={t("receipt.timelineLabels.recordedBy")}
                    value={payment.collected_by}
                    done
                    delay={220}
                  />
                ) : null}
              </View>
            </View>
          </View>

          {/* ── Covered months block (chanda only) */}
          {payment.covered_months?.length > 0 && (
            <>
              <View style={styles.divider} />
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t("receipt.monthsCovered")}</Text>
                <View style={styles.monthGrid}>
                  {payment.covered_months.map((ym, i) => {
                    const [y, m] = ym.split("-");
                    const label = new Date(Number(y), Number(m) - 1, 1)
                      .toLocaleDateString("en-IN", { month: "short", year: "numeric" });
                    return (
                      <View key={ym} style={styles.monthChip}>
                        <Text style={styles.monthChipTxt}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
                {payment.status === "pending" && (
                  <Text style={styles.coveredNote}>
                    {t("receipt.coveredNotePending")}
                  </Text>
                )}
                {payment.status === "verified" && (
                  <Text style={[styles.coveredNote, { color: G.success }]}>
                    ✓  {t("receipt.coveredNoteVerified")}
                  </Text>
                )}
              </View>
            </>
          )}

          {/* ── Card footer */}
          <View style={styles.cardFooter}>
            <View style={styles.perforationRow}>
              {Array.from({ length: 24 }).map((_, i) => (
                <View key={i} style={styles.perforationDot} />
              ))}
            </View>
            <Text style={styles.footerText}>{t("receipt.footerVerified")}</Text>
          </View>
        </Animated.View>

        {/* ── Screenshot hint */}
        <Animated.View
          style={[
            styles.hint,
            { opacity: hintOpacity, transform: [{ translateY: hintY }] },
          ]}
        >
          <View style={styles.hintRule} />
          <Text style={styles.hintText}>{t("receipt.screenshotHint")}</Text>
          <View style={styles.hintRule} />
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
};

export default ReceiptScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: G.bg,
  },

  // Header — gradient + gold star pattern, same corner radius (24) and
  // shadow treatment as Profile/Donation for cross-screen consistency.
  header: {
    height: HEADER_H,
    paddingTop: STATUSBAR_HEIGHT,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...cardShadow(8, 0.16),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADII.sm,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1, borderColor: "rgba(212,175,55,0.4)",
    justifyContent: "center", alignItems: "center",
    marginRight: 14,
  },
  backArrow: { color: G.gold, fontSize: 18, lineHeight: 20 },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.65)",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: G.gold,
    letterSpacing: -0.3,
    fontFamily: FONTS.display,
  },

  // WS Badge
  wsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  wsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  wsText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  scroll: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 56,
  },

  // Card
  card: {
    backgroundColor: G.card,
    borderRadius: RADII.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: G.cardBorder,
    ...cardShadow(14, 0.09),
  },

  // Accent strip
  accentStrip: {
    height: 5,
    overflow: "hidden",
  },
  shimmerBar: {
    position: "absolute",
    top: 0,
    width: 100,
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.5)",
    transform: [{ skewX: "-20deg" }],
  },

  // Amount
  amountBlock: {
    alignItems: "center",
    paddingTop: 30,
    paddingBottom: 24,
  },
  amountEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    color: G.textMuted,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
    marginBottom: 16,
  },
  amountCurrency: {
    fontSize: 22,
    fontWeight: "800",
    color: G.gold,
    marginBottom: 10,
  },
  amountFigure: {
    fontSize: 54,
    fontWeight: "900",
    color: G.textDark,
    letterSpacing: -2.5,
    lineHeight: 60,
  },

  // Status badge
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 22,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: G.cardBorder,
    marginHorizontal: 24,
  },

  // Section
  section: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 18,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: G.goldDeep,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginBottom: 14,
    fontFamily: FONTS.display,
  },

  // Detail rows
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: G.cardBorder,
    gap: 20,
  },
  detailLabel: {
    fontSize: 13,
    color: G.textMuted,
    fontWeight: "500",
    minWidth: 84,
  },
  detailValue: {
    flex: 1,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "700",
    color: G.textDark,
    letterSpacing: -0.1,
  },
  detailMono: {
    fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace",
    fontSize: 11,
    letterSpacing: 0.6,
    color: G.goldDeep,
  },

  // Timeline
  timelineContainer: {
    flexDirection: "row",
  },
  timelineTrack: {
    width: 1,
    backgroundColor: "rgba(212,175,55,0.25)",
    marginLeft: 7,
    marginRight: 0,
    borderRadius: 1,
  },
  timelineRows: {
    flex: 1,
    marginLeft: 0,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
    paddingLeft: 0,
  },
  timeDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "rgba(212,175,55,0.3)",
    marginLeft: -11,
    borderWidth: 1.5,
    borderColor: G.bg,
  },
  timeDotDone: {
    backgroundColor: G.gold,
    borderColor: "rgba(212,175,55,0.18)",
  },
  timeLabel: {
    fontSize: 12,
    color: G.textMuted,
    fontWeight: "500",
    width: 84,
  },
  timeValue: {
    flex: 1,
    textAlign: "right",
    fontSize: 12,
    fontWeight: "600",
    color: G.textMuted,
    letterSpacing: -0.1,
  },
  timeValueDone: {
    color: G.textDark,
  },

  // Card footer
  cardFooter: {
    alignItems: "center",
    paddingVertical: 18,
    gap: 10,
  },
  perforationRow: {
    flexDirection: "row",
    gap: 5,
    overflow: "hidden",
  },
  perforationDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: G.cardBorder,
  },
  footerText: {
    fontSize: 10,
    color: G.goldDeep,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  // Month chips (covered months) — gold pale, matching FIXED/FUND badges
  // used elsewhere in the app rather than the previous mint-green chips.
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  monthChip: {
    backgroundColor: "rgba(212,175,55,0.14)",
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.3)",
  },
  monthChipTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: G.goldDeep,
  },
  coveredNote: {
    fontSize: 11,
    color: G.textMuted,
    lineHeight: 16,
  },

  // Screenshot hint
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 24,
    paddingHorizontal: 4,
  },
  hintRule: {
    flex: 1,
    height: 1,
    backgroundColor: G.cardBorder,
  },
  hintText: {
    fontSize: 11,
    color: G.textMuted,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
});