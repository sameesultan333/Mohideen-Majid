import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, TextInput, StatusBar, Platform, Animated, ScrollView, Linking, Alert, Easing, Dimensions, TouchableOpacity } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getToken } from "../utils/secureStorage";
import { useFocusEffect } from "@react-navigation/native";
import { launchImageLibrary } from "react-native-image-picker";
import Svg, { Rect, Defs, LinearGradient, Stop, Path } from "react-native-svg";
import { authApiFetch, apiFetch, getWsUrl } from "../config/server";
import { COLORS as C, RADII, SPACING, FONTS } from "../config/theme";
import { useTranslation } from "react-i18next";
import Clipboard from "@react-native-clipboard/clipboard";

const { width } = Dimensions.get("window");

// Cache key for "load last data" behavior — hydrated on mount before any
// network call resolves, so a warm start shows the last known chanda
// status / unpaid months / recent payments instantly instead of blank
// placeholders while the network round-trip is in flight.
const DONATION_CACHE_PREFIX = "donation_screen_cache_v1";
const CACHE_MONTHLY = `${DONATION_CACHE_PREFIX}_monthly`;
const CACHE_UNPAID  = `${DONATION_CACHE_PREFIX}_unpaid`;
const CACHE_RECENT  = `${DONATION_CACHE_PREFIX}_recent`;
const CACHE_UPI     = `${DONATION_CACHE_PREFIX}_upi`;
const CACHE_FUNDS   = `${DONATION_CACHE_PREFIX}_funds`;

// ─── Colors — pulled from the shared theme (richer emerald + true
// metallic gold) so this screen reads as the same app as Home/Prayer/
// Collector/Profile, rather than a one-off palette. ─────────────────────
const G = {
  bg:          "#FBF9F4",        // warm ivory, matches Home/Prayer/Collector/Profile
  deep:        C.bg,             // deep emerald
  deepLight:   C.bgVivid,        // vivid mid-emerald, used for gradients
  gold:        C.gold,
  goldLight:   C.goldLight,
  goldPale:    "rgba(212,175,55,0.14)",
  goldDeep:    C.goldDeep,
  white:       C.white,
  textDark:    C.textDark,
  textMuted:   C.textMuted,
  // Soft gold hairline for ordinary card borders — C.border is a strong,
  // high-opacity gold meant for emphasis (rings, selected states), not for
  // outlining every card, so it's dimmed down for general use here.
  border:      "rgba(212,175,55,0.16)",
  ring:        C.border,
  warn:        "#9A6B2E",
  warnBg:      "rgba(154,107,46,0.12)",
  error:       C.error,
  errorBg:     C.errorBg,
  success:     C.bgVivid,
  successBg:   "rgba(14,107,69,0.1)",
};

const shadow = (y = 4, opacity = 0.07) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.5 },
    android: { elevation: y },
  });

// ─── Static purposes (Kanji/Sadaqah removed) — label/desc now sourced
// from t() rather than hardcoded, built lazily inside the component so
// the strings update immediately if the user switches language. ────────
const buildStaticPurposes = (t) => ([
  {
    key: "Monthly Chanda",
    label: t("donation.purposes.chanda.label"),
    desc: t("donation.purposes.chanda.desc"),
    icon: "M",
    locked: true,
    fund_id: null,
  },
  {
    key: "Donation",
    label: t("donation.purposes.donation.label"),
    desc: t("donation.purposes.donation.desc"),
    icon: "D",
    locked: false,
    fund_id: null,
  },
]);

// Mosque / payee name is data, not UI copy — it stays as the actual
// entity name regardless of locale, so it is intentionally not run
// through t(). Used as the starting value before /finance/settings/public
// resolves (and as the value if the admin never configures it), so the
// UPI button works correctly from a fresh install rather than being
// silently disabled until an admin visits Settings.
const MOSQUE_UPI_ID_DEFAULT = "PPQR01.LHXWZU@iob";
const MOSQUE_PAYEE_NAME_DEFAULT = "K K D NAGAR MOHIDEEN MASJID AND MADARASA";
const normalizeRole = (r) => (r || "").toString().trim().toLowerCase();
const SUPERADMIN_ROLES = ["superadmin", "super_admin", "super admin"];
const canAccessPay = (role) => {
  const r = normalizeRole(role);
  return r === "head" || r === "collector" || SUPERADMIN_ROLES.includes(r);
};

