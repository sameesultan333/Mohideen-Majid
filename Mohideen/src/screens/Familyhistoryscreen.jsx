/**
 * FamilyHistoryScreen.js — Mohideen Masjid
 * Payment timeline for one family, navigated to from CollectorScreen's
 * "History" action. Wired to GET /finance/reports/family/{family_id}.
 *
 * Every visible string now goes through t("familyHistory.xxx").
 */

import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, StatusBar, Platform, Image, Linking } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApiFetch, getFallbackBaseUrl } from "../config/server";
import { COLORS as C } from "../config/theme";
import { useTranslation } from "react-i18next";

const H = {
  bg: "#FBF9F4",
  card: "#FFFFFF",
  cardBorder: "rgba(11,61,46,0.08)",
  gold: C.gold,
  goldDeep: C.goldDeep,
  green: C.bgVivid,
  greenDim: "rgba(14,107,69,0.1)",
  warn: "#9A6B2E",
  warnDim: "rgba(154,107,46,0.12)",
  textDark: C.textDark,
  textMuted: C.textMuted,
  headerDeep: C.bg,
  error: "#C0473A",
};

const shadow = (y = 3, opacity = 0.05) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.5 },
    android: { elevation: y },
  });

const StatCard = ({ label, value, color }) => (
  <View style={s.statCard}>
    <Text allowFontScaling={false} style={s.statLabel}>{label}</Text>
    <Text allowFontScaling={false} style={[s.statValue, color && { color }]}>{value}</Text>
  </View>
);

// Server stores and returns datetimes in UTC without a "Z" suffix.
// Append Z so JS parses as UTC → device local time (IST = UTC+5:30).
const parseUtc = (iso) => {
  if (!iso) return null;
  const s = String(iso).trim().replace(" ", "T").split(".")[0];
  return new Date(s + "Z");
};

const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = parseUtc(iso);
  if (!d || isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
};

const fmtMonth = (ym) => {
  if (!ym) return ym;
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const PaymentRow = ({ payment }) => {
  const statusColor = payment.status === "verified" ? H.green : payment.status === "rejected" ? H.error : H.warn;
  const statusDim = payment.status === "verified" ? H.greenDim : payment.status === "rejected" ? "rgba(192,71,58,0.1)" : H.warnDim;
  const proofUri = payment.proof_image
    ? payment.proof_image.startsWith("http")
      ? payment.proof_image
      : `${getFallbackBaseUrl()}/${payment.proof_image.replace(/^\//, "")}`
    : null;

  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text allowFontScaling={false} style={s.rowAmount}>₹{payment.amount}</Text>
          <View style={[s.statusPill, { backgroundColor: statusDim }]}>
            <Text allowFontScaling={false} style={[s.statusPillTxt, { color: statusColor }]}>{payment.status?.toUpperCase()}</Text>
          </View>
        </View>
        <Text allowFontScaling={false} style={s.rowMeta}>
          {payment.method?.toUpperCase()} · {payment.collected_by || "—"}
          {payment.purpose ? ` · ${payment.purpose}` : ""}
        </Text>
        {payment.is_advance && (
          <View style={{ backgroundColor: "rgba(14,107,69,0.1)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", marginTop: 4 }}>
            <Text allowFontScaling={false} style={{ color: H.green, fontSize: 11, fontWeight: "700" }}>⬆ Advance Payment</Text>
          </View>
        )}
        {payment.covered_months?.length > 0 ? (
          <Text allowFontScaling={false} style={s.rowCoveredMonths}>
            Covers: {payment.covered_months.map(fmtMonth).join(" · ")}
          </Text>
        ) : null}
        {payment.monthly_rate_snapshot ? (
          <Text allowFontScaling={false} style={[s.rowMeta, { marginTop: 2 }]}>
            Rate: ₹{payment.monthly_rate_snapshot}/month
          </Text>
        ) : null}
        <Text allowFontScaling={false} style={s.rowDate}>
          Collected: {fmtDateTime(payment.collected_at || payment.created_at)}
        </Text>
        {payment.receipt_id ? <Text allowFontScaling={false} style={s.rowReceipt}>{payment.receipt_id}</Text> : null}
        {payment.transaction_ref ? (
          <Text allowFontScaling={false} style={s.rowMeta}>Ref: {payment.transaction_ref}</Text>
        ) : null}
      </View>
      {proofUri ? (
        <AnimatedPressable onPress={() => Linking.openURL(proofUri)} activeOpacity={0.8} style={s.proofThumb}>
          <Image source={{ uri: proofUri }} style={s.proofImg} resizeMode="cover" />
          <Text allowFontScaling={false} style={s.proofLabel}>Proof</Text>
        </AnimatedPressable>
      ) : null}
    </View>
  );
};

