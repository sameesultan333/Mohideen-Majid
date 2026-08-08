/**
 * "Pay up to" month selector.
 *
 * Advance payment is a *run*, not an arbitrary set: people pay ahead in an
 * unbroken span ("clear my dues and cover me to March"), and the payment engine
 * already allocates oldest-debt-first, so a free multi-select would only let
 * someone build a selection the allocator immediately rearranges.
 *
 * So one tap picks the whole span from the earliest unpaid month up to the
 * month tapped. Tapping the last selected month steps back one. That makes the
 * common case — clear dues, or cover N months — a single tap, and it is
 * impossible to produce a selection with a gap in it.
 *
 * Months already settled are not offered at all; they cannot be paid twice.
 */

import { useMemo } from "react";
import { COLORS, TYPOGRAPHY } from "../theme/colors";

export interface RunMonth {
  month: string;      // YYYY-MM
  label: string;      // "Aug 2026"
  short: string;      // "Aug"
  year: string;       // "2026"
  amount: number;     // outstanding balance (due) or full rate (advance)
  isDue: boolean;     // generated + unpaid, i.e. an arrear or the current month
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function describe(monthKey: string) {
  const [y, m] = monthKey.split("-");
  const short = MONTH_SHORT[Number(m) - 1] ?? monthKey;
  return { short, year: y, label: `${short} ${y}` };
}

function addMonths(monthKey: string, n: number) {
  const [y, m] = monthKey.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/**
 * Unpaid generated months (oldest first), then consecutive future months.
 * The two are joined into one continuous run so "pay up to X" spans both
 * without the user having to think about which side of today a month sits on.
 */
export function buildMonthRun(
  collections: Array<{ month: string; status: string; amount_due: number; total_paid: number }>,
  monthlyAmount: number,
  advanceMonths = 12,
): RunMonth[] {
  const unpaid = (collections ?? [])
    .filter(c => c.status !== "paid")
    .sort((a, b) => a.month.localeCompare(b.month));

  const run: RunMonth[] = unpaid.map(c => ({
    month: c.month,
    ...describe(c.month),
    amount: Math.max((c.amount_due ?? 0) - (c.total_paid ?? 0), 0),
    isDue: true,
  }));

  // Continue from the last month on record so the run never has a hole.
  const lastKnown = (collections ?? []).reduce<string | null>(
    (acc, c) => (acc === null || c.month > acc ? c.month : acc), null);
  const anchor = lastKnown ?? (run.length ? run[run.length - 1].month : null);
  const start = anchor ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  for (let i = 1; i <= advanceMonths; i++) {
    const mk = addMonths(start, i);
    run.push({ month: mk, ...describe(mk), amount: monthlyAmount, isDue: false });
  }
  return run;
}

export default function MonthRunSelector({
  months, count, onCountChange,
}: {
  months: RunMonth[];
  count: number;                       // how many months from the start are selected
  onCountChange(next: number): void;
}) {
  const dueCount = useMemo(() => months.filter(m => m.isDue).length, [months]);
  const total = useMemo(
    () => months.slice(0, count).reduce((s, m) => s + m.amount, 0),
    [months, count],
  );
  const first = months[0];
  const last  = count > 0 ? months[count - 1] : null;

  if (months.length === 0) {
    return (
      <div style={{
        padding: "14px 16px", borderRadius: 12, background: COLORS.primaryLighter,
        border: `1px solid ${COLORS.primaryBorder}`, fontSize: 13, color: COLORS.primary,
      }}>
        Nothing outstanding — this family is fully paid up.
      </div>
    );
  }

  const presets = [
    ...(dueCount > 0 ? [{ label: `Clear dues · ${dueCount}`, value: dueCount }] : []),
    { label: "3 months",  value: 3  },
    { label: "6 months",  value: 6  },
    { label: "12 months", value: 12 },
  ].filter(p => p.value <= months.length);

  return (
    <div>
      {/* Summary — the answer to "what am I about to charge?" stays visible. */}
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        gap: 12, padding: "12px 14px", borderRadius: 12, marginBottom: 10,
        background: count > 0 ? COLORS.primaryLight : "#FAFAF7",
        border: `1px solid ${count > 0 ? COLORS.primaryBorder : COLORS.border}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.07em",
            textTransform: "uppercase", color: COLORS.textMuted }}>
            Paying up to
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: count > 0 ? COLORS.primary : COLORS.textMuted,
            marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {last ? last.label : "Select a month"}
          </div>
          {count > 0 && (
            <div style={{ fontSize: 11.5, color: COLORS.textSecondary, marginTop: 2 }}>
              {count} month{count > 1 ? "s" : ""} · from {first.label}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 22, fontWeight: 800,
            color: count > 0 ? COLORS.primary : COLORS.textMuted, lineHeight: 1.1 }}>
            ₹{total.toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      {/* Quick picks */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {presets.map(p => (
          <button key={p.label} type="button" onClick={() => onCountChange(p.value)}
            style={{
              padding: "5px 11px", borderRadius: 999, fontSize: 12, fontWeight: 700,
              cursor: "pointer", background: count === p.value ? COLORS.primary : "transparent",
              color: count === p.value ? "#fff" : COLORS.textSecondary,
              border: `1.5px solid ${count === p.value ? COLORS.primary : COLORS.border}`,
            }}>
            {p.label}
          </button>
        ))}
        {count > 0 && (
          <button type="button" onClick={() => onCountChange(0)}
            style={{
              padding: "5px 11px", borderRadius: 999, fontSize: 12, fontWeight: 700,
              cursor: "pointer", background: "transparent", color: COLORS.textMuted,
              border: `1.5px dashed ${COLORS.borderStrong}`,
            }}>
            Clear
          </button>
        )}
      </div>

      {/* The run. Horizontal so twelve months fit without a wall of rows. */}
      <div style={{ position: "relative", overflowX: "auto", paddingBottom: 6 }}>
        <div style={{ display: "flex", gap: 6, minWidth: "min-content" }}>
          {months.map((mo, i) => {
            const selected = i < count;
            const isLastSelected = i === count - 1;
            return (
              <button
                key={mo.month}
                type="button"
                // Tapping the last selected month steps back, so a run can be
                // shortened without starting over.
                onClick={() => onCountChange(isLastSelected ? i : i + 1)}
                title={`${mo.label} — ₹${mo.amount.toLocaleString("en-IN")}`}
                style={{
                  flex: "0 0 auto", width: 74, padding: "9px 6px 8px",
                  borderRadius: 10, cursor: "pointer", textAlign: "center",
                  background: selected ? COLORS.primary : "#fff",
                  color: selected ? "#fff" : COLORS.text,
                  border: `1.5px solid ${selected ? COLORS.primary : COLORS.border}`,
                  // Only the ends of the run get full rounding, so the selected
                  // span reads as one continuous bar rather than loose chips.
                  borderTopRightRadius:    selected && !isLastSelected ? 3 : 10,
                  borderBottomRightRadius: selected && !isLastSelected ? 3 : 10,
                  borderTopLeftRadius:     selected && i > 0 ? 3 : 10,
                  borderBottomLeftRadius:  selected && i > 0 ? 3 : 10,
                  transition: "background .12s, border-color .12s",
                }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.02em" }}>
                  {mo.short}
                </div>
                <div style={{ fontSize: 9.5, opacity: selected ? 0.75 : 0.55, marginTop: 1 }}>
                  {mo.year}
                </div>
                <div style={{
                  fontFamily: TYPOGRAPHY.fontMono, fontSize: 11, fontWeight: 700, marginTop: 4,
                  color: selected ? "#fff" : mo.isDue ? COLORS.danger : COLORS.textMuted,
                }}>
                  ₹{mo.amount.toLocaleString("en-IN")}
                </div>
                {/* A due month is money already owed — worth distinguishing
                    from an optional advance month at a glance. */}
                <div style={{
                  height: 3, width: 16, borderRadius: 2, margin: "5px auto 0",
                  background: mo.isDue
                    ? (selected ? "rgba(255,255,255,.85)" : COLORS.danger)
                    : "transparent",
                }} />
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6,
        fontSize: 10.5, color: COLORS.textMuted }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 12, height: 3, borderRadius: 2, background: COLORS.danger }} />
          Outstanding
        </span>
        <span>Tap a month to pay everything up to it</span>
      </div>
    </div>
  );
}