// ─── Month label helper ───────────────────────────────────────────────────────
const fmtMonth = (ym) => {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const monthWord = (n, t) => (n === 1 ? t("donation.month") : t("donation.monthsPlural"));

// ─── Header pattern (same motif used on Home/Prayer/Collector/Profile headers) ──
const HeaderPattern = React.memo(({ w, h }) => {
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
});

// ─── Unpaid months strip ──────────────────────────────────────────────────────
const UnpaidStrip = React.memo(({ months }) => {
  const { t } = useTranslation();
  if (!months || months.length === 0) return null;
  const total = months.reduce((s, m) => s + m.balance, 0);
  return (
    <View style={styles.unpaidCard}>
      <View style={styles.unpaidHeader}>
        <View style={styles.unpaidDot} />
        <Text style={styles.unpaidTitle}>{t("donation.outstandingBalance")}</Text>
        <Text style={styles.unpaidTotal}>₹{total.toFixed(0)}</Text>
      </View>
      <Text style={styles.unpaidSub}>
        {months.length} {monthWord(months.length, t)} {t("donation.monthsDueLabel")}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthRow} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
        {months.map((m, i) => (
          <View key={m.month} style={[styles.monthChip, i === 0 && styles.monthChipFirst]}>
            <Text style={[styles.monthChipLabel, i === 0 && styles.monthChipLabelFirst]}>{fmtMonth(m.month)}</Text>
            <Text style={[styles.monthChipAmt, i === 0 && styles.monthChipAmtFirst]}>₹{m.balance}</Text>
            {i === 0 && <Text style={styles.monthChipNext}>← {t("donation.payFirst")}</Text>}
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

// ─── Purpose card ─────────────────────────────────────────────────────────────
const PurposeCard = React.memo(({ item, selected, onPress }) => {
  const { t } = useTranslation();
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 30 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} activeOpacity={1}
        style={[styles.purposeCard, selected && styles.purposeCardSel]}>
        <View style={[styles.purposeIcon, selected && styles.purposeIconSel]}>
          <Text style={[styles.purposeIconTxt, selected && styles.purposeIconTxtSel]}>{item.icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.purposeLabel, selected && styles.purposeLabelSel]}>{item.label}</Text>
          <Text style={styles.purposeDesc}>{item.desc}</Text>
        </View>
        {item.locked && (
          <View style={styles.fixedBadge}><Text style={styles.fixedBadgeTxt}>{t("donation.fixedBadge")}</Text></View>
        )}
        {item.fund_id && (
          <View style={[styles.fixedBadge, { backgroundColor: G.successBg }]}>
            <Text style={[styles.fixedBadgeTxt, { color: G.success }]}>{t("donation.fundBadge")}</Text>
          </View>
        )}
        {selected && <View style={styles.checkRing}><View style={styles.checkDot} /></View>}
      </TouchableOpacity>
    </Animated.View>
  );
});

// ─── Recent row ───────────────────────────────────────────────────────────────
const RecentRow = React.memo(({ item }) => {
  const { t } = useTranslation();
  const isPending  = item.status === "pending";
  const isRejected = item.status === "rejected";
  const color = isRejected ? G.error : isPending ? G.warn : G.success;
  const bg    = isRejected ? G.errorBg : isPending ? G.warnBg : G.successBg;
  const label = isRejected ? t("donation.status.rejected") : isPending ? t("donation.status.pending") : t("donation.status.verified");
  const coveredLabel = item.covered_months?.length
    ? item.covered_months.map(fmtMonth).join(", ")
    : null;

  return (
    <View style={styles.recentRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.recentPurpose}>{item.purpose}</Text>
        {coveredLabel && <Text style={styles.recentCovered}>{t("donation.covers")} {coveredLabel}</Text>}
        <Text style={styles.recentDate}>
          {item.created_at ? (() => {
            const s = String(item.created_at);
            const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z";
            return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
          })() : "—"}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.recentAmount}>₹{item.amount}</Text>
        <View style={[styles.recentPill, { backgroundColor: bg }]}>
          <Text style={[styles.recentPillTxt, { color }]}>{label}</Text>
        </View>
      </View>
    </View>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function DonationScreen({ navigation }) {
  const { t } = useTranslation();
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const slideAnim  = useRef(new Animated.Value(20)).current;
  const btnScale   = useRef(new Animated.Value(1)).current;

  const STATIC_PURPOSES = useMemo(() => buildStaticPurposes(t), [t]);

  const [role, setRole]             = useState(null);
  const [roleChecked, setRoleChecked] = useState(false);
  const [purpose, setPurpose]       = useState(STATIC_PURPOSES[0]);
  const [amount, setAmount]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [recent, setRecent]         = useState([]);

  const [monthlyAmount, setMonthlyAmount]   = useState("");
  const [monthlyAvailable, setMonthlyAvailable] = useState(false);
  const [monthlyStatus, setMonthlyStatus]   = useState("");
  const [unpaidMonths, setUnpaidMonths]     = useState([]);
  const [advanceMonths, setAdvanceMonths]   = useState(1);

  const [mosqueUpiId, setMosqueUpiId]       = useState(MOSQUE_UPI_ID_DEFAULT);
  const [upiCopied, setUpiCopied]           = useState(false);
  const [mosquePayeeName, setMosquePayeeName] = useState(MOSQUE_PAYEE_NAME_DEFAULT);
  const [activeFunds, setActiveFunds]       = useState([]);
  const [lastSync, setLastSync]             = useState(null);

  const PURPOSES = useMemo(() => {
    const fundPurposes = activeFunds.map((f) => ({
      key: `fund_${f.id}`,
      label: f.name,
      desc: f.description || t("donation.purposes.fundDescFallback"),
      icon: "F",
      locked: false,
      fund_id: f.id,
    }));
    return [...STATIC_PURPOSES, ...fundPurposes];
  }, [activeFunds, STATIC_PURPOSES]);

  useEffect(() => {
    (async () => {
      try {
        const u = await AsyncStorage.getItem("user");
        if (u) setRole(JSON.parse(u)?.role);
      } catch (_) {}
      setRoleChecked(true);
    })();
  }, []);

  // Hydrate every piece of state from cache immediately on mount, so a
  // warm start shows the last known chanda status / unpaid months /
  // recent payments right away instead of "Loading…" placeholders while
  // the network calls below are still in flight.
  useEffect(() => {
    (async () => {
      try {
        const [m, u, r, upi, f] = await Promise.all([
          AsyncStorage.getItem(CACHE_MONTHLY),
          AsyncStorage.getItem(CACHE_UNPAID),
          AsyncStorage.getItem(CACHE_RECENT),
          AsyncStorage.getItem(CACHE_UPI),
          AsyncStorage.getItem(CACHE_FUNDS),
        ]);
        if (m) {
          const parsed = JSON.parse(m);
          setMonthlyAmount(parsed.amount || "");
          setMonthlyAvailable(!!parsed.available);
          setMonthlyStatus(parsed.status || t("donation.monthlyStatus.loading"));
          if (parsed.timestamp) setLastSync(new Date(parsed.timestamp));
        }
        if (u) setUnpaidMonths(JSON.parse(u) || []);
        if (r) setRecent(JSON.parse(r) || []);
        if (upi) {
          const parsed = JSON.parse(upi);
          if (parsed.upiId) setMosqueUpiId(parsed.upiId);
          if (parsed.payeeName) setMosquePayeeName(parsed.payeeName);
        }
        if (f) setActiveFunds(JSON.parse(f) || []);
      } catch (_) {}
    })();
  }, []);

  const refreshMonthlyChanda = useCallback(async () => {
    try {
      const res = await authApiFetch("/user/chanda/current");
      if (!res.ok) {
        setMonthlyAvailable(false); setMonthlyAmount("");
        setMonthlyStatus(t("donation.monthlyStatus.unableToLoad"));
        return null;
      }
      const data = await res.json();
      const amt = String(data.amount_due ?? data.monthly_amount ?? data.balance ?? "");
      if (!amt || amt === "0") {
        const statusText = t("donation.monthlyStatus.noChandaYet");
        setMonthlyAvailable(false); setMonthlyAmount(""); setMonthlyStatus(statusText);
        AsyncStorage.setItem(CACHE_MONTHLY, JSON.stringify({
          amount: "", available: false, status: statusText, timestamp: new Date().toISOString(),
        })).catch(() => {});
        return null;
      }
      setMonthlyAvailable(true);
      setMonthlyAmount(amt);
      const statusNote =
        data.status === "paid"         ? `✓ ${t("donation.monthlyStatus.fullyPaid")}`         :
        data.status === "not_generated"? t("donation.monthlyStatus.awaitingAllocation") :
        data.balance === 0             ? `✓ ${t("donation.monthlyStatus.noBalance")}`                    :
                                         t("donation.monthlyStatus.dueThisMonth");
      const statusText = `₹${amt} · ${statusNote}`;
      setMonthlyStatus(statusText);
      const now = new Date();
      setLastSync(now);
      AsyncStorage.setItem(CACHE_MONTHLY, JSON.stringify({
        amount: amt, available: true, status: statusText, timestamp: now.toISOString(),
      })).catch(() => {});
      return data;
    } catch (_) {
      setMonthlyAvailable(false); setMonthlyAmount("");
      setMonthlyStatus(t("donation.monthlyStatus.cannotConnect"));
      return null;
    }
  }, []);

  const loadUnpaidMonths = useCallback(async () => {
    try {
      const res = await authApiFetch("/user/chanda/unpaid");
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setUnpaidMonths(list);
        AsyncStorage.setItem(CACHE_UNPAID, JSON.stringify(list)).catch(() => {});
      }
    } catch (_) {}
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const res = await authApiFetch("/user/payments");
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data.slice(0, 5) : [];
      setRecent(list);
      AsyncStorage.setItem(CACHE_RECENT, JSON.stringify(list)).catch(() => {});
    } catch (_) {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/finance/settings/public");
        if (res.ok) {
          const data = await res.json();
          const nextUpi = data.upi_id || mosqueUpiId;
          const nextPayee = data.payee_name || mosquePayeeName;
          if (data.upi_id) setMosqueUpiId(data.upi_id);
          if (data.payee_name) setMosquePayeeName(data.payee_name);
          AsyncStorage.setItem(CACHE_UPI, JSON.stringify({ upiId: nextUpi, payeeName: nextPayee })).catch(() => {});
        }
      } catch (_) {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/funds/public");
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : [];
          setActiveFunds(list);
          AsyncStorage.setItem(CACHE_FUNDS, JSON.stringify(list)).catch(() => {});
        }
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    let ws = null, retryTimeout = null;
    const connect = async () => {
      try {
        const token = await getToken();
        const url = await getWsUrl(`/ws/finance?token=${token}`);
        ws = new WebSocket(url);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "monthly_amount_updated" || msg.type === "dashboard_updated") {
              refreshMonthlyChanda();
              loadUnpaidMonths();
            }
          } catch (_) {}
        };
        ws.onerror = () => {};
        ws.onclose = () => { retryTimeout = setTimeout(connect, 15000); };
      } catch (_) {}
    };
    connect();
    return () => { if (ws) ws.close(); if (retryTimeout) clearTimeout(retryTimeout); };
  }, [refreshMonthlyChanda, loadUnpaidMonths]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const userRaw = await AsyncStorage.getItem("user");
          const user = userRaw ? JSON.parse(userRaw) : null;
          if (!active) return;
          if (!canAccessPay(user?.role)) { navigation.replace("Home"); return; }
          refreshMonthlyChanda();
          loadUnpaidMonths();
          loadRecent();
        } catch (_) { if (!active) return; navigation.replace("Home"); }
      })();
      return () => { active = false; };
    }, [navigation, refreshMonthlyChanda, loadUnpaidMonths, loadRecent])
  );

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (purpose.locked) setAmount(monthlyAvailable ? monthlyAmount : "");
  }, [monthlyAmount, purpose.locked, monthlyAvailable]);

  const selectPurpose = useCallback((p) => {
    setPurpose(p);
    setAdvanceMonths(1);
    if (p.locked) setAmount(monthlyAvailable ? monthlyAmount : "");
    else setAmount("");
  }, [monthlyAmount, monthlyAvailable]);

  const selectAdvanceMonths = (n) => {
    setAdvanceMonths(n);
    const unit = Number(monthlyAmount || 0);
    if (unit > 0) setAmount(String(unit * n));
  };

  const coverageNote = useMemo(() => {
    if (!purpose.locked || !monthlyAvailable) return null;
    const enteredAmt = Number(String(amount).replace(/[^0-9.]/g, "")) || 0;
    const unitAmt = Number(monthlyAmount) || 0;
    if (!enteredAmt || !unitAmt) return null;
    const monthsCovered = Math.floor(enteredAmt / unitAmt);
    if (monthsCovered < 1) return null;

    const oldest = unpaidMonths[0];
    const newest = unpaidMonths[monthsCovered - 1];
    const prefix = t("donation.willCover");
    if (oldest && newest) {
      if (monthsCovered === 1) return `${prefix}: ${fmtMonth(oldest.month)}`;
      return `${prefix}: ${fmtMonth(oldest.month)} – ${fmtMonth(newest.month)} (${monthsCovered} ${t("donation.monthsPlural")})`;
    }
    if (monthsCovered === 1) return `${prefix} 1 ${t("donation.month")}`;
    return `${prefix} ${monthsCovered} ${t("donation.monthsPlural")}`;
  }, [amount, monthlyAmount, purpose.locked, monthlyAvailable, unpaidMonths]);

  const handleUPIPay = async () => {
    if (!mosqueUpiId) {
      Alert.alert(t("donation.alerts.upiNotConfiguredTitle"), t("donation.alerts.upiNotConfiguredMsg"));
      return;
    }
    const latest = purpose.locked ? await refreshMonthlyChanda() : null;
    const rawAmt = purpose.locked ? (latest?.amount_due ?? monthlyAmount) : amount;
    const parsed = parseFloat(String(rawAmt || "").replace(/[^0-9.]/g, ""));
    if (!parsed || parsed <= 0) {
      Alert.alert(t("donation.alerts.enterAmountTitle"), t("donation.alerts.enterAmountMsgPay"));
      return;
    }
    const note = `${purpose.key} payment`;
    const url = `upi://pay?pa=${mosqueUpiId}&pn=${encodeURIComponent(mosquePayeeName)}&am=${parsed.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
    try { await Linking.openURL(url); } catch (_) {
      Alert.alert(t("donation.alerts.upiErrorTitle"), t("donation.alerts.upiErrorMsg"));
    }
  };

  const handleSubmit = async () => {
    const latest = purpose.locked ? await refreshMonthlyChanda() : null;
    // For chanda, use the `amount` state (which reflects advance multiplier).
    // Fall back to monthly amount only if amount is empty.
    const rawAmt = purpose.locked
      ? (amount || String(latest?.amount_due ?? monthlyAmount ?? ""))
      : amount;
    const finalAmount = Number(String(rawAmt).replace(/[^0-9.]/g, ""));
    if (purpose.locked && !latest && !monthlyAvailable) {
      Alert.alert(t("donation.alerts.chandaNotSetTitle"), t("donation.alerts.chandaNotSetMsg"));
      return;
    }
    if (!finalAmount || finalAmount <= 0) {
      Alert.alert(t("donation.alerts.enterAmountTitle"), t("donation.alerts.enterAmountMsgSubmit"));
      return;
    }
    if (!selectedImage) {
      Alert.alert(t("donation.alerts.screenshotRequiredTitle"), t("donation.alerts.screenshotRequiredMsg"));
      return;
    }

    setSubmitting(true);
    Animated.sequence([
      Animated.spring(btnScale, { toValue: 0.96, useNativeDriver: true, speed: 40 }),
      Animated.spring(btnScale, { toValue: 1, useNativeDriver: true, speed: 40 }),
    ]).start();

    try {
      const formData = new FormData();
      formData.append("amount", String(finalAmount));
      formData.append("purpose", purpose.fund_id ? "Donation" : purpose.key);
      if (purpose.fund_id) formData.append("fund_id", String(purpose.fund_id));
      formData.append("file", { uri: selectedImage.uri, type: selectedImage.type || "image/jpeg", name: "payment.jpg" });

      const res = await authApiFetch("/user/pay", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert(t("donation.alerts.submissionFailedTitle"), err.detail || t("donation.alerts.somethingWrong"));
        return;
      }
      const body = await res.json();
      setSelectedImage(null);
      await refreshMonthlyChanda();
      await loadUnpaidMonths();
      await loadRecent();

      const receiptPayment = {
        receipt_id: body.receipt_id || null,
        amount: finalAmount,
        status: body.status || "pending",
        purpose: purpose.fund_id ? "Donation" : purpose.key,
        method: "upi",
        created_at: new Date().toISOString(),
        created_by: "user",
        covered_months: body.covered_months || [],
        months_covered: body.months_covered || 0,
        collector_name: null, verified_at: null, collected_at: null,
        payment_id: body.payment_id || body.donation_id || null,
      };

      if (receiptPayment.receipt_id) {
        navigation.replace("Receipt", { payment: receiptPayment });
      } else {
        Alert.alert(t("donation.alerts.paymentSubmittedTitle"), t("donation.alerts.paymentSubmittedMsg"));
        navigation.goBack();
      }
    } catch (_) {
      Alert.alert(t("donation.alerts.errorTitle"), t("donation.alerts.failedSubmitMsg"));
    } finally {
      setSubmitting(false);
    }
  };

  const pickImage = async () => {
    const res = await launchImageLibrary({ mediaType: "photo" });
    if (res.assets?.length > 0) setSelectedImage(res.assets[0]);
  };

  if (!roleChecked) return <View style={styles.root}></View>;

  if (!canAccessPay(role)) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.restrictedTitle}>{t("donation.restricted.title")}</Text>
        <Text style={styles.restrictedSub}>{t("donation.restricted.sub")}</Text>
        <AnimatedPressable style={styles.restrictedBtn} onPress={() => navigation.navigate("Home")}>
          <Text style={styles.restrictedBtnTxt}>{t("donation.restricted.backHome")}</Text>
        </AnimatedPressable>
      </View>
    );
  }

  const amountNum = Number(String(amount).replace(/[^0-9.]/g, "")) || 0;
  const HEADER_H = Platform.OS === "ios" ? 118 : 98;
  const lastSyncLabel = lastSync
    ? lastSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <View style={styles.root}>

      <View style={[styles.header, { height: HEADER_H }]}>
        <Svg width={width} height={HEADER_H} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="payHeaderGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={G.deep} />
              <Stop offset="100%" stopColor={G.deepLight} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={width} height={HEADER_H} fill="url(#payHeaderGrad)" />
        </Svg>
        <HeaderPattern w={width} h={HEADER_H} />

        <AnimatedPressable onPress={() => navigation.navigate("Home")} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </AnimatedPressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEye}>Mohideen Masjid</Text>
          <Text style={styles.headerTitle}>{t("donation.headerTitle")}</Text>
        </View>
        <View style={styles.upiPill}><Text style={styles.upiPillTxt}>UPI</Text></View>
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
      >

        {lastSyncLabel ? (
          <Text style={styles.syncNote}>{t("donation.updatedAt")} {lastSyncLabel}</Text>
        ) : null}

        {purpose.locked && monthlyAvailable && unpaidMonths.length === 0 && (
          <View style={styles.alhamdulillahCard}>
            <Text style={styles.alhamdulillahArabic}>الحمد لله</Text>
            <Text style={styles.alhamdulillahTitle}>{t("donation.alhamdulillah.title")}</Text>
            <Text style={styles.alhamdulillahSub}>{t("donation.alhamdulillah.sub")}</Text>
          </View>
        )}

        {purpose.locked && unpaidMonths.length > 0 && <UnpaidStrip months={unpaidMonths} />}

        <Text style={styles.sectionHead}>{t("donation.selectPurpose")}</Text>

        {PURPOSES.map((p) => (
          <PurposeCard key={p.key} item={p} selected={purpose.key === p.key} onPress={() => selectPurpose(p)} />
        ))}

        <Text style={[styles.sectionHead, { marginTop: 24 }]}>{t("donation.amount")}</Text>

        <View style={styles.amountCard}>
          <View style={styles.amountRow}>
            <View style={styles.amountPrefix}>
              <Text style={styles.currencySymbol}>₹</Text>
            </View>
            <TextInput
              value={amount}
              editable={!purpose.locked}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={G.textMuted}
              style={[styles.amountInput, purpose.locked && styles.amountLocked]}
            />
            {purpose.locked && <View style={styles.lockBadge}><Text style={styles.lockBadgeTxt}>{t("donation.autoBadge")}</Text></View>}
          </View>

          {purpose.locked && (
            <Text style={styles.amountNote}>{monthlyStatus}</Text>
          )}

          {coverageNote && (
            <View style={styles.coverageNote}>
              <Text style={styles.coverageNoteIcon}>✓</Text>
              <Text style={styles.coverageNoteText}>{coverageNote}</Text>
            </View>
          )}

          {purpose.locked && monthlyAvailable && (
            <>
              <Text style={styles.advanceLabel}>{t("donation.payAhead")}</Text>
              <View style={styles.advanceRow}>
                {[1, 3, 6, 12].map((n) => (
                  <AnimatedPressable key={n} onPress={() => selectAdvanceMonths(n)}
                    style={[styles.advancePill, advanceMonths === n && styles.advancePillOn]}>
                    <Text style={[styles.advancePillTxt, advanceMonths === n && styles.advancePillTxtOn]}>
                      {n} {monthWord(n, t)}
                    </Text>
                  </AnimatedPressable>
                ))}
              </View>
            </>
          )}
        </View>

        <View style={styles.summaryStrip}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryKey}>{t("donation.summary.purpose")}</Text>
            <Text style={styles.summaryVal} numberOfLines={1}>{purpose.label}</Text>
          </View>
          <View style={styles.summaryDiv} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryKey}>{t("donation.summary.amount")}</Text>
            <Text style={styles.summaryVal}>₹{amountNum > 0 ? amountNum.toLocaleString("en-IN") : "—"}</Text>
          </View>
          <View style={styles.summaryDiv} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryKey}>{t("donation.summary.to")}</Text>
            <Text style={styles.summaryVal} numberOfLines={1}>{mosquePayeeName}</Text>
          </View>
        </View>

        <View style={styles.stepCard}>
          <View style={styles.stepNum}><Text style={styles.stepNumTxt}>1</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepTitle}>{t("donation.steps.pay.title")}</Text>
            <Text style={styles.stepDesc}>{t("donation.steps.pay.desc")}</Text>
          </View>
        </View>
        <Animated.View style={{ transform: [{ scale: btnScale }] }}>
          <AnimatedPressable onPress={handleUPIPay} activeOpacity={0.9} style={styles.payBtn}>
            <Text style={styles.payBtnLabel}>{t("donation.openUpiApp")}  →</Text>
          </AnimatedPressable>
        </Animated.View>

        <View style={styles.upiFallback}>
          <Text style={styles.upiFallbackLabel}>{t("donation.upiFallback.label")}</Text>
          <View style={styles.upiFallbackRow}>
            <Text style={styles.upiFallbackId} numberOfLines={1}>{mosqueUpiId}</Text>
            <AnimatedPressable
              onPress={() => {
                Clipboard.setString(mosqueUpiId);
                setUpiCopied(true);
                setTimeout(() => setUpiCopied(false), 2000);
              }}
              activeOpacity={0.75}
              style={styles.upiCopyBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.upiCopyBtnTxt}>
                {upiCopied ? t("donation.upiFallback.copied") : t("donation.upiFallback.copy")}
              </Text>
            </AnimatedPressable>
          </View>
        </View>

        <View style={[styles.stepCard, { marginTop: 20 }]}>
          <View style={styles.stepNum}><Text style={styles.stepNumTxt}>2</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepTitle}>{t("donation.steps.upload.title")}</Text>
            <Text style={styles.stepDesc}>{t("donation.steps.upload.desc")}</Text>
          </View>
        </View>
        <AnimatedPressable style={[styles.uploadBtn, selectedImage && styles.uploadBtnDone]} onPress={pickImage}>
          {selectedImage ? (
            <View style={styles.uploadDoneRow}>
              <Text style={styles.uploadDoneIcon}>✓</Text>
              <Text style={styles.uploadDoneTxt}>{t("donation.screenshotSelected")}</Text>
              <Text style={styles.uploadChangeTxt}>{t("donation.change")}</Text>
            </View>
          ) : (
            <Text style={styles.uploadTxt}>{t("donation.uploadPrompt")}</Text>
          )}
        </AnimatedPressable>

        <View style={[styles.stepCard, { marginTop: 20 }]}>
          <View style={styles.stepNum}><Text style={styles.stepNumTxt}>3</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepTitle}>{t("donation.steps.confirm.title")}</Text>
            <Text style={styles.stepDesc}>{t("donation.steps.confirm.desc")}</Text>
          </View>
        </View>
        <AnimatedPressable onPress={handleSubmit} activeOpacity={0.85} disabled={submitting}
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}>
          <Text style={styles.submitLabel}>{submitting ? t("donation.submitting") : t("donation.confirmSubmit")}</Text>
        </AnimatedPressable>

        <Text style={styles.footerNote}>{t("donation.footerNote")}</Text>

        {recent.length > 0 && (
          <>
            <Text style={[styles.sectionHead, { marginTop: 28 }]}>{t("donation.recentPayments")}</Text>
            {recent.map((item) => <RecentRow key={`${item.id}-${item.receipt_id}`} item={item} />)}
          </>
        )}
      </Animated.ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: G.bg },
  center: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10 },

  restrictedTitle:  { fontSize: 18, fontWeight: "800", color: G.textDark, fontFamily: FONTS.display },
  restrictedSub:    { fontSize: 13, color: G.textMuted, textAlign: "center" },
  restrictedBtn:    { marginTop: 12, backgroundColor: G.gold, paddingHorizontal: 24, paddingVertical: 12, borderRadius: RADII.md },
  restrictedBtnTxt: { color: G.deep, fontWeight: "800", fontSize: 13 },

  header: {
    paddingTop: Platform.OS === "ios" ? 54 : 34,
    paddingBottom: 14, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "center",
    overflow: "hidden",
    // Same corner radius as ProfileScreen's header for cross-screen consistency
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...shadow(8, 0.16),
  },
  backBtn: { width: 36, height: 36, borderRadius: RADII.sm, backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(212,175,55,0.4)", justifyContent: "center", alignItems: "center", marginRight: 14 },
  backArrow: { color: G.gold, fontSize: 18, lineHeight: 20 },
  headerEye: { color: "rgba(255,255,255,0.65)", fontSize: 10, fontWeight: "700", letterSpacing: 1.4, marginBottom: 2 },
  headerTitle: { color: G.gold, fontSize: 20, fontWeight: "800", fontFamily: FONTS.display },
  upiPill: { backgroundColor: G.gold, borderRadius: RADII.sm, paddingHorizontal: 10, paddingVertical: 5 },
  upiPillTxt: { color: G.deep, fontWeight: "800", fontSize: 11, letterSpacing: 1.2 },

  scroll: { padding: 16, paddingBottom: 56 },

  syncNote: { textAlign: "center", fontSize: 10.5, color: G.textMuted, marginBottom: 12 },

  sectionHead: { fontSize: 10, fontWeight: "800", color: G.textMuted, letterSpacing: 1.6, marginBottom: 10 },

  alhamdulillahCard: { backgroundColor: G.successBg, borderRadius: RADII.xl, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: "rgba(14,107,69,0.2)", alignItems: "center" },
  alhamdulillahArabic: { fontSize: 22, color: G.success, fontWeight: "800", marginBottom: 4 },
  alhamdulillahTitle: { fontSize: 18, fontWeight: "800", color: G.success, marginBottom: 6, fontFamily: FONTS.display },
  alhamdulillahSub: { fontSize: 12, color: G.success, opacity: 0.85, textAlign: "center", lineHeight: 18 },

  unpaidCard: { backgroundColor: G.warnBg, borderRadius: RADII.xl, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: "rgba(154,107,46,0.25)" },
  unpaidHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  unpaidDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: G.warn },
  unpaidTitle: { flex: 1, fontSize: 13, fontWeight: "800", color: G.warn },
  unpaidTotal: { fontSize: 16, fontWeight: "900", color: G.warn },
  unpaidSub: { fontSize: 11, color: G.warn, opacity: 0.8, marginBottom: 12 },
  monthRow: { flexDirection: "row" },
  monthChip: { backgroundColor: G.white, borderRadius: RADII.sm, padding: 10, minWidth: 90, alignItems: "center", borderWidth: 1, borderColor: "rgba(154,107,46,0.2)" },
  monthChipFirst: { backgroundColor: G.warn, borderColor: G.warn },
  monthChipLabel: { fontSize: 11, fontWeight: "700", color: G.textMuted, marginBottom: 2 },
  monthChipLabelFirst: { color: G.white },
  monthChipAmt: { fontSize: 14, fontWeight: "900", color: G.textDark },
  monthChipAmtFirst: { color: G.white },
  monthChipNext: { fontSize: 9, color: "rgba(255,255,255,0.8)", marginTop: 3, fontWeight: "700" },

  purposeCard: { flexDirection: "row", alignItems: "center", backgroundColor: G.white, borderRadius: RADII.md, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8, borderWidth: 1.5, borderColor: "transparent", ...shadow(2, 0.04) },
  purposeCardSel: { borderColor: G.gold, backgroundColor: G.goldPale },
  purposeIcon: { width: 40, height: 40, borderRadius: RADII.sm, backgroundColor: G.bg, justifyContent: "center", alignItems: "center", marginRight: 14 },
  purposeIconSel: { backgroundColor: G.deep },
  purposeIconTxt: { fontSize: 15, fontWeight: "800", color: G.textMuted },
  purposeIconTxtSel: { color: G.gold },
  purposeLabel: { fontSize: 15, fontWeight: "700", color: G.textDark, marginBottom: 2, fontFamily: FONTS.display },
  purposeLabelSel: { color: G.deep },
  purposeDesc: { fontSize: 12, color: G.textMuted },
  fixedBadge: { backgroundColor: G.goldPale, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginRight: 8 },
  fixedBadgeTxt: { color: G.goldDeep, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  checkRing: { width: 22, height: 22, borderRadius: 11, backgroundColor: G.deep, justifyContent: "center", alignItems: "center" },
  checkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: G.gold },

  amountCard: { backgroundColor: G.white, borderRadius: RADII.xl, overflow: "hidden", marginBottom: 16, borderWidth: 1, borderColor: G.border },
  amountRow: { flexDirection: "row", alignItems: "center" },
  amountPrefix: { backgroundColor: G.deep, paddingHorizontal: 16, paddingVertical: 16, justifyContent: "center" },
  currencySymbol: { color: G.gold, fontSize: 22, fontWeight: "800" },
  amountInput: { flex: 1, fontSize: 30, fontWeight: "800", color: G.textDark, paddingHorizontal: 16, paddingVertical: 12, letterSpacing: 0.4, fontFamily: FONTS.display },
  amountLocked: { color: G.success },
  lockBadge: { marginRight: 14, backgroundColor: G.successBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  lockBadgeTxt: { color: G.success, fontSize: 9, fontWeight: "800" },
  amountNote: { fontSize: 12, color: G.textMuted, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, lineHeight: 18 },
  coverageNote: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: G.successBg, marginHorizontal: 16, marginBottom: 14, borderRadius: RADII.sm, paddingHorizontal: 10, paddingVertical: 8 },
  coverageNoteIcon: { fontSize: 13, color: G.success, fontWeight: "800" },
  coverageNoteText: { fontSize: 12, color: G.success, fontWeight: "600", flex: 1 },
  advanceLabel: { fontSize: 9, fontWeight: "800", color: G.textMuted, letterSpacing: 1.4, paddingHorizontal: 16, paddingTop: 4, marginBottom: 8 },
  advanceRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  advancePill: { flex: 1, paddingVertical: 10, borderRadius: RADII.sm, backgroundColor: G.bg, borderWidth: 1, borderColor: G.border, alignItems: "center" },
  advancePillOn: { backgroundColor: G.gold, borderColor: G.gold },
  advancePillTxt: { fontSize: 11, fontWeight: "700", color: G.textMuted },
  advancePillTxtOn: { color: G.deep },

  summaryStrip: { flexDirection: "row", backgroundColor: G.deep, borderRadius: RADII.md, padding: 14, marginBottom: 20, ...shadow(4, 0.12) },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryKey: { color: "rgba(255,255,255,0.55)", fontSize: 9, fontWeight: "800", letterSpacing: 1, marginBottom: 4 },
  summaryVal: { color: G.gold, fontSize: 13, fontWeight: "800" },
  summaryDiv: { width: 1, backgroundColor: G.deepLight, marginVertical: 2 },

  stepCard: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: G.deep, justifyContent: "center", alignItems: "center" },
  stepNumTxt: { color: G.gold, fontSize: 13, fontWeight: "800" },
  stepTitle: { fontSize: 14, fontWeight: "700", color: G.textDark, fontFamily: FONTS.display },
  stepDesc: { fontSize: 11, color: G.textMuted, marginTop: 1 },

  payBtn: { backgroundColor: G.deep, borderRadius: RADII.md, paddingVertical: 16, alignItems: "center", borderWidth: 1.5, borderColor: G.deepLight, ...shadow(4, 0.1) },
  payBtnLabel: { color: G.gold, fontSize: 16, fontWeight: "800", letterSpacing: 0.4 },

  upiFallback: { marginTop: 10, paddingHorizontal: 2 },
  upiFallbackLabel: { fontSize: 11, color: G.textMuted, marginBottom: 5 },
  upiFallbackRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: G.goldPale, borderRadius: RADII.sm, borderWidth: 1, borderColor: G.border,
    paddingVertical: 10, paddingHorizontal: 12, gap: 10,
  },
  upiFallbackId: { flex: 1, fontSize: 13, fontWeight: "700", color: G.textDark, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) },
  upiCopyBtn: { backgroundColor: G.deep, borderRadius: RADII.sm, paddingVertical: 6, paddingHorizontal: 12 },
  upiCopyBtnTxt: { color: G.gold, fontSize: 11, fontWeight: "800" },

  uploadBtn: { backgroundColor: G.white, borderRadius: RADII.md, paddingVertical: 16, alignItems: "center", borderWidth: 1.5, borderColor: G.border, borderStyle: "dashed" },
  uploadBtnDone: { borderColor: G.success, borderStyle: "solid", backgroundColor: G.successBg },
  uploadTxt: { color: G.textMuted, fontWeight: "600", fontSize: 13 },
  uploadDoneRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  uploadDoneIcon: { fontSize: 16, color: G.success, fontWeight: "800" },
  uploadDoneTxt: { fontSize: 13, fontWeight: "700", color: G.success, flex: 1 },
  uploadChangeTxt: { fontSize: 11, color: G.textMuted, fontWeight: "600" },

  submitBtn: { backgroundColor: G.gold, borderRadius: RADII.md, paddingVertical: 18, alignItems: "center", marginTop: 12, shadowColor: G.gold, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  submitLabel: { color: G.deep, fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },

  footerNote: { textAlign: "center", color: G.textMuted, fontSize: 11, lineHeight: 17, marginTop: 20, paddingHorizontal: 8 },

  recentRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: G.white, borderRadius: RADII.sm, borderWidth: 1, borderColor: G.border, padding: 12, marginBottom: 8 },
  recentPurpose: { fontSize: 13, fontWeight: "700", color: G.textDark },
  recentCovered: { fontSize: 11, color: G.success, marginTop: 2, fontWeight: "600" },
  recentDate: { fontSize: 11, color: G.textMuted, marginTop: 3 },
  recentAmount: { fontSize: 14, fontWeight: "800", color: G.textDark },
  recentPill: { marginTop: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  recentPillTxt: { fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
});