const CollectionRow = ({ col }) => {
  const { t } = useTranslation();
  const balance = Math.max((col.amount_due || 0) - (col.total_paid || 0), 0);
  const color = col.status === "paid" ? H.green : H.warn;
  const [y, m] = col.month.split("-").map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return (
    <View style={s.collRow}>
      <View style={{ flex: 1 }}>
        <Text allowFontScaling={false} style={s.collMonth}>{monthLabel}</Text>
        {col.is_advance && (
          <Text allowFontScaling={false} style={{ fontSize: 10, color: H.green, fontWeight: "700", marginTop: 1 }}>
            ⬆ Paid in Advance
          </Text>
        )}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text allowFontScaling={false} style={s.collAmt}>₹{col.total_paid} / ₹{col.amount_due}</Text>
        <Text allowFontScaling={false} style={[s.collStatus, { color }]}>
          {balance === 0 ? t("familyHistory.paid") : `₹${balance} ${t("familyHistory.due")}`}
        </Text>
      </View>
    </View>
  );
};

export default function FamilyHistoryScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { familyId, familyName } = route?.params || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!familyId) {
      setError(t("familyHistory.noFamilySelected"));
      setLoading(false);
      return;
    }
    try {
      const res = await authApiFetch(`/finance/reports/family/${familyId}`);
      if (!res.ok) throw new Error(t("familyHistory.loadError"));
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message || t("familyHistory.genericError"));
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={H.gold} />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={s.center}>
        <Text allowFontScaling={false} style={s.errorTxt}>{error || t("familyHistory.genericError")}</Text>
        <AnimatedPressable style={s.retryBtn} onPress={load}>
          <Text allowFontScaling={false} style={s.retryTxt}>{t("familyHistory.retry")}</Text>
        </AnimatedPressable>
      </View>
    );
  }

  const { summary, collections, payments, donations } = data;
  const lastProofUri = summary?.last_payment_proof
    ? summary.last_payment_proof.startsWith("http")
      ? summary.last_payment_proof
      : `${getFallbackBaseUrl()}/${summary.last_payment_proof.replace(/^\//, "")}`
    : null;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <AnimatedPressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text allowFontScaling={false} style={s.backTxt}>‹ {t("familyHistory.back")}</Text>
        </AnimatedPressable>
        <Text allowFontScaling={false} style={s.headerTitle} numberOfLines={1}>{familyName || data.family?.name || t("familyHistory.title")}</Text>
        <Text allowFontScaling={false} style={s.headerSub}>{data.family?.chanda_no} · {data.family?.phone}</Text>
      </View>

      <FlatList
        data={payments || []}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          <>
            <View style={s.statsGrid}>
              <StatCard label={t("familyHistory.totalDue")} value={`₹${summary?.total_due ?? 0}`} />
              <StatCard label={t("familyHistory.totalPaid")} value={`₹${summary?.total_paid ?? 0}`} color={H.green} />
              <StatCard label={t("familyHistory.outstanding")} value={`₹${summary?.total_outstanding ?? 0}`} color={summary?.total_outstanding > 0 ? H.warn : H.green} />
              <StatCard label={t("familyHistory.paidMonths")} value={`${summary?.paid_months ?? 0}/${summary?.total_months ?? 0}`} />
            </View>

            {summary?.last_payment ? (
              <View style={s.lastCard}>
                <View style={{ flex: 1 }}>
                  <Text allowFontScaling={false} style={s.lastCardLabel}>{t("familyHistory.lastPayment")}</Text>
                  <Text allowFontScaling={false} style={s.lastCardDate}>{fmtDateTime(summary.last_payment)}</Text>
                  {summary.last_payment_amount ? (
                    <Text allowFontScaling={false} style={s.lastCardAmt}>₹{summary.last_payment_amount}
                      {summary.last_payment_method ? ` · ${summary.last_payment_method.toUpperCase()}` : ""}
                      {summary.last_payment_status ? ` · ${summary.last_payment_status.toUpperCase()}` : ""}
                    </Text>
                  ) : null}
                  {summary.last_collector ? (
                    <Text allowFontScaling={false} style={s.lastCardMeta}>{t("familyHistory.by")} {summary.last_collector}</Text>
                  ) : null}
                </View>
                {lastProofUri ? (
                  <AnimatedPressable onPress={() => Linking.openURL(lastProofUri)} activeOpacity={0.8} style={s.proofThumb}>
                    <Image source={{ uri: lastProofUri }} style={s.proofImg} resizeMode="cover" />
                    <Text allowFontScaling={false} style={s.proofLabel}>Proof</Text>
                  </AnimatedPressable>
                ) : null}
              </View>
            ) : null}

            <Text allowFontScaling={false} style={s.sectionTitle}>{t("familyHistory.monthlyCollections")}</Text>
            {(collections || []).slice().reverse().map((c) => <CollectionRow key={c.month} col={c} />)}

            <Text allowFontScaling={false} style={[s.sectionTitle, { marginTop: 20 }]}>{t("familyHistory.paymentTimeline")}</Text>
            {(payments || []).length === 0 ? (
              <Text allowFontScaling={false} style={s.emptyTxt}>{t("familyHistory.noPayments")}</Text>
            ) : null}
          </>
        }
        renderItem={({ item }) => <PaymentRow payment={item} />}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          donations && donations.length > 0 ? (
            <>
              <Text allowFontScaling={false} style={[s.sectionTitle, { marginTop: 20 }]}>{t("familyHistory.donations")}</Text>
              {donations.map((d) => (
                <View key={d.id} style={s.donationRow}>
                  <Text allowFontScaling={false} style={s.rowAmount}>₹{d.amount}</Text>
                  <Text allowFontScaling={false} style={s.rowMeta}>
                    {d.method?.toUpperCase()} · {d.created_at ? fmtDateTime(d.created_at) : "—"}
                  </Text>
                </View>
              ))}
            </>
          ) : null
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: H.bg, gap: 12 },
  errorTxt: { color: H.textMuted, fontSize: 14 },
  retryBtn: { backgroundColor: H.gold, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryTxt: { color: H.headerDeep, fontWeight: "800", fontSize: 13 },

  header: { paddingTop: Platform.OS === "ios" ? 54 : 16, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: H.bg, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  backBtn: { marginBottom: 6 },
  backTxt: { color: H.gold, fontSize: 14, fontWeight: "700" },
  headerTitle: { color: H.textDark, fontSize: 19, fontWeight: "800" },
  headerSub: { color: H.textMuted, fontSize: 11, marginTop: 2 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  statCard: { flex: 1, minWidth: "45%", backgroundColor: H.card, borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder, padding: 12, ...shadow() },
  statLabel: { fontSize: 9, color: H.textMuted, fontWeight: "700", textTransform: "uppercase" },
  statValue: { fontSize: 16, color: H.textDark, fontWeight: "800", marginTop: 4 },

  lastPaymentTxt: { fontSize: 11, color: H.textMuted, marginTop: 10, fontStyle: "italic" },

  sectionTitle: { fontSize: 14, fontWeight: "700", color: H.textDark, marginTop: 18, marginBottom: 8 },

  collRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: H.card, borderRadius: 10, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 },
  collMonth: { fontSize: 12, color: H.textDark, fontWeight: "700", flex: 1 },
  collAmt: { fontSize: 11, color: H.textMuted, flex: 1, textAlign: "center" },
  collStatus: { fontSize: 11, fontWeight: "700", flex: 1, textAlign: "right" },

  listContent: { paddingHorizontal: 16, paddingBottom: 30 },
  row: { flexDirection: "row", justifyContent: "space-between", backgroundColor: H.card, borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder, padding: 12, marginBottom: 8, ...shadow() },
  rowAmount: { fontSize: 15, fontWeight: "800", color: H.textDark },
  rowMeta: { fontSize: 11, color: H.textMuted, marginTop: 3 },
  rowReceipt: { fontSize: 10, color: H.goldDeep, marginTop: 3, fontWeight: "700" },
  rowDate: { fontSize: 11, color: H.textMuted },
  statusPill: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusPillTxt: { fontSize: 9, fontWeight: "800", textTransform: "uppercase" },

  emptyTxt: { fontSize: 12, color: H.textMuted, fontStyle: "italic" },
  donationRow: { backgroundColor: H.card, borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder, padding: 12, marginBottom: 8 },

  lastCard: { flexDirection: "row", alignItems: "flex-start", backgroundColor: H.card, borderRadius: 12, borderWidth: 1, borderColor: H.cardBorder, padding: 12, marginTop: 10, marginBottom: 4, gap: 10, ...shadow() },
  lastCardLabel: { fontSize: 9, color: H.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 },
  lastCardDate: { fontSize: 12, color: H.textDark, fontWeight: "700" },
  lastCardAmt: { fontSize: 14, color: H.green, fontWeight: "800", marginTop: 3 },
  lastCardMeta: { fontSize: 11, color: H.textMuted, marginTop: 2 },

  rowCoveredMonths: { fontSize: 10, color: H.goldDeep, marginTop: 3, fontWeight: "600" },
  proofThumb: { alignItems: "center", gap: 3 },
  proofImg: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: H.cardBorder },
  proofLabel: { fontSize: 9, color: H.textMuted, fontWeight: "700", textTransform: "uppercase" },
});