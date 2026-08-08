/**
 * "Pay up to" month selector — collector + self-pay.
 *
 * Advance payment is a run, not an arbitrary set. People pay ahead in an
 * unbroken span ("clear my dues and cover me to March"), and the backend already
 * allocates oldest-debt-first, so free multi-select would only let someone build
 * a selection the allocator immediately rearranges.
 *
 * One tap selects everything from the earliest unpaid month up to the month
 * tapped; tapping the last selected month steps back one. Clearing dues or
 * covering N months is a single tap, and a selection with a gap is impossible.
 *
 * Replaces a vertical list of checkbox rows — twelve advance months there meant
 * twelve taps and a lot of scrolling on a phone.
 */

import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, Platform } from "react-native";
import AnimatedPressable from "./AnimatedPressable";
import { COLORS as C, RADII } from "../config/theme";

const P = {
  card: "#FFFFFF",
  border: "rgba(11,61,46,0.10)",
  primary: C.bg,
  primaryLight: "rgba(14,107,69,0.08)",
  primaryBorder: "rgba(14,107,69,0.25)",
  textDark: C.textDark,
  textMuted: C.textMuted,
  white: C.white,
  due: "#C0473A",
  surface: "#FAFAF7",
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const describe = (key) => {
  const [y, m] = String(key).split("-");
  const short = MONTH_SHORT[Number(m) - 1] || key;
  return { short, year: y, label: `${short} ${y}` };
};

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/**
 * Turn /chanda/available-months into an ordered run of payable months.
 * Settled months are dropped — they cannot be paid twice.
 */
export function buildMonthRun(available, maxMonths = 24) {
  return (available || [])
    .filter((m) => Number(m.remaining || 0) > 0)
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .slice(0, maxMonths)
    .map((m) => ({
      month: m.month,
      ...describe(m.month),
      amount: Number(m.remaining || 0),
      isDue: !!m.is_generated,
    }));
}

function MonthRunSelector({ months, count, onCountChange, t }) {
  const dueCount = useMemo(() => months.filter((m) => m.isDue).length, [months]);
  const total = useMemo(
    () => months.slice(0, count).reduce((s, m) => s + m.amount, 0),
    [months, count],
  );

  if (!months.length) {
    return (
      <View style={s.emptyBox}>
        <Text allowFontScaling={false} style={s.emptyTxt}>
          {t ? t("collector.allPaidUp", "Fully paid up — nothing outstanding.")
             : "Fully paid up — nothing outstanding."}
        </Text>
      </View>
    );
  }

  const first = months[0];
  const last = count > 0 ? months[count - 1] : null;

  const presets = [
    ...(dueCount > 0 ? [{ key: "dues", label: `Dues · ${dueCount}`, value: dueCount }] : []),
    { key: "3", label: "3", value: 3 },
    { key: "6", label: "6", value: 6 },
    { key: "12", label: "12", value: 12 },
  ].filter((p) => p.value <= months.length);

  return (
    <View>
      {/* Summary — what is about to be charged stays on screen while choosing. */}
      <View style={[s.summary, count > 0 && s.summaryActive]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text allowFontScaling={false} style={s.summaryCap}>PAYING UP TO</Text>
          <Text allowFontScaling={false} numberOfLines={1}
            style={[s.summaryMonth, count === 0 && { color: P.textMuted }]}>
            {last ? last.label : "Select a month"}
          </Text>
          {count > 0 && (
            <Text allowFontScaling={false} style={s.summarySub}>
              {count} month{count > 1 ? "s" : ""} · from {first.label}
            </Text>
          )}
        </View>
        <Text allowFontScaling={false}
          style={[s.summaryTotal, count === 0 && { color: P.textMuted }]}>
          {money(total)}
        </Text>
      </View>

      {/* Quick picks */}
      <View style={s.presetRow}>
        {presets.map((p) => {
          const on = count === p.value;
          return (
            <AnimatedPressable key={p.key} onPress={() => onCountChange(p.value)}
              style={[s.preset, on && s.presetOn]}>
              <Text allowFontScaling={false} style={[s.presetTxt, on && s.presetTxtOn]}>
                {p.label}
              </Text>
            </AnimatedPressable>
          );
        })}
        {count > 0 && (
          <AnimatedPressable onPress={() => onCountChange(0)} style={[s.preset, s.presetClear]}>
            <Text allowFontScaling={false} style={[s.presetTxt, { color: P.textMuted }]}>Clear</Text>
          </AnimatedPressable>
        )}
      </View>

      {/* The run — horizontal so twelve months never become twelve rows. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
        // Let the parent sheet keep its vertical scroll gesture.
        directionalLockEnabled
      >
        {months.map((mo, i) => {
          const selected = i < count;
          const isLastSelected = i === count - 1;
          return (
            <AnimatedPressable
              key={mo.month}
              // Tapping the last selected month steps back, so a run can be
              // shortened without starting over.
              onPress={() => onCountChange(isLastSelected ? i : i + 1)}
              style={[
                s.chip,
                selected && s.chipOn,
                // Square off the inner edges so a selected span reads as one
                // continuous bar rather than a row of loose chips.
                selected && i > 0 && s.chipJoinLeft,
                selected && !isLastSelected && s.chipJoinRight,
              ]}
            >
              <Text allowFontScaling={false} style={[s.chipMonth, selected && s.chipTxtOn]}>
                {mo.short}
              </Text>
              <Text allowFontScaling={false} style={[s.chipYear, selected && s.chipYearOn]}>
                {mo.year}
              </Text>
              <Text allowFontScaling={false}
                style={[s.chipAmt, selected ? s.chipTxtOn : mo.isDue && { color: P.due }]}>
                {money(mo.amount)}
              </Text>
              {/* A due month is money already owed — distinguish it from an
                  optional advance month at a glance. */}
              <View style={[s.dueBar, { backgroundColor: mo.isDue
                ? (selected ? "rgba(255,255,255,0.85)" : P.due) : "transparent" }]} />
            </AnimatedPressable>
          );
        })}
      </ScrollView>

      <View style={s.legend}>
        <View style={[s.dueBar, { backgroundColor: P.due, marginTop: 0 }]} />
        <Text allowFontScaling={false} style={s.legendTxt}>Outstanding</Text>
        <Text allowFontScaling={false} style={[s.legendTxt, { marginLeft: 10 }]}>
          Tap a month to pay everything up to it
        </Text>
      </View>
    </View>
  );
}

