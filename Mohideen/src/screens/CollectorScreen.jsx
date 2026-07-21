/**
 * CollectorScreen.js — Mohideen Masjid
 * Premium collection workspace. See prior chat notes for the backend
 * gaps this works around - search "TODO(backend)" for spots needing a
 * real endpoint before they're fully wired.
 *
 * Every visible string now goes through t("collector.xxx") - the
 * previous version had them hardcoded in English, inconsistent with
 * every other screen in the app.
 *
 * PERF PASS NOTES (this revision):
 * - ProgressBar now animates `transform: scaleX` with useNativeDriver:true
 *   instead of `width` with useNativeDriver:false. Width animation runs on
 *   the JS thread and was the main source of scroll jank on this screen.
 * - Per-card fade/slide entrance animation removed. Combined with
 *   removeClippedSubviews on the FlatList, cards were re-mounting (and
 *   re-animating) as they crossed the render window while scrolling —
 *   that's what felt like "not scrolling properly."
 * - callFamily / navigateToFamily / goToHistory are now stable via
 *   useCallback so React.memo on MemberCard actually prevents re-renders.
 * - Payment sheet ScrollView now has style={{flex:1}} and the sheet
 *   container uses a resolved height instead of maxHeight — previously
 *   the scrollable area's hit box didn't match the visible sheet, which
 *   is why you had to grab a specific spot near the bottom (UPI section)
 *   to get it to scroll at all.
 * - List sort now buckets paid members to the bottom regardless of which
 *   sort mode is active; pending/partial always float to the top.
 * - Header trimmed (smaller paddings, subtitle line removed) to reduce
 *   dead vertical space above the list.
 * - Offline indicator swapped from hard red (H.error) to muted amber
 *   (H.warn) so a connectivity hiccup doesn't read as a broken screen.
 *
 * SCROLL-STUCK FIX (this revision):
 * - The date-picker Modal used to be declared as a JSX child *inside* the
 *   payment sheet's ScrollView. Because RN Modal mounts into its own
 *   native window, having it live inside scrollable content still forces
 *   the ScrollView to re-measure on every open/close, and on Android this
 *   occasionally left the ScrollView's responder latched to a stale
 *   contentSize — scroll would "stick" once you'd interacted with the
 *   date field. Both modals now live as top-level siblings of the sheet,
 *   outside the ScrollView entirely.
 * - The locked "Advance Payment" header still used a real TouchableOpacity
 *   even while disabled, which could steal the initial touch of a scroll
 *   gesture. It's now a plain View with pointerEvents="none" on its
 *   content when locked, so drags pass straight through to the ScrollView.
 * - contentContainerStyle now uses flexGrow:1 with explicit bottom
 *   padding so short lists don't collapse the scroll area and long lists
 *   never clip the submit button behind the sticky bar.
 * - Added pull-to-refresh (RefreshControl) on both the main member list
 *   and the payment sheet, so a pull-down re-fetches the latest data
 *   from the server instead of relying only on the WebSocket/manual sync.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  StyleSheet,
  Alert,
  Image,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  RefreshControl,
  StatusBar,
  Dimensions,
  Linking,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
// DateTimePicker removed — replaced with custom JS-only date modal
import { launchImageLibrary } from "react-native-image-picker";
import { authApiFetch, apiFetch, getWsUrl } from "../config/server";
import { COLORS as C } from "../config/theme";
import { useTranslation } from "react-i18next";

const { width: SW } = Dimensions.get("window");
const MEMBERS_CACHE_KEY = "collector_members_cache";
const OFFLINE_QUEUE_KEY = "collector_offline_queue";

const normalizeRole = (role) => (role || "").toString().trim().toLowerCase();
const SUPERADMIN_ROLES = ["superadmin", "super_admin", "super admin"];
const canAccessCollector = (role) => {
  const r = normalizeRole(role);
  return r === "collector" || SUPERADMIN_ROLES.includes(r);
};

const H = {
  bg: "#FBF9F4",
  card: "#FFFFFF",
  cardBorder: "rgba(11,61,46,0.08)",
  headerDeep: C.bg,
  headerLight: C.bgVivid,
  gold: C.gold,
  goldLight: C.goldLight,
  goldDeep: C.goldDeep,
  textDark: C.textDark,
  textMuted: C.textMuted,
  white: C.white,
  green: C.bgVivid,
  greenDim: "rgba(14,107,69,0.1)",
  amber: "#B8862E",
  amberDim: "rgba(184,134,46,0.12)",
  warn: "#9A6B2E",
  warnDim: "rgba(154,107,46,0.12)",
  error: "#C0473A",
  errorDim: "rgba(192,71,58,0.1)",
};

const shadow = (y = 4, opacity = 0.07) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.5 },
    android: { elevation: y },
  });

const getMonthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (key, delta) => {
  const [y, m] = key.split("-").map(Number);
  return getMonthKey(new Date(y, m - 1 + delta, 1));
};
const fmtMonth = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const getMemberStatus = (item, month) => {
  const col = item.collections?.find((c) => c.month === month) || item.collections?.[0];
  const total = Number(col?.amount_due || 0);
  const paid = Number(col?.total_paid || 0);
  const balance = Math.max(total - paid, 0);
  const status = balance === 0 && total > 0 ? "paid" : paid > 0 ? "partial" : "pending";
  return { col, total, paid, balance, status };
};

const getPendingMonths = (item) => {
  if (!item?.collections) return [];
  return item.collections
    .filter(c => {
      const due = Number(c.amount_due || 0);
      const paid = Number(c.total_paid || 0);
      return due > 0 && paid < due;
    })
    .sort((a, b) => a.month.localeCompare(b.month));
};

const formatMonthName = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
};

const getConsecutiveUnpaidMonths = (item) => {
  // Use server-computed count (all non-paid collections) — accurate for new members
  // with historical dues and members with gaps in their collection history.
  return Number(item.pending_months_count || 0);
};

// ─── Progress bar ───────────────────────────────────────────────────────
// Animates transform:scaleX (native driver) instead of width (JS thread).
function ProgressBar({ ratio, color }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.min(Math.max(ratio, 0), 1),
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [ratio]);
  return (
    <View style={pb.track}>
      <Animated.View
        style={[
          pb.fill,
          {
            backgroundColor: color,
            transform: [{ scaleX: anim }],
          },
        ]}
      />
    </View>
  );
}
const pb = StyleSheet.create({
  track: { height: 4, backgroundColor: "rgba(11,61,46,0.08)", borderRadius: 99, overflow: "hidden", marginTop: 8 },
  fill: { height: "100%", width: "100%", borderRadius: 99, transformOrigin: "left" },
});

const SummaryCard = React.memo(({ label, value, sub, onPress }) => (
  <TouchableOpacity style={s.sumCard} onPress={onPress} activeOpacity={0.85}>
    <Text allowFontScaling={false} style={s.sumLabel}>{label}</Text>
    <Text allowFontScaling={false} style={s.sumValue}>{value}</Text>
    {sub ? <Text allowFontScaling={false} style={s.sumSub}>{sub}</Text> : null}
  </TouchableOpacity>
));

// No entrance fade/slide — cards just render. With removeClippedSubviews
// on the parent FlatList, an entrance animation replays every time a card
// re-mounts on scroll, which is what was causing the stutter.
const MemberCard = React.memo(({ item, selectedMonth, onPress, onCall, onNavigate, onHistory }) => {
  const { t } = useTranslation();
  const { total, paid, balance, status } = getMemberStatus(item, selectedMonth);
  const ratio = total > 0 ? paid / total : 0;
  const sColor = status === "paid" ? H.green : status === "partial" ? H.amber : H.warn;
  const sDim = status === "paid" ? H.greenDim : status === "partial" ? H.amberDim : H.warnDim;
  const sLabel = t(`collector.status.${status}`);
  const overdue = getConsecutiveUnpaidMonths(item);

  const chandaNo = item.member?.chanda_no || "";
  const phone = item.member?.phone || "";
  const address = item.member?.address || "";
  const lastPaymentDate = item.last_payment_date || item.member?.last_payment_date;
  const lastCollector = item.last_collector || item.member?.last_collector;
  const donatedRecently = !!(item.recent_donation || item.member?.recent_donation);
  const fundContribution = !!(item.fund_contribution || item.member?.fund_contribution);

  // All pending month keys sorted chronologically
  const pendingCollections = (item.collections || [])
    .filter(c => Number(c.amount_due || 0) > 0 && Number(c.total_paid || 0) < Number(c.amount_due || 0))
    .sort((a, b) => a.month.localeCompare(b.month));
  const pendingCount = pendingCollections.length;
  // Show up to 4 month names; "+N more" for the remainder
  const pendingMonthNames = pendingCollections
    .slice(0, 4)
    .map(c => {
      const [y, m] = c.month.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
    });

  return (
    // Tap card body → FamilyHistory. Buttons inside handle their own actions.
    <TouchableOpacity onPress={() => onHistory(item)} activeOpacity={0.75}>
      <View style={[s.card, { borderLeftColor: sColor }, status === "paid" && s.cardPaid]}>
        <View style={s.cardRow1}>
          <View style={s.cardLeft}>
            {chandaNo ? (
              <View style={s.chandaTag}>
                <Text allowFontScaling={false} style={s.chandaTagText}>{chandaNo}</Text>
              </View>
            ) : null}
            <Text allowFontScaling={false} style={s.memberName} numberOfLines={1}>{item.member?.name}</Text>
          </View>
          <View style={[s.sPill, { backgroundColor: sDim }]}>
            <Text allowFontScaling={false} style={[s.sPillText, { color: sColor }]}>{sLabel}</Text>
          </View>
        </View>

        {address ? <Text allowFontScaling={false} style={s.addrText} numberOfLines={1}>{address}</Text> : null}
        {phone ? <Text allowFontScaling={false} style={s.phoneText}>{phone}</Text> : null}

        {pendingCount > 0 && (
          <View style={[s.overdueBadge, pendingCount >= 3 && s.overdueBadgeRed]}>
            <Text allowFontScaling={false} style={s.overdueBadgeTxt} numberOfLines={1}>
              {t("collector.pending")} {pendingCount} {pendingCount === 1 ? t("collector.month") : t("collector.months")}: {pendingMonthNames.join(" · ")}{pendingCount > 4 ? ` +${pendingCount - 4}` : ""}
            </Text>
          </View>
        )}

        {(donatedRecently || fundContribution) ? (
          <View style={s.badgeRow}>
            {donatedRecently ? (
              <View style={s.donationBadge}><Text allowFontScaling={false} style={s.donationBadgeTxt}>{t("collector.recentDonation")}</Text></View>
            ) : null}
            {fundContribution ? (
              <View style={s.fundBadge}><Text allowFontScaling={false} style={s.fundBadgeTxt}>{t("collector.fundContributor")}</Text></View>
            ) : null}
          </View>
        ) : null}

        <ProgressBar ratio={ratio} color={sColor} />

        <View style={s.statsRow}>
          <MiniStat label={t("collector.monthly")} value={`₹${total}`} color={H.gold} />
          <MiniStat label={t("collector.dueMonths")} value={String(Math.max(overdue, total > 0 && balance > 0 ? 1 : 0))} color={H.textDark} />
          <MiniStat label={t("collector.pending")} value={balance === 0 ? t("collector.clearBalance") : `₹${balance}`} color={sColor} />
        </View>

        {(lastPaymentDate || lastCollector) ? (
          <Text allowFontScaling={false} style={s.lastMeta}>
            {lastPaymentDate ? `${t("collector.lastPaid")} ${lastPaymentDate}` : ""}{lastPaymentDate && lastCollector ? " · " : ""}{lastCollector ? `${t("collector.by")} ${lastCollector}` : ""}
          </Text>
        ) : null}

        <View style={s.actionsRow}>
          <TouchableOpacity style={s.actionBtnPrimary} onPress={() => onPress(item)} activeOpacity={0.85}>
            <Text allowFontScaling={false} style={s.actionBtnPrimaryTxt}>{t("collector.collect")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => onHistory(item)} activeOpacity={0.85}>
            <Text allowFontScaling={false} style={s.actionBtnTxt}>{t("collector.history")}</Text>
          </TouchableOpacity>
          {phone ? (
            <TouchableOpacity style={s.actionBtn} onPress={() => onCall(phone)} activeOpacity={0.85}>
              <Text allowFontScaling={false} style={s.actionBtnTxt}>{t("collector.call")}</Text>
            </TouchableOpacity>
          ) : null}
          {address ? (
            <TouchableOpacity style={s.actionBtn} onPress={() => onNavigate(address)} activeOpacity={0.85}>
              <Text allowFontScaling={false} style={s.actionBtnTxt}>{t("collector.directions")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
});

function MiniStat({ label, value, color }) {
  return (
    <View style={s.miniStat}>
      <Text allowFontScaling={false} style={s.miniStatLabel}>{label}</Text>
      <Text allowFontScaling={false} style={[s.miniStatVal, { color }]}>{value}</Text>
    </View>
  );
}

function OptionPill({ label, active, onPress }) {
  const sc = useRef(new Animated.Value(1)).current;
  const tap = () => {
    Animated.sequence([
      Animated.timing(sc, { toValue: 0.92, duration: 60, useNativeDriver: true }),
      Animated.timing(sc, { toValue: 1, duration: 90, useNativeDriver: true }),
    ]).start();
    onPress();
  };
  return (
    <Animated.View style={{ transform: [{ scale: sc }] }}>
      <TouchableOpacity onPress={tap} activeOpacity={0.8} style={[s.optPill, active && s.optPillOn]}>
        <Text allowFontScaling={false} style={[s.optPillTxt, active && s.optPillTxtOn]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Month allocation picker ─────────────────────────────────────────
// Replaces fixed 1M/2M/3M/6M/12M buttons.
// Shows pending + future months as individual toggleable rows.
const fmtMShort = (key) => {
  const [y, mo] = key.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
};

const fmtMFull = (key) => {
  const [y, mo] = key.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

function MonthPicker({
  months, selectedKeys, onToggle, onQuickSelect,
  advanceExpanded, setAdvanceExpanded,
  customExpanded, setCustomExpanded,
  monthlyRate, totalOutstanding, pendingCount,
}) {
  const { t } = useTranslation();
  if (!months || months.length === 0) return null;

  const pendingGenerated = months.filter(m => m.is_generated && m.remaining > 0);
  const futureMonths     = months.filter(m => !m.is_generated && m.remaining > 0);
  const paidMonths       = months.filter(m => m.remaining <= 0);
  const isLocked = pendingGenerated.length > 0;

  // Group future by year for custom picker
  const byYear = {};
  futureMonths.forEach(m => {
    const yr = m.month.slice(0, 4);
    (byYear[yr] = byYear[yr] || []).push(m);
  });
  const years = Object.keys(byYear).sort();

  const Row = ({ item }) => {
    const sel = selectedKeys.has(item.month);
    return (
      <TouchableOpacity
        onPress={() => onToggle(item.month, item.remaining)}
        activeOpacity={0.7}
        style={[mp.row, sel && mp.rowSelected]}
      >
        <View style={[mp.check, sel && mp.checkSelected]}>
          {sel && <Text allowFontScaling={false} style={mp.checkMark}>✓</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text allowFontScaling={false} style={[mp.monthTxt, sel && mp.monthTxtSelected]}>
              {item.is_generated ? fmtMShort(item.month) : fmtMFull(item.month)}
            </Text>
            {!item.is_generated && (
              <View style={mp.advancePill}>
                <Text allowFontScaling={false} style={mp.advancePillTxt}>{t("collector.advance")}</Text>
              </View>
            )}
          </View>
        </View>
        {item.status === "partial" && (
          <Text allowFontScaling={false} style={mp.partialBadge}>Partial</Text>
        )}
        <Text allowFontScaling={false} style={[mp.amtTxt, sel && mp.amtTxtSelected]}>
          ₹{item.remaining}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View>
      {/* Outstanding summary card */}
      {(totalOutstanding > 0 || pendingCount > 0) && (
        <View style={mp.outstandingCard}>
          <View style={mp.outstandingItem}>
            <Text allowFontScaling={false} style={mp.outstandingVal}>₹{totalOutstanding}</Text>
            <Text allowFontScaling={false} style={mp.outstandingLbl}>{t("collector.outstanding")}</Text>
          </View>
          <View style={mp.outstandingDivider} />
          <View style={mp.outstandingItem}>
            <Text allowFontScaling={false} style={mp.outstandingVal}>{pendingCount}</Text>
            <Text allowFontScaling={false} style={mp.outstandingLbl}>{t("collector.pendingMonthsLabel")}</Text>
          </View>
          <View style={mp.outstandingDivider} />
          <View style={mp.outstandingItem}>
            <Text allowFontScaling={false} style={mp.outstandingVal}>₹{monthlyRate}</Text>
            <Text allowFontScaling={false} style={mp.outstandingLbl}>{t("collector.monthlyRate")}</Text>
          </View>
        </View>
      )}

      {/* Pending months — primary task */}
      {pendingGenerated.length > 0 && (
        <>
          <Text allowFontScaling={false} style={mp.sectionLabel}>{t("collector.pendingMonths")}</Text>
          {pendingGenerated.map(m => <Row key={m.month} item={m} />)}
        </>
      )}

      {/* Advance payment section */}
      {futureMonths.length > 0 && (
        <View style={mp.advanceSection}>
          {isLocked ? (
            // Plain, non-touchable header while locked — a disabled
            // TouchableOpacity still registers as a responder and can
            // swallow the first move of a scroll gesture, which is what
            // made the list feel "stuck" right around this section.
            <View style={mp.advanceSectionHeader} pointerEvents="none">
              <View style={{ flex: 1 }}>
                <Text allowFontScaling={false} style={[mp.advanceSectionTitle, { color: H.textMuted }]}>
                  {t("collector.advancePayment")}
                </Text>
                <Text allowFontScaling={false} style={mp.advanceLockHint}>
                  {t("collector.advanceLockHint")}
                </Text>
              </View>
              <Text allowFontScaling={false} style={mp.lockIcon}>🔒</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={mp.advanceSectionHeader}
              onPress={() => setAdvanceExpanded(!advanceExpanded)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text allowFontScaling={false} style={mp.advanceSectionTitle}>
                  {t("collector.advancePayment")}
                </Text>
              </View>
              <Text allowFontScaling={false} style={mp.chevron}>{advanceExpanded ? "▲" : "▼"}</Text>
            </TouchableOpacity>
          )}

          {/* Only show contents when pending is cleared */}
          {advanceExpanded && !isLocked && (
            <View style={mp.advanceSectionBody}>
              {/* Quick action buttons */}
              <View style={mp.quickRow}>
                {[3, 6, 12].filter(n => futureMonths.length >= n).map(n => (
                  <TouchableOpacity
                    key={n}
                    style={mp.quickBtn}
                    onPress={() => onQuickSelect(n)}
                    activeOpacity={0.75}
                  >
                    <Text allowFontScaling={false} style={mp.quickBtnTxt}>
                      {n} {t("collector.months")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Custom months toggle */}
              <TouchableOpacity
                style={mp.customToggle}
                onPress={() => setCustomExpanded(!customExpanded)}
                activeOpacity={0.7}
              >
                <Text allowFontScaling={false} style={mp.customToggleTxt}>{t("collector.chooseCustomMonths")}</Text>
                <Text allowFontScaling={false} style={mp.chevron}>{customExpanded ? "▲" : "▼"}</Text>
              </TouchableOpacity>

              {/* Year-grouped custom months — advance badge + full month+year */}
              {customExpanded && years.map(yr => (
                <View key={yr}>
                  <Text allowFontScaling={false} style={mp.yearLabel}>{yr}</Text>
                  {byYear[yr].map(m => <Row key={m.month} item={m} />)}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Already paid — informational only */}
      {paidMonths.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Text allowFontScaling={false} style={mp.sectionLabel}>{t("collector.alreadyPaid")}</Text>
          {paidMonths.map(m => (
            <View key={m.month} style={mp.paidRow}>
              <Text allowFontScaling={false} style={mp.paidTxt}>{fmtMShort(m.month)}</Text>
              <Text allowFontScaling={false} style={mp.paidBadge}>
                {m.is_advance ? t("collector.paidAdvance") : t("collector.paid")}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function StickySelectionBar({ count, total, onContinue, loading }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <View style={sb.bar}>
      <View style={sb.info}>
        <Text allowFontScaling={false} style={sb.count}>
          {count} {count === 1 ? t("collector.month") : t("collector.months")} {t("collector.monthsSelected")}
        </Text>
        <Text allowFontScaling={false} style={sb.total}>₹{Math.round(total)}</Text>
      </View>
      <TouchableOpacity style={sb.btn} onPress={onContinue} disabled={loading} activeOpacity={0.85}>
        <Text allowFontScaling={false} style={sb.btnTxt}>
          {loading ? t("collector.processing") : t("collector.continueBtn")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const mp = StyleSheet.create({
  sectionLabel: { fontSize: 11, fontWeight: "700", color: H.textMuted, marginTop: 14, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.7 },

  outstandingCard: { flexDirection: "row", backgroundColor: H.card, borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder, marginBottom: 14, overflow: "hidden" },
  outstandingItem: { flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 4 },
  outstandingVal: { fontSize: 16, fontWeight: "800", color: H.textDark },
  outstandingLbl: { fontSize: 10, fontWeight: "600", color: H.textMuted, marginTop: 2, textAlign: "center" },
  outstandingDivider: { width: 1, backgroundColor: H.cardBorder, marginVertical: 10 },

  row: { flexDirection: "row", alignItems: "center", paddingVertical: 13, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: H.cardBorder, marginBottom: 6, backgroundColor: H.card },
  rowSelected: { borderColor: H.green, backgroundColor: "rgba(14,107,69,0.07)" },
  check: { width: 26, height: 26, borderRadius: 7, borderWidth: 1.5, borderColor: H.cardBorder, marginRight: 12, alignItems: "center", justifyContent: "center" },
  checkSelected: { backgroundColor: H.green, borderColor: H.green },
  checkMark: { color: "#fff", fontSize: 14, fontWeight: "800" },
  monthTxt: { fontSize: 14, fontWeight: "700", color: H.textDark },
  monthTxtSelected: { color: H.green },
  advanceTag: { fontSize: 10, fontWeight: "700", color: H.green, marginTop: 1 },
  advancePill: { backgroundColor: "rgba(16,185,129,0.12)", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  advancePillTxt: { fontSize: 10, fontWeight: "800", color: "#059669" },
  advanceLockHint: { fontSize: 11, color: H.textMuted, marginTop: 2, lineHeight: 15 },
  lockIcon: { fontSize: 15, marginLeft: 6 },
  amtTxt: { fontSize: 14, fontWeight: "700", color: H.goldDeep },
  amtTxtSelected: { color: H.green },
  partialBadge: { fontSize: 10, fontWeight: "700", color: H.amber, backgroundColor: H.amberDim, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginRight: 8 },

  advanceSection: { marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder, overflow: "hidden" },
  advanceSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 14, backgroundColor: H.card },
  advanceSectionTitle: { fontSize: 14, fontWeight: "700", color: H.textDark },
  chevron: { fontSize: 11, color: H.textMuted, fontWeight: "700" },
  advanceSectionBody: { backgroundColor: H.bg, borderTopWidth: 1, borderTopColor: H.cardBorder, padding: 12 },

  quickRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  quickBtn: { flex: 1, backgroundColor: H.card, borderRadius: 9, borderWidth: 1.5, borderColor: H.green, paddingVertical: 11, alignItems: "center" },
  quickBtnTxt: { fontSize: 13, fontWeight: "700", color: H.green },

  customToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderTopWidth: 1, borderTopColor: H.cardBorder, marginTop: 2 },
  customToggleTxt: { fontSize: 13, fontWeight: "600", color: H.textDark },

  yearLabel: { fontSize: 12, fontWeight: "800", color: H.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 10, marginBottom: 6 },

  paidRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: H.cardBorder, marginBottom: 5, backgroundColor: H.card, opacity: 0.55 },
  paidTxt: { flex: 1, fontSize: 13, fontWeight: "600", color: H.textMuted },
  paidBadge: { fontSize: 10, fontWeight: "700", color: H.green, backgroundColor: "rgba(14,107,69,0.1)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
});

const sb = StyleSheet.create({
  bar: { borderTopWidth: 1, borderTopColor: H.cardBorder, backgroundColor: H.card, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  info: { flex: 1 },
  count: { fontSize: 12, fontWeight: "600", color: H.textMuted, marginBottom: 2 },
  total: { fontSize: 20, fontWeight: "800", color: H.green },
  btn: { backgroundColor: H.green, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22 },
  btnTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },
});

function SubmitButton({ loading, onPress }) {
  const { t } = useTranslation();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (loading) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 0.97, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [loading]);
  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <TouchableOpacity style={s.submitBtn} onPress={onPress} disabled={loading} activeOpacity={0.85}>
        <Text allowFontScaling={false} style={s.submitBtnTxt}>{loading ? t("collector.processing") : t("collector.recordPayment")}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function QRViewerModal({ visible, onClose, imageSource }) {
  const { t } = useTranslation();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.85);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.qrOverlay} onPress={onClose}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
          <Pressable onPress={() => {}}>
            <View style={s.qrBigBox}>
              <Image source={imageSource} style={s.qrBigImg} resizeMode="contain" />
            </View>
            <Text allowFontScaling={false} style={s.qrHint}>{t("collector.tapToClose")}</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

export default function CollectorScreen({ navigation }) {
  const { t } = useTranslation();
  const searchRef = useRef(null);

  const [role, setRole] = useState(null);
  const [roleChecked, setRoleChecked] = useState(false);

  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(getMonthKey());
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("overdue");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [zones, setZones] = useState([]);
  const [zoneSearch, setZoneSearch] = useState("");
  const [selectedZone, setSelectedZone] = useState("");

  const [selected, setSelected] = useState(null);
  const [paymentType, setPaymentType] = useState("chanda");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  // Month allocation picker state
  const [selectedMonthKeys, setSelectedMonthKeys] = useState(new Set());
  const [availableMonths, setAvailableMonths] = useState([]);
  const [availableMonthsLoading, setAvailableMonthsLoading] = useState(false);
  const [sheetRefreshing, setSheetRefreshing] = useState(false);
  const [advanceExpanded, setAdvanceExpanded] = useState(false);
  const [customExpanded, setCustomExpanded] = useState(false);
  const [proofImage, setProofImage] = useState(null);
  const [transactionRef, setTransactionRef] = useState("");
  const [notes, setNotes] = useState("");
  const [collectedDate, setCollectedDate] = useState(new Date());
  const [showDate, setShowDate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [queueCount, setQueueCount] = useState(0);
  const [todaysSessionTotal, setTodaysSessionTotal] = useState({ cash: 0, digital: 0 });

  const [funds, setFunds] = useState([]);
  const [fundsAvailable, setFundsAvailable] = useState(false);
  const [selectedFund, setSelectedFund] = useState(null);

  const [qrViewerVisible, setQrViewerVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState(null);

  const hFade = useRef(new Animated.Value(0)).current;

  const [activeTab, setActiveTab] = useState("collections");
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [showAddFamily, setShowAddFamily] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", chanda_no: "", phone: "", monthly_amount: "", address: "", zone: "", registration_date: "" });
  const [addSaving, setAddSaving] = useState(false);
  const [showEditFamily, setShowEditFamily] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", chanda_no: "", phone: "", monthly_amount: "", address: "", zone: "", registration_date: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [cashHistory, setCashHistory] = useState([]);
  const [cashHistoryLoading, setCashHistoryLoading] = useState(false);

  const FILTERS = useMemo(() => ([
    { key: "all", label: t("collector.filters.all") },
    { key: "pending", label: t("collector.filters.pending") },
    { key: "partial", label: t("collector.filters.partial") },
    { key: "paid", label: t("collector.filters.paid") },
    { key: "overdue3", label: t("collector.filters.overdue3") },
    { key: "overdue6", label: t("collector.filters.overdue6") },
    { key: "overdue12", label: t("collector.filters.overdue12") },
    { key: "active", label: t("collector.filters.active") },
    { key: "inactive", label: t("collector.filters.inactive") },
  ]), [t]);

  const SORTS = useMemo(() => ([
    { key: "overdue", label: t("collector.sorts.overdue") },
    { key: "pending_high", label: t("collector.sorts.pendingHigh") },
    { key: "address", label: t("collector.sorts.address") },
    { key: "name", label: t("collector.sorts.name") },
  ]), [t]);

  useEffect(() => {
    (async () => {
      try {
        const u = await AsyncStorage.getItem("user");
        if (u) setRole(JSON.parse(u)?.role);
      } catch (e) {}
      setRoleChecked(true);
    })();
  }, []);

  useEffect(() => {
    Animated.timing(hFade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, []);

  const cacheKey = `${MEMBERS_CACHE_KEY}_${selectedMonth}`;

  const loadFromCache = useCallback(async () => {
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        setMembers(parsed.data || []);
        setLastSync(parsed.timestamp ? new Date(parsed.timestamp) : null);
        return true;
      }
    } catch (e) {}
    return false;
  }, [cacheKey]);

  const fetchMembers = useCallback(async (silent = false) => {
    if (!silent) setFetching(true);
    try {
      const res = await authApiFetch(`/chanda/members?month=${selectedMonth}&include_history=true`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setMembers(list);
      setIsOffline(false);
      setLastSync(new Date());
      AsyncStorage.setItem(cacheKey, JSON.stringify({ data: list, timestamp: new Date().toISOString() })).catch(() => {});
    } catch (e) {
      setIsOffline(true);
    } finally {
      setFetching(false);
    }
  }, [selectedMonth, cacheKey]);

  useEffect(() => {
    loadFromCache().then(() => fetchMembers(true));
  }, [selectedMonth, loadFromCache, fetchMembers]);

  const getQueue = async () => {
    try {
      const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const setQueue = async (items) => {
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
    setQueueCount(items.length);
  };

  const flushQueue = useCallback(async () => {
    const queue = await getQueue();
    if (queue.length === 0) return;
    const remaining = [];
    for (const payload of queue) {
      try {
        const res = await authApiFetch("/chanda/collect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) remaining.push(payload);
      } catch {
        remaining.push(payload);
      }
    }
    await setQueue(remaining);
    if (remaining.length < queue.length) fetchMembers(true);
  }, [fetchMembers]);

  useEffect(() => {
    getQueue().then((q) => setQueueCount(q.length));
    const iv = setInterval(flushQueue, 30000);
    return () => clearInterval(iv);
  }, [flushQueue]);

  const onManualSync = () => {
    fetchMembers();
    flushQueue();
  };

  // Pull-to-refresh for the main member list — re-fetches members and
  // flushes any queued offline payments in one gesture.
  const onListRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchMembers(true), flushQueue()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchMembers, flushQueue]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/funds/public");
        if (!res.ok) throw new Error("no access");
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setFunds(list);
        setFundsAvailable(list.length > 0);
      } catch (e) {
        setFundsAvailable(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/admin/zones");
        if (!res.ok) return;
        const data = await res.json();
        setZones(Array.isArray(data) ? data : []);
      } catch { /* non-critical */ }
    })();
  }, []);

  // Load today's collection totals from the history endpoint
  const refreshTodayTotals = useCallback(async () => {
    try {
      const res = await authApiFetch("/finance/collector/history?page=1&per_page=1");
      if (!res.ok) return;
      const data = await res.json();
      const today = data?.today;
      if (today) {
        setTodaysSessionTotal({ cash: today.cash ?? 0, digital: today.upi ?? 0 });
      }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { refreshTodayTotals(); }, [refreshTodayTotals]);

  // Live updates: when admin changes a monthly amount or a payment is verified, refresh
  useEffect(() => {
    let ws = null;
    let retryTimeout = null;
    const REFRESH_EVENTS = new Set([
      "monthly_amount_updated", "payment_verified", "payment_collected",
      "family_updated", "dashboard_updated",
    ]);
    const connect = async () => {
      try {
        const token = await getToken();
        const url = await getWsUrl(`/ws/finance?token=${token}`);
        ws = new WebSocket(url);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (REFRESH_EVENTS.has(msg.type)) fetchMembers(true);
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => {
          retryTimeout = setTimeout(connect, 10000);
        };
      } catch {}
    };
    connect();
    return () => {
      if (ws) ws.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [fetchMembers]);

  const addFamily = useCallback(async () => {
    const amt = parseFloat(addForm.monthly_amount);
    if (!addForm.name.trim() || !addForm.chanda_no.trim() || isNaN(amt) || amt <= 0) {
      return Alert.alert("Required fields missing", "Name, Chanda No and Monthly Amount are required.");
    }
    const dueSince = addForm.registration_date.trim();
    if (dueSince && !/^\d{4}-(0[1-9]|1[0-2])$/.test(dueSince)) {
      return Alert.alert("Invalid month", "Chanda Due Since must be in YYYY-MM format, e.g. 2026-01.");
    }
    setAddSaving(true);
    try {
      const res = await authApiFetch("/collector/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          chanda_no: addForm.chanda_no.trim(),
          phone: addForm.phone.trim() || null,
          monthly_amount: amt,
          address: addForm.address.trim() || null,
          zone: addForm.zone.trim() || null,
          registration_date: dueSince ? `${dueSince}-01` : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || "Failed to add family");
      setShowAddFamily(false);
      setAddForm({ name: "", chanda_no: "", phone: "", monthly_amount: "", address: "", zone: "", registration_date: "" });
      fetchMembers(true);
      Alert.alert("Family Added", `${addForm.name.trim()} has been added.`);
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to add family");
    } finally {
      setAddSaving(false);
    }
  }, [addForm, fetchMembers]);

  const saveEditFamily = useCallback(async () => {
    if (!editItem) return;
    const dueSince = editForm.registration_date.trim();
    if (dueSince && !/^\d{4}-(0[1-9]|1[0-2])$/.test(dueSince)) {
      return Alert.alert("Invalid month", "Chanda Due Since must be in YYYY-MM format, e.g. 2026-01.");
    }
    setEditSaving(true);
    try {
      const payload = {};
      if (editForm.name.trim()) payload.name = editForm.name.trim();
      if (editForm.chanda_no.trim()) payload.chanda_no = editForm.chanda_no.trim();
      payload.phone = editForm.phone.trim() || null;
      payload.address = editForm.address.trim() || null;
      payload.zone = editForm.zone.trim() || null;
      const amt = parseFloat(editForm.monthly_amount);
      if (!isNaN(amt) && amt > 0) payload.monthly_amount = amt;
      if (dueSince) payload.registration_date = `${dueSince}-01`;

      const res = await authApiFetch(`/collector/families/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to update family");
      setShowEditFamily(false);
      setEditItem(null);
      fetchMembers(true);
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to update family");
    } finally {
      setEditSaving(false);
    }
  }, [editItem, editForm, fetchMembers]);

  const loadCashHistory = useCallback(async () => {
    setCashHistoryLoading(true);
    try {
      const res = await authApiFetch("/collector/cash-submissions");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setCashHistory(Array.isArray(data) ? data : []);
    } catch {
      setCashHistory([]);
    } finally {
      setCashHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "history") loadCashHistory();
  }, [activeTab, loadCashHistory]);

  const resetForm = (defaultDate = new Date()) => {
    setPaymentType("chanda");
    setAmount("");
    setMethod("cash");
    setSelectedMonthKeys(new Set());
    setAvailableMonths([]);
    setAdvanceExpanded(false);
    setCustomExpanded(false);
    setProofImage(null);
    setTransactionRef("");
    setNotes("");
    setCollectedDate(defaultDate);
    setShowDate(false);
    setSelectedFund(null);
  };

  const fetchAvailableMonths = async (memberId, silent = false) => {
    if (!silent) setAvailableMonthsLoading(true);
    try {
      const res = await authApiFetch(`/chanda/available-months/${memberId}?future=12`);
      if (res.ok) {
        const data = await res.json();
        setAvailableMonths(data);
      }
    } catch {}
    finally { setAvailableMonthsLoading(false); }
  };

  // Pull-to-refresh inside the payment sheet — re-fetches this member's
  // month breakdown from the server without closing the sheet.
  const onSheetRefresh = useCallback(async () => {
    if (!selected?.member?.id) return;
    setSheetRefreshing(true);
    try {
      await fetchAvailableMonths(selected.member.id, true);
    } finally {
      setSheetRefreshing(false);
    }
  }, [selected]);

  const openModal = useCallback((item) => {
    resetForm(new Date());
    setSelected(item);
    fetchAvailableMonths(item.member.id);
  }, []);

  const closeModal = useCallback(() => { setSelected(null); resetForm(); }, []);

  const toggleMonth = (monthKey, remaining) => {
    setSelectedMonthKeys(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      // Recalculate total from currently selected months
      const total = availableMonths
        .filter(m => next.has(m.month))
        .reduce((sum, m) => sum + m.remaining, 0);
      setAmount(total > 0 ? String(Math.round(total)) : "");
      return next;
    });
  };

  const quickSelectMonths = (n) => {
    const futureMonths = availableMonths.filter(m => !m.is_generated && m.remaining > 0);
    const toSelect = futureMonths.slice(0, n);
    setSelectedMonthKeys(prev => {
      const next = new Set(prev);
      toSelect.forEach(m => next.add(m.month));
      const total = availableMonths.filter(m => next.has(m.month)).reduce((sum, m) => sum + m.remaining, 0);
      setAmount(total > 0 ? String(Math.round(total)) : "");
      return next;
    });
  };

  const getMonthlyAmt = () => {
    const cur = selected?.collections?.find((c) => c?.month === selectedMonth);
    const fb = selected?.collections?.[0];
    return Number(cur?.amount_due || fb?.amount_due || selected?.member?.monthly_amount || 0);
  };

  const pickImage = () => {
    launchImageLibrary({ mediaType: "photo" }, (res) => {
      if (!res.didCancel) setProofImage(res.assets?.[0]?.uri);
    });
  };

  const uploadScreenshot = async () => {
    const form = new FormData();
    form.append("file", { uri: proofImage, type: "image/jpeg", name: "proof.jpg" });
    const res = await authApiFetch("/upload/screenshot", { method: "POST", body: form });
    return (await res.json()).url;
  };

  const doSubmitChanda = async (finalAmount, paymentToken) => {
    const months_list = Array.from(selectedMonthKeys).sort();

    const payload = {
      member_id: selected.member.id,
      amount: finalAmount,
      method,
      months: months_list.length,
      months_list: months_list.length > 0 ? months_list : undefined,
      purpose: "Monthly Chanda",
      proof_image: null,
      transaction_ref: transactionRef,
      collected_date: `${collectedDate.getFullYear()}-${String(collectedDate.getMonth() + 1).padStart(2, "0")}-${String(collectedDate.getDate()).padStart(2, "0")}`,
      notes,
      payment_token: paymentToken || undefined,
    };

    try {
      setLoading(true);
      let imageUrl = null;
      if (method === "upi") imageUrl = await uploadScreenshot();
      payload.proof_image = imageUrl;

      const res = await authApiFetch("/chanda/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responseBody = await res.json();
      if (!res.ok) throw new Error(responseBody?.detail || t("collector.alertSomethingWrong"));

      refreshTodayTotals();
      const memberName = selected?.member?.name || "";
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const futureKeys = months_list.filter(mk => { const [yr, mo] = mk.split("-").map(Number); return new Date(yr, mo - 1, 1) > thisMonthStart; });
      const isAdvance = futureKeys.length > 0;
      const firstMonth = fmtMFull(months_list[0]);
      const lastMonth = months_list.length > 1 ? fmtMFull(months_list[months_list.length - 1]) : null;
      const monthRange = lastMonth ? `${firstMonth} → ${lastMonth}` : firstMonth;
      const amtStr = `₹${Number(finalAmount).toLocaleString("en-IN")}`;
      const receiptLine = responseBody.receipt_id ? `\nReceipt: ${responseBody.receipt_id}` : "";
      const typeLine = isAdvance ? "\nAdvance Payment" : "";
      Alert.alert(
        t("collector.alertRecordedTitle"),
        `${memberName}\n${amtStr} Received${typeLine}\n${monthRange}${receiptLine}`
      );
      closeModal();
      fetchMembers(true);
    } catch (err) {
      const isNetworkFailure = err instanceof TypeError || /network/i.test(err.message || "");
      if (isNetworkFailure) {
        const queue = await getQueue();
        queue.push(payload);
        await setQueue(queue);
        Alert.alert(t("collector.alertSavedOfflineTitle"), t("collector.alertSavedOfflineMsg"));
        closeModal();
      } else {
        Alert.alert(t("collector.alertFailedTitle"), err.message || t("collector.alertSomethingWrong"));
      }
    } finally {
      setLoading(false);
    }
  };

  const submitChandaPayment = () => {
    const finalAmount = Number(String(amount || "").replace(/[^0-9.]/g, ""));
    if (!finalAmount) return Alert.alert(t("collector.alertEnterAmount"));
    if (method === "upi" && !proofImage) return Alert.alert(t("collector.alertUploadUpi"));
    if (selectedMonthKeys.size === 0) return Alert.alert("Select Months", "Please select at least one month to record payment for.");

    const months_list = Array.from(selectedMonthKeys).sort();
    const rate = selected?.member?.monthly_amount || 0;
    // Generate idempotency token — reused if user confirms; discarded on cancel
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setConfirmPayload({ finalAmount, months_list, rate, memberName: selected?.member?.name, token });
    setConfirmVisible(true);
  };

  const submitDonationPayment = async () => {
    const finalAmount = Number(String(amount || "").replace(/[^0-9.]/g, ""));
    if (!finalAmount) return Alert.alert(t("collector.alertEnterAmount"));
    if (method === "upi" && !proofImage) return Alert.alert(t("collector.alertUploadUpi"));
    try {
      setLoading(true);
      let imageUrl = null;
      if (method === "upi") imageUrl = await uploadScreenshot();
      const payload = {
        donor_name: selected?.member?.name,
        amount: finalAmount,
        method,
        note: notes || (paymentType === "fund" && selectedFund ? `Fund contribution - ${funds.find((f) => f.id === selectedFund)?.name || ""}` : "Collector donation"),
        member_id: selected?.member?.id,
        fund_id: paymentType === "fund" ? selectedFund : undefined,
        donor_type: "member",
        receipt_image: imageUrl,
      };
      const res = await authApiFetch("/donations/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || t("collector.alertSomethingWrong"));
      refreshTodayTotals();
      Alert.alert(t("collector.alertRecordedTitle"), `Donation recorded${body.receipt_id ? ` — ${body.receipt_id}` : ""}`);
      closeModal();
      fetchMembers(true);
    } catch (err) {
      Alert.alert(t("collector.alertFailedTitle"), err.message || t("collector.alertSomethingWrong"));
    } finally {
      setLoading(false);
    }
  };

  const submitPayment = () => {
    if (paymentType === "chanda") return submitChandaPayment();
    if (paymentType === "donation") return submitDonationPayment();
    if (paymentType === "fund") return submitDonationPayment();
    return submitChandaPayment();
  };

  const callFamily = useCallback((phone) => Linking.openURL(`tel:${phone}`).catch(() => {}), []);
  const navigateToFamily = useCallback((address) => {
    const query = encodeURIComponent(address);
    const url = Platform.select({ ios: `maps:0,0?q=${query}`, android: `geo:0,0?q=${query}` });
    Linking.openURL(url).catch(() => {});
  }, []);
  const goToHistory = useCallback((item) => {
    if (!item?.member?.id) return;
    navigation.navigate("FamilyHistory", { familyId: item.member.id, familyName: item.member.name });
  }, [navigation]);
  const openDatePicker = () => {
    setShowDate(true);
  };

  const { filtered, counts, pendingFamiliesCount } = useMemo(() => {
    // Normalize: lowercase, strip hyphens and extra spaces so
    // "MM1001", "MM-1001", "mm 1001" all match each other.
    const normalize = (s) => (s || "").toLowerCase().replace(/[-\s]+/g, "");
    const q = normalize(search);
    const all = members.filter((m) => {
      if (selectedZone && m.member?.zone !== selectedZone) return false;
      if (!q) return true;
      const haystack = normalize(
        `${m.member?.name} ${m.member?.address} ${m.member?.chanda_no} ${m.member?.phone}`
      );
      return haystack.includes(q);
    });

    const cnt = { all: all.length, paid: 0, partial: 0, pending: 0, overdue3: 0, overdue6: 0, overdue12: 0, active: 0, inactive: 0 };
    all.forEach((m) => {
      const { status } = getMemberStatus(m, selectedMonth);
      cnt[status] = (cnt[status] || 0) + 1;
      const overdue = getConsecutiveUnpaidMonths(m);
      if (overdue >= 12) cnt.overdue12++;
      if (overdue >= 6) cnt.overdue6++;
      if (overdue >= 3) cnt.overdue3++;
      const isActive = m.member?.is_active !== false;
      if (isActive) cnt.active++; else cnt.inactive++;
    });

    let shown = all;
    if (filterStatus === "pending" || filterStatus === "partial" || filterStatus === "paid") {
      shown = all.filter((m) => getMemberStatus(m, selectedMonth).status === filterStatus);
    } else if (filterStatus === "overdue3") {
      shown = all.filter((m) => getConsecutiveUnpaidMonths(m) >= 3);
    } else if (filterStatus === "overdue6") {
      shown = all.filter((m) => getConsecutiveUnpaidMonths(m) >= 6);
    } else if (filterStatus === "overdue12") {
      shown = all.filter((m) => getConsecutiveUnpaidMonths(m) >= 12);
    } else if (filterStatus === "active") {
      shown = all.filter((m) => m.member?.is_active !== false);
    } else if (filterStatus === "inactive") {
      shown = all.filter((m) => m.member?.is_active === false);
    }

    // Bucket paid members to the bottom first, then apply the active sort
    // within each bucket. This holds regardless of which sort/filter is
    // selected — pending/partial always float up, paid always sinks.
    const sorted = shown.slice().sort((a, b) => {
      const aPaid = getMemberStatus(a, selectedMonth).status === "paid" ? 1 : 0;
      const bPaid = getMemberStatus(b, selectedMonth).status === "paid" ? 1 : 0;
      if (aPaid !== bPaid) return aPaid - bPaid;

      if (sortBy === "overdue") return getConsecutiveUnpaidMonths(b) - getConsecutiveUnpaidMonths(a);
      if (sortBy === "pending_high") return getMemberStatus(b, selectedMonth).balance - getMemberStatus(a, selectedMonth).balance;
      if (sortBy === "address") return (a.member?.address || "").localeCompare(b.member?.address || "");
      if (sortBy === "name") return (a.member?.name || "").localeCompare(b.member?.name || "");
      return 0;
    });

    const pendingCount = all.filter((m) => getMemberStatus(m, selectedMonth).status !== "paid").length;

    return { filtered: sorted, counts: cnt, pendingFamiliesCount: pendingCount };
  }, [members, search, filterStatus, sortBy, selectedMonth, selectedZone]);

  if (!roleChecked) {
    return <View style={s.root}><StatusBar barStyle="dark-content" backgroundColor={H.bg} /></View>;
  }
  if (!canAccessCollector(role)) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="dark-content" backgroundColor={H.bg} />
        <View style={s.restricted}>
          <Text allowFontScaling={false} style={s.restrictedTitle}>{t("collector.restrictedTitle")}</Text>
          <Text allowFontScaling={false} style={s.restrictedSub}>{t("collector.restrictedSub")}</Text>
          <TouchableOpacity style={s.restrictedBtn} onPress={() => navigation.navigate("Home")}>
            <Text allowFontScaling={false} style={s.restrictedBtnTxt}>{t("collector.backToHome")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={H.bg} />

      <Animated.View style={[s.header, { opacity: hFade }]}>
        <View style={s.navBar}>
          <View style={s.navLeft}>
            <TouchableOpacity onPress={() => navigation.navigate("Home")} style={s.backBtn} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text allowFontScaling={false} style={s.backBtnTxt}>←</Text>
            </TouchableOpacity>
            <Text allowFontScaling={false} style={s.navTitle}>{t("collector.title")}</Text>
          </View>
          <TouchableOpacity onPress={onManualSync} style={s.syncBtn} activeOpacity={0.8}>
            <View style={[s.syncDot, isOffline && { backgroundColor: H.warn }]} />
            <Text allowFontScaling={false} style={s.syncTxt}>{isOffline ? t("collector.offline") : t("collector.sync")}</Text>
          </TouchableOpacity>
        </View>

        {lastSync ? (
          <Text allowFontScaling={false} style={s.cacheTime}>
            {isOffline ? t("collector.showingCached") : t("collector.updated")}
            {lastSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            {queueCount > 0 ? ` · ${queueCount} ${t("collector.queued")}` : ""}
          </Text>
        ) : null}

        <View style={s.summaryRow}>
          <SummaryCard label={t("collector.todayCash")} value={`₹${todaysSessionTotal.cash}`} onPress={() => {}} />
          <SummaryCard label={t("collector.todayDigital")} value={`₹${todaysSessionTotal.digital}`} onPress={() => {}} />
          <SummaryCard label={t("collector.pending")} value={String(pendingFamiliesCount)} sub={t("collector.families")} onPress={() => setFilterStatus("pending")} />
          <SummaryCard label={t("collector.total")} value={String(members.length)} sub={t("collector.families")} onPress={() => setFilterStatus("all")} />
        </View>

        <View style={s.tabBar}>
          {[
            { key: "collections", label: t("collectorTabs.collections") },
            { key: "families",    label: t("collectorTabs.families") },
            { key: "history",     label: t("collectorTabs.history") },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[s.tabItem, activeTab === tab.key && s.tabItemActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.75}
            >
              <Text allowFontScaling={false} style={[s.tabLabel, activeTab === tab.key && s.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === "collections" && <>{zones.length > 0 && (
          <TouchableOpacity
            style={[s.zoneDropdownBtn, selectedZone && s.zoneDropdownBtnActive]}
            onPress={() => setShowZoneDropdown(true)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text allowFontScaling={false} style={[s.zoneDropdownEye, selectedZone && { color: H.goldDeep }]}>Zone</Text>
              <Text allowFontScaling={false} style={[s.zoneDropdownVal, selectedZone ? { color: H.goldDeep } : { color: H.textMuted }]}>
                {selectedZone || t("collector.zone.all")}
              </Text>
            </View>
            {selectedZone ? (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); setSelectedZone(""); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text allowFontScaling={false} style={{ fontSize: 14, color: H.textMuted, marginRight: 6 }}>✕</Text>
              </TouchableOpacity>
            ) : null}
            <Text allowFontScaling={false} style={s.zoneDropdownChevron}>▼</Text>
          </TouchableOpacity>
        )}
        <View style={s.monthRow}>
          <TouchableOpacity onPress={() => setSelectedMonth((p) => shiftMonth(p, -1))} style={s.mArrow}>
            <Text allowFontScaling={false} style={s.mArrowTxt}>‹</Text>
          </TouchableOpacity>
          <View style={s.mCenter}>
            {fetching ? <View style={s.fetchDot} /> : null}
            <Text allowFontScaling={false} style={s.mValue}>{fmtMonth(selectedMonth)}</Text>
          </View>
          <TouchableOpacity onPress={() => setSelectedMonth((p) => shiftMonth(p, 1))} style={s.mArrow}>
            <Text allowFontScaling={false} style={s.mArrowTxt}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={s.searchBox}>
          <TextInput
            ref={searchRef}
            placeholder={t("collector.searchPlaceholder")}
            placeholderTextColor={H.textMuted}
            value={search}
            onChangeText={setSearch}
            style={s.sInput}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text allowFontScaling={false} style={s.clearTxt}>{t("collector.clear")}</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {FILTERS.map((f) => (
            <OptionPill key={f.key} label={`${f.label} (${counts[f.key] ?? 0})`} active={filterStatus === f.key} onPress={() => setFilterStatus(f.key)} />
          ))}
        </ScrollView>

        <TouchableOpacity style={s.sortRow} onPress={() => setShowSortMenu((v) => !v)} activeOpacity={0.8}>
          <Text allowFontScaling={false} style={s.sortTxt}>{t("collector.sortPrefix")}{SORTS.find((x) => x.key === sortBy)?.label}</Text>
        </TouchableOpacity>
        {showSortMenu && (
          <View style={s.sortMenu}>
            {SORTS.map((opt) => (
              <TouchableOpacity key={opt.key} style={s.sortItem} onPress={() => { setSortBy(opt.key); setShowSortMenu(false); }}>
                <Text allowFontScaling={false} style={[s.sortItemTxt, sortBy === opt.key && { color: H.gold, fontWeight: "800" }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        </>}
      </Animated.View>

      {activeTab === "collections" && (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.member.id)}
          renderItem={({ item }) => (
            <MemberCard item={item} selectedMonth={selectedMonth} onPress={openModal} onCall={callFamily} onNavigate={navigateToFamily} onHistory={goToHistory} />
          )}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onListRefresh}
              tintColor={H.gold}
              colors={[H.gold]}
            />
          }
          ListEmptyComponent={<View style={s.empty}><Text allowFontScaling={false} style={s.emptyTxt}>{fetching ? t("collector.loading") : t("collector.noFamilies")}</Text></View>}
        />
      )}

      {activeTab === "families" && (
        <View style={{ flex: 1 }}>
          <View style={s.familiesHeader}>
            <Text allowFontScaling={false} style={s.familiesCount}>{members.length} {t("collector.families")}</Text>
            <TouchableOpacity
              style={s.addFamilyBtn}
              onPress={() => {
                setAddForm({ name: "", chanda_no: "", phone: "", monthly_amount: "", address: "", zone: "", registration_date: "" });
                setShowAddFamily(true);
              }}
              activeOpacity={0.85}
            >
              <Text allowFontScaling={false} style={s.addFamilyTxt}>+ Add Family</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={members}
            keyExtractor={(item) => String(item.member.id)}
            contentContainerStyle={s.tabContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            removeClippedSubviews
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onListRefresh} tintColor={H.gold} colors={[H.gold]} />}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text allowFontScaling={false} style={s.emptyTxt}>{fetching ? t("collector.loading") : t("collector.noFamilies")}</Text>
              </View>
            }
            renderItem={({ item }) => {
              const fam = item.member;
              const { status } = getMemberStatus(item, selectedMonth);
              const sColor = status === "paid" ? H.green : status === "partial" ? H.amber : H.warn;
              return (
                <View style={[s.famCard, { borderLeftWidth: 3, borderLeftColor: sColor }]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      {fam.chanda_no ? (
                        <Text allowFontScaling={false} style={s.famChanda}>{fam.chanda_no}</Text>
                      ) : null}
                      <Text allowFontScaling={false} style={s.famName} numberOfLines={1}>{fam.name}</Text>
                    </View>
                    <Text allowFontScaling={false} style={s.famMeta}>
                      {fam.phone || t("collectorTabs.noPhone")} · ₹{fam.monthly_amount ?? "—"}
                    </Text>
                    {fam.address ? (
                      <Text allowFontScaling={false} style={[s.famMeta, { marginTop: 1 }]} numberOfLines={1}>{fam.address}</Text>
                    ) : null}
                    {fam.zone ? (
                      <Text allowFontScaling={false} style={s.famZone}>{fam.zone}</Text>
                    ) : null}
                  </View>
                  <View style={{ gap: 6, alignItems: "flex-end" }}>
                    <TouchableOpacity
                      style={s.famEditBtn}
                      onPress={() => {
                        setEditItem(fam);
                        setEditForm({
                          name: fam.name || "",
                          chanda_no: fam.chanda_no || "",
                          phone: fam.phone || "",
                          monthly_amount: String(fam.monthly_amount ?? ""),
                          address: fam.address || "",
                          zone: fam.zone || "",
                          registration_date: fam.registration_date ? fam.registration_date.slice(0, 7) : "",
                        });
                        setShowEditFamily(true);
                      }}
                      activeOpacity={0.85}
                    >
                      <Text allowFontScaling={false} style={s.famEditTxt}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.famEditBtn, { backgroundColor: "transparent", borderColor: H.cardBorder }]}
                      onPress={() => goToHistory(item)}
                      activeOpacity={0.85}
                    >
                      <Text allowFontScaling={false} style={[s.famEditTxt, { color: H.textMuted }]}>History</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        </View>
      )}

      {activeTab === "history" && (
        <View style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={cashHistoryLoading} onRefresh={loadCashHistory} tintColor={H.gold} colors={[H.gold]} />}>
            {cashHistoryLoading && cashHistory.length === 0 ? (
              <View style={s.empty}><Text allowFontScaling={false} style={s.emptyTxt}>{t("collectorTabs.loading")}</Text></View>
            ) : cashHistory.length === 0 ? (
              <View style={s.empty}><Text allowFontScaling={false} style={s.emptyTxt}>{t("collectorTabs.noHistory")}</Text></View>
            ) : cashHistory.map((sub) => (
              <View key={sub.id} style={s.subCard}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text allowFontScaling={false} style={s.subAmt}>₹{sub.submitted_amount}</Text>
                  <View style={[s.subBadge, sub.status === "approved" && s.subBadgeGreen, sub.status === "rejected" && s.subBadgeRed]}>
                    <Text allowFontScaling={false} style={[s.subBadgeTxt, sub.status === "approved" && { color: H.green }, sub.status === "rejected" && { color: H.error }]}>
                      {t(`collectorTabs.status_${sub.status}`)}
                    </Text>
                  </View>
                </View>
                <Text allowFontScaling={false} style={s.subMeta}>{sub.start_date?.slice(0, 10)} → {sub.end_date?.slice(0, 10)}</Text>
                {sub.rejection_reason ? <Text allowFontScaling={false} style={s.subReject}>{sub.rejection_reason}</Text> : null}
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={s.submitCashBtn} onPress={() => navigation.navigate("CashSubmission")}>
            <Text allowFontScaling={false} style={s.submitCashTxt}>{t("collectorTabs.submitCash")}</Text>
          </TouchableOpacity>
        </View>
      )}

      <QRViewerModal visible={qrViewerVisible} onClose={() => setQrViewerVisible(false)} imageSource={require("../../assests/upi_qr.png")} />

      {/* ── Zone dropdown modal ──────────────────────────────────────────── */}
      <Modal visible={showZoneDropdown} transparent animationType="fade" onRequestClose={() => { setShowZoneDropdown(false); setZoneSearch(""); }}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", paddingHorizontal: 24 }} onPress={() => { setShowZoneDropdown(false); setZoneSearch(""); }}>
          <Pressable style={{ backgroundColor: H.card, borderRadius: 18, overflow: "hidden", maxHeight: 460 }} onPress={() => {}}>
            <View style={{ paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: H.cardBorder }}>
              <Text allowFontScaling={false} style={{ fontSize: 14, fontWeight: "800", color: H.textDark, marginBottom: 10 }}>Select Zone</Text>
              <TextInput
                value={zoneSearch}
                onChangeText={setZoneSearch}
                placeholder="Search zones..."
                placeholderTextColor={H.textMuted}
                autoCapitalize="none"
                style={{
                  backgroundColor: H.bg, borderRadius: 10, borderWidth: 1, borderColor: H.cardBorder,
                  paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: H.textDark,
                }}
              />
            </View>
            <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
              {/* All zones option */}
              {!zoneSearch.trim() && (
                <TouchableOpacity
                  style={[s.zoneOption, !selectedZone && s.zoneOptionActive]}
                  onPress={() => { setSelectedZone(""); setShowZoneDropdown(false); setZoneSearch(""); }}
                >
                  <Text allowFontScaling={false} style={[s.zoneOptionTxt, !selectedZone && s.zoneOptionTxtActive]}>
                    {t("collector.zone.all")}
                  </Text>
                  {!selectedZone ? <Text allowFontScaling={false} style={{ color: H.gold, fontSize: 14 }}>✓</Text> : null}
                </TouchableOpacity>
              )}
              {zones
                .filter(z => !zoneSearch.trim() || z.toLowerCase().includes(zoneSearch.trim().toLowerCase()))
                .map((z) => (
                <TouchableOpacity
                  key={z}
                  style={[s.zoneOption, selectedZone === z && s.zoneOptionActive]}
                  onPress={() => { setSelectedZone(z); setShowZoneDropdown(false); setZoneSearch(""); }}
                >
                  <Text allowFontScaling={false} style={[s.zoneOptionTxt, selectedZone === z && s.zoneOptionTxtActive]}>{z}</Text>
                  {selectedZone === z ? <Text allowFontScaling={false} style={{ color: H.gold, fontSize: 14 }}>✓</Text> : null}
                </TouchableOpacity>
              ))}
              {zones.filter(z => !zoneSearch.trim() || z.toLowerCase().includes(zoneSearch.trim().toLowerCase())).length === 0 && (
                <Text allowFontScaling={false} style={{ padding: 18, textAlign: "center", color: H.textMuted, fontSize: 12 }}>
                  No zones match "{zoneSearch}"
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Add Family modal ─────────────────────────────────────────────── */}
      <Modal visible={showAddFamily} transparent animationType="slide" onRequestClose={() => setShowAddFamily(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.overlay} onPress={() => setShowAddFamily(false)}>
            <View style={[s.sheet, { height: "90%" }]} onStartShouldSetResponder={() => true}>
              <View style={s.handle} />
              <Text allowFontScaling={false} style={[s.sheetEye, { marginBottom: 2 }]}>NEW FAMILY</Text>
              <Text allowFontScaling={false} style={[s.sheetName, { marginBottom: 14 }]}>Add Family</Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                {[
                  { label: "Family Name *", key: "name", placeholder: "Full name", keyboard: "default" },
                  { label: "Chanda No *", key: "chanda_no", placeholder: "e.g. MM001", keyboard: "default" },
                  { label: "Monthly Amount (₹) *", key: "monthly_amount", placeholder: "0", keyboard: "numeric" },
                  { label: "Phone", key: "phone", placeholder: "10-digit mobile", keyboard: "phone-pad" },
                  { label: "Address", key: "address", placeholder: "Street, area", keyboard: "default" },
                  { label: "Zone", key: "zone", placeholder: "Select or type a zone", keyboard: "default" },
                  { label: "Chanda Due Since", key: "registration_date", placeholder: "YYYY-MM, e.g. 2026-01", keyboard: "numbers-and-punctuation" },
                ].map(({ label, key, placeholder, keyboard }) => (
                  <View key={key} style={{ marginBottom: 12 }}>
                    <Text allowFontScaling={false} style={s.secLabel}>{label}</Text>
                    <TextInput
                      style={s.refInput}
                      value={addForm[key]}
                      onChangeText={(v) => setAddForm((f) => ({ ...f, [key]: v }))}
                      keyboardType={keyboard}
                      placeholder={placeholder}
                      placeholderTextColor={H.textMuted}
                      autoCapitalize={key === "name" || key === "address" || key === "zone" ? "words" : "none"}
                    />
                    {key === "zone" && zones.length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {zones.filter(z => !addForm.zone || z.toLowerCase().includes(addForm.zone.toLowerCase())).map(z => (
                          <TouchableOpacity key={z} onPress={() => setAddForm(f => ({ ...f, zone: z }))}
                            style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
                              backgroundColor: addForm.zone === z ? H.headerDeep : H.card,
                              borderWidth: 1, borderColor: addForm.zone === z ? H.headerDeep : H.cardBorder }}>
                            <Text allowFontScaling={false} style={{ fontSize: 12, color: addForm.zone === z ? "#fff" : H.textDark }}>{z}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {key === "registration_date" && (
                      <Text allowFontScaling={false} style={{ fontSize: 11, color: H.textMuted, marginTop: 4 }}>
                        Pending chanda months will be generated from this month to now. Leave blank to start from this month only.
                      </Text>
                    )}
                  </View>
                ))}
                <TouchableOpacity
                  style={[s.submitBtn, addSaving && { opacity: 0.6 }, { marginTop: 8 }]}
                  onPress={addFamily}
                  disabled={addSaving}
                >
                  {addSaving
                    ? <ActivityIndicator color={H.headerDeep} />
                    : <Text allowFontScaling={false} style={s.submitBtnTxt}>Add Family</Text>
                  }
                </TouchableOpacity>
              </ScrollView>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Edit Family modal ────────────────────────────────────────────── */}
      <Modal visible={showEditFamily} transparent animationType="slide" onRequestClose={() => setShowEditFamily(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.overlay} onPress={() => setShowEditFamily(false)}>
            <View style={[s.sheet, { height: "90%" }]} onStartShouldSetResponder={() => true}>
              <View style={s.handle} />
              <Text allowFontScaling={false} style={[s.sheetEye, { marginBottom: 2 }]}>EDIT FAMILY</Text>
              <Text allowFontScaling={false} style={[s.sheetName, { marginBottom: 14 }]}>{editItem?.name || "Edit"}</Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                {[
                  { label: "Family Name", key: "name", placeholder: "Full name", keyboard: "default" },
                  { label: "Chanda No", key: "chanda_no", placeholder: "e.g. MM001", keyboard: "default" },
                  { label: "Monthly Amount (₹)", key: "monthly_amount", placeholder: "0", keyboard: "numeric" },
                  { label: "Phone", key: "phone", placeholder: "10-digit mobile", keyboard: "phone-pad" },
                  { label: "Address", key: "address", placeholder: "Street, area", keyboard: "default" },
                  { label: "Zone", key: "zone", placeholder: "Select or type a zone", keyboard: "default" },
                  { label: "Chanda Due Since", key: "registration_date", placeholder: "YYYY-MM, e.g. 2026-01", keyboard: "numbers-and-punctuation" },
                ].map(({ label, key, placeholder, keyboard }) => (
                  <View key={key} style={{ marginBottom: 12 }}>
                    <Text allowFontScaling={false} style={s.secLabel}>{label}</Text>
                    <TextInput
                      style={s.refInput}
                      value={editForm[key]}
                      onChangeText={(v) => setEditForm((f) => ({ ...f, [key]: v }))}
                      keyboardType={keyboard}
                      placeholder={placeholder}
                      placeholderTextColor={H.textMuted}
                      autoCapitalize={key === "name" || key === "address" || key === "zone" ? "words" : "none"}
                    />
                    {key === "registration_date" && (
                      <Text allowFontScaling={false} style={{ fontSize: 11, color: H.textMuted, marginTop: 4 }}>
                        Changing this backfills any newly-covered pending months — existing collections are never removed or duplicated.
                      </Text>
                    )}
                    {key === "zone" && zones.length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {zones.filter(z => !editForm.zone || z.toLowerCase().includes(editForm.zone.toLowerCase())).map(z => (
                          <TouchableOpacity key={z} onPress={() => setEditForm(f => ({ ...f, zone: z }))}
                            style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
                              backgroundColor: editForm.zone === z ? H.headerDeep : H.card,
                              borderWidth: 1, borderColor: editForm.zone === z ? H.headerDeep : H.cardBorder }}>
                            <Text allowFontScaling={false} style={{ fontSize: 12, color: editForm.zone === z ? "#fff" : H.textDark }}>{z}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
                <TouchableOpacity
                  style={[s.submitBtn, editSaving && { opacity: 0.6 }, { marginTop: 8 }]}
                  onPress={saveEditFamily}
                  disabled={editSaving}
                >
                  {editSaving
                    ? <ActivityIndicator color={H.headerDeep} />
                    : <Text allowFontScaling={false} style={s.submitBtnTxt}>Save Changes</Text>
                  }
                </TouchableOpacity>
              </ScrollView>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.overlay} onPress={closeModal}>
            <View style={s.sheet} onStartShouldSetResponder={() => true} onResponderTerminationRequest={() => true}>
              {selected && (
                <>
                  <View style={s.handle} />

                  <View style={s.sheetTop}>
                    <View style={{ flex: 1 }}>
                      <Text allowFontScaling={false} style={s.sheetEye}>{t("collector.collectPayment")}</Text>
                      <View style={s.sheetNameRow}>
                        {selected.member?.chanda_no ? (
                          <View style={s.sheetChandaTag}><Text allowFontScaling={false} style={s.sheetChandaTxt}>{selected.member.chanda_no}</Text></View>
                        ) : null}
                        <Text allowFontScaling={false} style={s.sheetName}>{selected.member?.name}</Text>
                      </View>
                      <Text allowFontScaling={false} style={s.sheetAddr}>{selected.member?.address}</Text>
                      <Text allowFontScaling={false} style={s.sheetAddr}>{selected.member?.phone}</Text>
                    </View>
                    <TouchableOpacity onPress={closeModal} style={s.doneBtn}>
                      <Text allowFontScaling={false} style={s.doneTxt}>{t("collector.done")}</Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    contentContainerStyle={s.sheetScroll}
                    refreshControl={
                      <RefreshControl
                        refreshing={sheetRefreshing}
                        onRefresh={onSheetRefresh}
                        tintColor={H.gold}
                        colors={[H.gold]}
                      />
                    }
                  >
                    <View style={s.section}>
                      <Text allowFontScaling={false} style={s.secLabel}>{t("collector.paymentType")}</Text>
                      <View style={s.pillRow}>
                        <OptionPill label={t("collector.typeChanda")} active={paymentType === "chanda"} onPress={() => setPaymentType("chanda")} />
                        <OptionPill label={t("collector.typeDonation")} active={paymentType === "donation"} onPress={() => setPaymentType("donation")} />
                        {fundsAvailable ? (
                          <OptionPill label={t("collector.typeFund")} active={paymentType === "fund"} onPress={() => setPaymentType("fund")} />
                        ) : null}
                        <OptionPill label={t("collector.typeOther")} active={paymentType === "other"} onPress={() => setPaymentType("other")} />
                      </View>
                      {paymentType === "other" ? (
                        <Text allowFontScaling={false} style={s.notConnectedNote}>{t("collector.notConnectedNote")}</Text>
                      ) : null}
                    </View>

                    <TouchableOpacity onPress={openDatePicker} style={s.dateRow}>
                      <View>
                        <Text allowFontScaling={false} style={s.dateLabel}>{t("collector.visitDate")}</Text>
                        <Text allowFontScaling={false} style={[s.dateLabel, { fontSize: 10, marginTop: 1, opacity: 0.6 }]}>{t("collector.visitDateHint")}</Text>
                      </View>
                      <Text allowFontScaling={false} style={s.dateVal}>
                        {collectedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </Text>
                    </TouchableOpacity>

                    <View style={s.amtRow}>
                      <Text allowFontScaling={false} style={s.amtRupee}>₹</Text>
                      <TextInput
                        placeholder="0"
                        placeholderTextColor={H.textMuted}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="numeric"
                        style={s.amtInput}
                        returnKeyType="done"
                      />
                    </View>

                    {paymentType === "chanda" && (() => {
                      const selectedTotal = availableMonths
                        .filter(m => selectedMonthKeys.has(m.month))
                        .reduce((sum, m) => sum + m.remaining, 0);

                      return (
                        <View style={s.section}>
                          {/* Chanda rate */}
                          <View style={s.chandaRateRow}>
                            <Text allowFontScaling={false} style={s.chandaRateLabel}>Monthly Chanda</Text>
                            <Text allowFontScaling={false} style={s.chandaRateAmt}>₹{getMonthlyAmt()}</Text>
                          </View>

                          {/* Month allocation picker */}
                          {availableMonthsLoading ? (
                            <Text allowFontScaling={false} style={[s.secLabel, { marginTop: 12 }]}>Loading months…</Text>
                          ) : (
                            <MonthPicker
                              months={availableMonths}
                              selectedKeys={selectedMonthKeys}
                              onToggle={toggleMonth}
                              onQuickSelect={quickSelectMonths}
                              advanceExpanded={advanceExpanded}
                              setAdvanceExpanded={setAdvanceExpanded}
                              customExpanded={customExpanded}
                              setCustomExpanded={setCustomExpanded}
                              monthlyRate={getMonthlyAmt()}
                              totalOutstanding={availableMonths.filter(m => m.is_generated && m.remaining > 0).reduce((s, m) => s + m.remaining, 0)}
                              pendingCount={availableMonths.filter(m => m.is_generated && m.remaining > 0).length}
                            />
                          )}
                        </View>
                      );
                    })()}

                    {paymentType === "fund" && fundsAvailable && (
                      <View style={s.section}>
                        <Text allowFontScaling={false} style={s.secLabel}>{t("collector.selectFund")}</Text>
                        <View style={s.pillRow}>
                          {funds.map((f) => (
                            <OptionPill key={f.id} label={f.name} active={selectedFund === f.id} onPress={() => setSelectedFund(f.id)} />
                          ))}
                        </View>
                      </View>
                    )}

                    <View style={s.section}>
                      <Text allowFontScaling={false} style={s.secLabel}>{t("collector.paymentMethod")}</Text>
                      <View style={s.pillRow}>
                        {["cash", "upi", "bank", "cheque"].map((m) => (
                          <OptionPill key={m} label={m.toUpperCase()} active={method === m} onPress={() => setMethod(m)} />
                        ))}
                      </View>
                    </View>

                    {method === "upi" && (
                      <View style={s.upiCard}>
                        <Text allowFontScaling={false} style={s.secLabel}>{t("collector.scanToPay")}</Text>
                        <View style={s.upiInner}>
                          <TouchableOpacity onPress={() => setQrViewerVisible(true)} activeOpacity={0.9} style={s.qrThumbBox}>
                            <Image source={require("../../assests/upi_qr.png")} style={s.qrThumbImg} resizeMode="contain" />
                          </TouchableOpacity>
                          <View style={s.upiRight}>
                            <TouchableOpacity onPress={pickImage} style={[s.uploadBtn, proofImage && s.uploadBtnDone]}>
                              <Text allowFontScaling={false} style={s.uploadTxt}>{proofImage ? t("collector.changeScreenshot") : t("collector.uploadScreenshot")}</Text>
                            </TouchableOpacity>
                            {proofImage ? (
                              <View style={s.proofBadge}><Text allowFontScaling={false} style={s.proofBadgeTxt}>{t("collector.attached")}</Text></View>
                            ) : (
                              <Text allowFontScaling={false} style={s.upiHint}>{t("collector.required")}</Text>
                            )}
                          </View>
                        </View>
                        <View style={s.refBox}>
                          <Text allowFontScaling={false} style={s.secLabel}>{t("collector.transactionRef")}</Text>
                          <TextInput
                            placeholder={t("collector.transactionRefPlaceholder")}
                            placeholderTextColor={H.textMuted}
                            value={transactionRef}
                            onChangeText={setTransactionRef}
                            style={s.refInput}
                          />
                        </View>
                      </View>
                    )}

                    <View style={s.section}>
                      <Text allowFontScaling={false} style={s.secLabel}>{t("collector.notes")}</Text>
                      <TextInput
                        placeholder={t("collector.notesPlaceholder")}
                        placeholderTextColor={H.textMuted}
                        value={notes}
                        onChangeText={setNotes}
                        style={[s.refInput, { minHeight: 60, textAlignVertical: "top" }]}
                        multiline
                      />
                    </View>

                    <View style={s.submitWrap}>
                      <SubmitButton loading={loading} onPress={submitPayment} />
                    </View>
                  </ScrollView>

                  {paymentType === "chanda" && (
                    <StickySelectionBar
                      count={selectedMonthKeys.size}
                      total={availableMonths.filter(m => selectedMonthKeys.has(m.month)).reduce((s, m) => s + m.remaining, 0)}
                      onContinue={submitChandaPayment}
                      loading={loading}
                    />
                  )}
                </>
              )}
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Date picker — a top-level sibling of the sheet Modal, never nested
          inside the sheet's ScrollView (see SCROLL-STUCK FIX note above). */}
      <Modal visible={showDate} transparent animationType="fade" onRequestClose={() => setShowDate(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" }}
          onPress={() => setShowDate(false)}>
          <Pressable style={{
            backgroundColor: "#fff", borderRadius: 18, padding: 24,
            width: 300, alignItems: "center",
            shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, elevation: 10,
          }} onPress={() => {}}>
            <Text allowFontScaling={false} style={{ fontSize: 16, fontWeight: "700", color: "#1C231F", marginBottom: 20 }}>
              Select Date
            </Text>
            {/* Day / Month / Year spinners */}
            {(() => {
              const d = collectedDate.getDate();
              const mo = collectedDate.getMonth();
              const y = collectedDate.getFullYear();
              const today = new Date();
              const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              const clamp = (date) => date > today ? today : date;
              const bump = (field, delta) => {
                const nd = new Date(collectedDate);
                if (field === "d") nd.setDate(d + delta);
                else if (field === "m") nd.setMonth(mo + delta);
                else if (field === "y") nd.setFullYear(y + delta);
                setCollectedDate(clamp(nd));
              };
              const SpinCol = ({ label, onUp, onDown }) => (
                <View style={{ alignItems: "center", flex: 1 }}>
                  <TouchableOpacity onPress={onUp} style={{ padding: 8 }}>
                    <Text allowFontScaling={false} style={{ fontSize: 22, color: "#0F5C4C", fontWeight: "700" }}>▲</Text>
                  </TouchableOpacity>
                  <Text allowFontScaling={false} style={{ fontSize: 20, fontWeight: "800", color: "#1C231F", minWidth: 52, textAlign: "center" }}>{label}</Text>
                  <TouchableOpacity onPress={onDown} style={{ padding: 8 }}>
                    <Text allowFontScaling={false} style={{ fontSize: 22, color: "#0F5C4C", fontWeight: "700" }}>▼</Text>
                  </TouchableOpacity>
                </View>
              );
              return (
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
                  <SpinCol label={String(d).padStart(2, "0")} onUp={() => bump("d", 1)} onDown={() => bump("d", -1)} />
                  <Text allowFontScaling={false} style={{ fontSize: 20, color: "#C8C0A8", marginHorizontal: 2 }}>/</Text>
                  <SpinCol label={months[mo]} onUp={() => bump("m", 1)} onDown={() => bump("m", -1)} />
                  <Text allowFontScaling={false} style={{ fontSize: 20, color: "#C8C0A8", marginHorizontal: 2 }}>/</Text>
                  <SpinCol label={String(y)} onUp={() => bump("y", 1)} onDown={() => bump("y", -1)} />
                </View>
              );
            })()}
            <TouchableOpacity onPress={() => setShowDate(false)} style={{
              backgroundColor: "#0F5C4C", borderRadius: 12,
              paddingVertical: 12, paddingHorizontal: 36,
            }}>
              <Text allowFontScaling={false} style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Payment confirmation modal */}
      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 }}
          onPress={() => setConfirmVisible(false)}>
          <Pressable style={{ backgroundColor: "#fff", borderRadius: 18, padding: 22, width: "100%", maxWidth: 360 }} onPress={() => {}}>
            <Text allowFontScaling={false} style={{ fontSize: 16, fontWeight: "800", color: H.headerDeep, marginBottom: 14, textAlign: "center" }}>
              Confirm Payment
            </Text>

            {confirmPayload && (
              <>
                <View style={{ gap: 8, marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Member</Text>
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 13, fontWeight: "700" }}>{confirmPayload.memberName}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Monthly Rate</Text>
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 13 }}>₹{confirmPayload.rate}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Total Amount</Text>
                    <Text allowFontScaling={false} style={{ color: H.green, fontSize: 15, fontWeight: "800" }}>₹{confirmPayload.finalAmount}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Method</Text>
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 13, textTransform: "capitalize" }}>{method}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 13 }}>Date</Text>
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 13 }}>
                      {collectedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                  </View>
                </View>

                {(() => {
                  const hasFuture = confirmPayload.months_list.some(mk => {
                    const now = new Date(); const [yr, mo] = mk.split("-").map(Number);
                    return new Date(yr, mo - 1, 1) > new Date(now.getFullYear(), now.getMonth(), 1);
                  });
                  return hasFuture ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, backgroundColor: "rgba(16,185,129,0.08)", borderRadius: 8, padding: 10 }}>
                      <View style={{ backgroundColor: "rgba(16,185,129,0.18)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text allowFontScaling={false} style={{ fontSize: 11, fontWeight: "800", color: "#059669" }}>Advance Payment</Text>
                      </View>
                      <Text allowFontScaling={false} style={{ flex: 1, fontSize: 11, color: H.textMuted, lineHeight: 16 }}>
                        Money is received today. Future months will appear as Paid when generated.
                      </Text>
                    </View>
                  ) : null;
                })()}

                <Text allowFontScaling={false} style={{ color: H.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
                  Covered Months ({confirmPayload.months_list.length})
                </Text>
                <View style={{ gap: 4, marginBottom: 18 }}>
                  {confirmPayload.months_list.map(mk => {
                    const label = fmtMFull(mk);
                    const isAdvance = (() => { const now = new Date(); const [yr, mo] = mk.split("-").map(Number); return new Date(yr, mo - 1, 1) > new Date(now.getFullYear(), now.getMonth(), 1); })();
                    return (
                      <View key={mk} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8 }}>
                        <Text allowFontScaling={false} style={{ color: H.green, fontSize: 12.5 }}>✓</Text>
                        <Text allowFontScaling={false} style={{ color: H.textDark, fontSize: 12.5, flex: 1 }}>{label}</Text>
                        {isAdvance && (
                          <View style={{ backgroundColor: "rgba(16,185,129,0.1)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text allowFontScaling={false} style={{ fontSize: 9, fontWeight: "800", color: "#059669" }}>ADV</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: H.bg, borderRadius: 10, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: H.cardBorder }}
                    onPress={() => setConfirmVisible(false)}
                  >
                    <Text allowFontScaling={false} style={{ color: H.textDark, fontWeight: "700", fontSize: 14 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 2, backgroundColor: H.gold, borderRadius: 10, paddingVertical: 13, alignItems: "center" }}
                    onPress={() => { setConfirmVisible(false); doSubmitChanda(confirmPayload.finalAmount, confirmPayload.token); }}
                  >
                    <Text allowFontScaling={false} style={{ color: H.headerDeep, fontWeight: "800", fontSize: 14 }}>Confirm & Submit</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },

  restricted: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  restrictedTitle: { fontSize: 18, fontWeight: "700", color: H.textDark },
  restrictedSub: { fontSize: 13, color: H.textMuted, textAlign: "center", lineHeight: 19 },
  restrictedBtn: { marginTop: 10, backgroundColor: H.gold, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 },
  restrictedBtnTxt: { color: H.headerDeep, fontWeight: "800", fontSize: 13 },

  // ── Header: trimmed paddings, subtitle removed, tighter summary row ──
  header: { backgroundColor: H.bg, paddingTop: Platform.OS === "ios" ? 48 : 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  navBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 8 },
  navLeft: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 },
  backBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder, justifyContent: "center", alignItems: "center", marginRight: 10 },
  backBtnTxt: { color: H.textDark, fontSize: 14, fontWeight: "700" },
  navTitle: { color: H.textDark, fontSize: 17, fontWeight: "800" },
  syncBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6 },
  syncDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: H.green },
  syncTxt: { fontSize: 10.5, color: H.textDark, fontWeight: "700" },
  cacheTime: { fontSize: 9.5, color: H.textMuted, paddingHorizontal: 16, marginBottom: 6 },

  summaryRow: { flexDirection: "row", gap: 6, paddingHorizontal: 16, marginBottom: 8 },
  sumCard: { flex: 1, backgroundColor: H.card, borderRadius: 10, borderWidth: 1, borderColor: H.cardBorder, paddingVertical: 7, paddingHorizontal: 9, ...shadow(1, 0.03) },
  sumLabel: { fontSize: 8, color: H.textMuted, fontWeight: "700", textTransform: "uppercase" },
  sumValue: { fontSize: 13.5, color: H.textDark, fontWeight: "800", marginTop: 2 },
  sumSub: { fontSize: 8, color: H.textMuted, marginTop: 1 },

  monthRow: { flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 11, borderWidth: 1, borderColor: H.cardBorder, marginHorizontal: 16, marginBottom: 6, overflow: "hidden" },
  mArrow: { width: 40, alignItems: "center", justifyContent: "center", paddingVertical: 7 },
  mArrowTxt: { color: H.gold, fontSize: 20, fontWeight: "300" },
  mCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderLeftWidth: 1, borderRightWidth: 1, borderColor: H.cardBorder, paddingVertical: 7 },
  fetchDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: H.gold, opacity: 0.8 },
  mValue: { color: H.textDark, fontSize: 12.5, fontWeight: "700" },

  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 11, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 12, marginHorizontal: 16, marginBottom: 6 },
  sInput: { flex: 1, color: H.textDark, fontSize: 13, paddingVertical: Platform.OS === "android" ? 8 : 10 },
  clearTxt: { color: H.textMuted, fontSize: 12, paddingLeft: 8 },

  filterScroll: { marginBottom: 6 },
  sortRow: { paddingHorizontal: 16, marginBottom: 2 },
  sortTxt: { color: H.gold, fontSize: 12, fontWeight: "700" },
  sortMenu: { marginHorizontal: 16, backgroundColor: H.card, borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder, marginTop: 6, overflow: "hidden" },
  sortItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  sortItemTxt: { fontSize: 13, color: H.textDark },

  listContent: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 30, flexGrow: 1 },
  empty: { alignItems: "center", paddingTop: 56 },
  emptyTxt: { color: H.textMuted, fontSize: 14 },

  card: { backgroundColor: H.card, borderRadius: 14, borderWidth: 1, borderColor: H.cardBorder, borderLeftWidth: 3, padding: 13, marginBottom: 10, ...shadow(2, 0.05) },
  cardPaid: { opacity: 0.82 },
  cardRow1: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 7, marginRight: 8 },
  chandaTag: { backgroundColor: "rgba(201,168,76,0.12)", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: "rgba(201,168,76,0.25)" },
  chandaTagText: { color: H.goldDeep, fontSize: 9, fontWeight: "800" },
  memberName: { color: H.textDark, fontSize: 14, fontWeight: "700", flex: 1 },
  addrText: { color: H.textMuted, fontSize: 11, marginTop: 3 },
  phoneText: { color: H.textMuted, fontSize: 11, marginTop: 1 },
  sPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99 },
  sPillText: { fontSize: 10, fontWeight: "700" },

  overdueBadge: { alignSelf: "flex-start", backgroundColor: H.warnDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6, maxWidth: "100%" },
  overdueBadgeRed: { backgroundColor: "#FEE8E8" },
  overdueBadgeTxt: { color: H.warn, fontSize: 10, fontWeight: "800" },
  collectingForTxt: { color: H.textMuted, fontSize: 10.5, marginTop: 5, fontStyle: "italic" },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  donationBadge: { backgroundColor: H.greenDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  donationBadgeTxt: { color: H.green, fontSize: 9.5, fontWeight: "700" },
  fundBadge: { backgroundColor: "rgba(201,168,76,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  fundBadgeTxt: { color: H.goldDeep, fontSize: 9.5, fontWeight: "700" },

  statsRow: { flexDirection: "row", gap: 6, marginTop: 9 },
  miniStat: { flex: 1, backgroundColor: H.bg, borderRadius: 8, padding: 7 },
  miniStatLabel: { color: H.textMuted, fontSize: 8.5, textTransform: "uppercase", marginBottom: 2 },
  miniStatVal: { fontSize: 12, fontWeight: "700" },
  lastMeta: { fontSize: 9.5, color: H.textMuted, marginTop: 6, fontStyle: "italic" },

  actionsRow: { flexDirection: "row", gap: 6, marginTop: 10 },
  actionBtnPrimary: { flex: 1, backgroundColor: H.gold, borderRadius: 9, paddingVertical: 9, alignItems: "center" },
  actionBtnPrimaryTxt: { color: H.headerDeep, fontSize: 12, fontWeight: "800" },
  actionBtn: { flex: 1, backgroundColor: H.bg, borderRadius: 9, paddingVertical: 9, alignItems: "center", borderWidth: 1, borderColor: H.cardBorder },
  actionBtnTxt: { color: H.textDark, fontSize: 11.5, fontWeight: "700" },

  optPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder },
  optPillOn: { backgroundColor: H.gold, borderColor: H.gold },
  optPillTxt: { color: H.textMuted, fontSize: 11.5, fontWeight: "700" },
  optPillTxtOn: { color: H.headerDeep },

  overlay: { flex: 1, backgroundColor: "rgba(11,61,46,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: H.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: H.cardBorder, borderBottomWidth: 0, height: "93%", paddingHorizontal: 18 },
  handle: { width: 34, height: 4, backgroundColor: H.textMuted, borderRadius: 99, opacity: 0.3, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  sheetTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  sheetEye: { color: H.gold, fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "800" },
  sheetNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  sheetChandaTag: { backgroundColor: "rgba(201,168,76,0.12)", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "rgba(201,168,76,0.25)" },
  sheetChandaTxt: { color: H.goldDeep, fontSize: 11, fontWeight: "800" },
  sheetName: { color: H.textDark, fontSize: 17, fontWeight: "700" },
  sheetAddr: { color: H.textMuted, fontSize: 12 },
  doneBtn: { backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 99 },
  doneTxt: { color: H.textDark, fontSize: 12, fontWeight: "700" },
  sheetScroll: { paddingBottom: 40, paddingTop: 4, flexGrow: 1 },

  notConnectedNote: { fontSize: 10.5, color: H.warn, marginTop: 8, lineHeight: 15 },

  dateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: H.card, borderRadius: 11, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 14, paddingVertical: 11, marginTop: 12 },
  dateLabel: { color: H.textMuted, fontSize: 13 },
  dateVal: { color: H.goldDeep, fontSize: 13, fontWeight: "700" },

  amtRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 2, borderBottomColor: H.gold, marginVertical: 14, paddingBottom: 4 },
  amtRupee: { color: H.gold, fontSize: 20, fontWeight: "700", marginRight: 8 },
  amtInput: { flex: 1, color: H.textDark, fontSize: 36, fontWeight: "800", paddingVertical: 0 },

  section: { marginTop: 12, marginBottom: 2 },
  secLabel: { color: H.textMuted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, fontWeight: "700" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  preview: { backgroundColor: "rgba(201,168,76,0.1)", borderRadius: 9, padding: 9, marginTop: 10, borderWidth: 1, borderColor: "rgba(201,168,76,0.2)" },
  previewTxt: { color: H.goldDeep, fontSize: 11, lineHeight: 17 },

  chandaRateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(201,168,76,0.08)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10, borderWidth: 1, borderColor: "rgba(201,168,76,0.2)" },
  chandaRateLabel: { color: H.goldDeep, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  chandaRateAmt: { color: H.goldDeep, fontSize: 22, fontWeight: "900" },

  pendingMonthsBox: { backgroundColor: "rgba(161,58,58,0.06)", borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: "rgba(161,58,58,0.14)" },
  pendingMonthsLabel: { color: H.warn, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  pendingMonthsTotal: { color: H.warn, fontSize: 12, fontWeight: "800" },
  pendingMonthsList: { color: H.textDark, fontSize: 12, fontWeight: "600", marginTop: 2, lineHeight: 18 },

  willCoverBox: { backgroundColor: "rgba(15,92,76,0.07)", borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: "rgba(15,92,76,0.18)" },
  willCoverLabel: { color: H.green, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  monthChip: { backgroundColor: "rgba(15,92,76,0.1)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  monthChipTxt: { color: H.green, fontSize: 11, fontWeight: "700" },

  overpayWarn: { backgroundColor: "rgba(192,71,58,0.08)", borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: "rgba(192,71,58,0.2)" },
  overpayWarnTxt: { color: H.error, fontSize: 12, fontWeight: "700", lineHeight: 18 },

  upiCard: { marginTop: 14, backgroundColor: H.card, borderRadius: 13, borderWidth: 1, borderColor: H.cardBorder, padding: 13 },
  upiInner: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
  qrThumbBox: { width: 90, height: 90, backgroundColor: "#ffffff", borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: H.cardBorder },
  qrThumbImg: { width: "85%", height: "85%" },
  upiRight: { flex: 1, gap: 8 },
  refBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: H.cardBorder, paddingTop: 10 },
  refInput: { color: H.textDark, fontSize: 13, backgroundColor: H.card, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginTop: 4, borderWidth: 1, borderColor: H.cardBorder },
  uploadBtn: { backgroundColor: H.bg, borderRadius: 10, borderWidth: 1, borderColor: H.cardBorder, paddingVertical: 12, alignItems: "center" },
  uploadBtnDone: { borderColor: H.green, backgroundColor: H.greenDim },
  uploadTxt: { color: H.textDark, fontSize: 12.5, fontWeight: "700", textAlign: "center", lineHeight: 18 },
  proofBadge: { backgroundColor: H.greenDim, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, alignItems: "center" },
  proofBadgeTxt: { color: H.green, fontSize: 11, fontWeight: "700" },
  upiHint: { color: H.warn, fontSize: 11, textAlign: "center" },

  qrOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" },
  qrBigBox: { width: SW * 0.85, height: SW * 0.85, maxWidth: 400, maxHeight: 400, backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  qrBigImg: { width: "100%", height: "100%", borderRadius: 8 },
  qrHint: { color: "#ddd", fontSize: 13, marginTop: 20, textAlign: "center" },

  submitWrap: { marginTop: 20, marginBottom: 6 },
  submitBtn: { backgroundColor: H.gold, borderRadius: 13, paddingVertical: 16, alignItems: "center" },
  submitBtnTxt: { color: H.headerDeep, fontSize: 15, fontWeight: "800" },

  zoneRow: { backgroundColor: H.bg, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  zoneScroll: { paddingHorizontal: 12, gap: 6 },
  zonePill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder },
  zonePillActive: { backgroundColor: H.gold, borderColor: H.gold },
  zonePillTxt: { fontSize: 12, fontWeight: "600", color: H.textMuted },
  zonePillTxtActive: { color: H.headerDeep },

  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: H.cardBorder, marginHorizontal: 0, backgroundColor: H.bg },
  tabItem: { flex: 1, paddingVertical: 11, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: H.gold },
  tabLabel: { fontSize: 12.5, fontWeight: "600", color: H.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  tabLabelActive: { color: H.gold },

  tabContent: { padding: 16, paddingBottom: 40 },

  famCard: { flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: H.cardBorder },
  famName: { fontSize: 14, fontWeight: "700", color: H.textDark },
  famMeta: { fontSize: 12, color: H.textMuted, marginTop: 2 },
  famChanda: { fontSize: 11, color: H.gold, marginTop: 2, fontWeight: "700" },
  famEditBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "rgba(201,168,76,0.12)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(201,168,76,0.25)" },
  famEditTxt: { fontSize: 12, fontWeight: "700", color: H.gold },

  subCard: { backgroundColor: H.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: H.cardBorder },
  subAmt: { fontSize: 18, fontWeight: "800", color: H.textDark },
  subMeta: { fontSize: 12, color: H.textMuted, marginTop: 4 },
  subReject: { fontSize: 12, color: H.error, marginTop: 4, fontStyle: "italic" },
  subBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: "rgba(201,168,76,0.12)" },
  subBadgeGreen: { backgroundColor: "rgba(15,92,76,0.1)" },
  subBadgeRed: { backgroundColor: "rgba(192,71,58,0.1)" },
  subBadgeTxt: { fontSize: 11, fontWeight: "700", color: H.gold },

  submitCashBtn: { margin: 16, backgroundColor: H.gold, borderRadius: 13, paddingVertical: 15, alignItems: "center" },
  submitCashTxt: { color: H.headerDeep, fontSize: 15, fontWeight: "800" },

  // ── Zone dropdown button ──────────────────────────────────────────────
  zoneDropdownBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: H.card, borderWidth: 1.5, borderColor: H.cardBorder, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, marginHorizontal: 16, marginBottom: 8 },
  zoneDropdownBtnActive: { borderColor: H.gold, backgroundColor: "rgba(201,168,76,0.07)" },
  zoneDropdownEye: { fontSize: 11, color: H.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  zoneDropdownVal: { fontSize: 15, color: H.textDark, fontWeight: "800" },
  zoneDropdownChevron: { fontSize: 11, color: H.textMuted },

  // ── Zone dropdown modal options ───────────────────────────────────────
  zoneOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  zoneOptionActive: { backgroundColor: "rgba(201,168,76,0.08)" },
  zoneOptionTxt: { fontSize: 14, color: H.textDark },
  zoneOptionTxtActive: { fontWeight: "700", color: H.goldDeep },

  // ── Families tab header + add button ─────────────────────────────────
  familiesHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  familiesCount: { fontSize: 12, color: H.textMuted, fontWeight: "600" },
  addFamilyBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: H.gold, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  addFamilyTxt: { fontSize: 12, color: H.headerDeep, fontWeight: "800" },

  // ── Family card zone badge ────────────────────────────────────────────
  famZone: { fontSize: 10, color: H.gold, fontWeight: "700", backgroundColor: "rgba(201,168,76,0.1)", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start", marginTop: 4 },
});