const shadow = (y = 3, opacity = 0.06) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.6 },
    android: { elevation: y },
  });

const s = StyleSheet.create({
  emptyBox: {
    padding: 14, borderRadius: RADII.md, backgroundColor: P.primaryLight,
    borderWidth: 1, borderColor: P.primaryBorder,
  },
  emptyTxt: { fontSize: 13, color: P.primary, fontWeight: "600" },

  summary: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: RADII.md, backgroundColor: P.surface,
    borderWidth: 1, borderColor: P.border, marginBottom: 10,
  },
  summaryActive: { backgroundColor: P.primaryLight, borderColor: P.primaryBorder },
  summaryCap: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, color: P.textMuted },
  summaryMonth: { fontSize: 16, fontWeight: "800", color: P.primary, marginTop: 3 },
  summarySub: { fontSize: 11.5, color: P.textMuted, marginTop: 2 },
  summaryTotal: { fontSize: 21, fontWeight: "800", color: P.primary, fontVariant: ["tabular-nums"] },

  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  preset: {
    paddingVertical: 5, paddingHorizontal: 13, borderRadius: 999,
    borderWidth: 1.5, borderColor: P.border, backgroundColor: "transparent",
  },
  presetOn: { backgroundColor: P.primary, borderColor: P.primary },
  presetClear: { borderStyle: "dashed" },
  presetTxt: { fontSize: 12, fontWeight: "700", color: P.textDark },
  presetTxtOn: { color: P.white },

  strip: { gap: 6, paddingVertical: 2, paddingRight: 4 },
  chip: {
    width: 74, paddingVertical: 9, paddingHorizontal: 4,
    borderRadius: RADII.sm, alignItems: "center",
    backgroundColor: P.card, borderWidth: 1.5, borderColor: P.border,
    ...shadow(2, 0.05),
  },
  chipOn: { backgroundColor: P.primary, borderColor: P.primary },
  chipJoinLeft: { borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  chipJoinRight: { borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  chipMonth: { fontSize: 12.5, fontWeight: "800", color: P.textDark },
  chipYear: { fontSize: 9.5, color: P.textMuted, marginTop: 1 },
  chipYearOn: { color: "rgba(255,255,255,0.75)" },
  chipAmt: { fontSize: 11, fontWeight: "700", color: P.textMuted, marginTop: 4, fontVariant: ["tabular-nums"] },
  chipTxtOn: { color: P.white },
  dueBar: { height: 3, width: 16, borderRadius: 2, marginTop: 5 },

  legend: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7 },
  legendTxt: { fontSize: 10.5, color: P.textMuted },
});

export default React.memo(MonthRunSelector);
