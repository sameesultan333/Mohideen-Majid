import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, X, RefreshCw, ChevronDown, ChevronRight,
  CalendarPlus, UserPlus, FileSpreadsheet, FileText,
  AlertTriangle, TrendingUp, Eye, Edit3, Receipt,
  WifiOff, Clock, Bell,
} from "lucide-react";
import { cachedFetch, formatCacheAge } from "../../utils/offlineCache";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import AddFamilyModal from "../../components/AddFamilyModal";
import EditAmountModal from "../../components/EditAmountModal";
import {
  getDashboard, getMembers, getDefaulters, generateMonth,
  addFamily, updateFamily, getFamilyHistory,
  downloadMonthlyExcel, downloadMonthlyPDF, downloadFamilyStatementPDF,
  currentMonthKey, triggerDownload, notifyDefaulters,
  type FinanceDashboard, type MemberWithCollection, type DefaulterItem,
} from "../../api/chanda";
import { getAccessToken } from "../../api/auth";
import { makeSearchMatcher } from "../../utils/search";
import MonthRunSelector, { buildMonthRun } from "../../components/MonthRunSelector";
import { getZones } from "../../api/families";
import { useNotifications } from "../../context/NotificationContext";

// ─── helpers ─────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  `₹${(n ?? 0).toLocaleString("en-IN")}`;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
type StatusFilter = "all" | "paid" | "pending";

function useIsMobile() {
  const [mob, setMob] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setMob(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return mob;
}

// ─── Status badge ─────────────────────────────────────────────

const ST: Record<string, { bg: string; color: string; dot: string; label: string }> = {
  paid:    { bg: "#E9F5F0", color: "#0F5C4C", dot: "#0F5C4C", label: "Paid" },
  pending: { bg: "#F8E9E9", color: "#A13A3A", dot: "#A13A3A", label: "Pending" },
};

function Badge({ status }: { status: string }) {
  const s = ST[status] ?? ST.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: s.bg, color: s.color, padding: "5px 11px",
      borderRadius: 999, fontSize: 12, fontWeight: 700,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot }} />
      {s.label}
    </span>
  );
}

// ─── Helpers ─────────────────────────────────────────────────
function fmtYM(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

// ─── Family Detail Modal ──────────────────────────────────────
// Always shows ALL 12 month cells regardless of which month is selected at top.
// Uses /finance/reports/family/{id} to get complete history.
//
// Months after the current month have not been generated yet. An unpaid one
// renders as "Upcoming" and is never styled or counted as pending; one paid in
// advance still renders as Paid. ChandaCollection is the single source of truth
// — pending is never inferred from the calendar.

function FamilyDetail({ memberId, memberName, memberNo, memberPhone, monthlyAmount, onClose, onEdit }: {
  memberId: number; memberName: string; memberNo: string;
  memberPhone: string; monthlyAmount: number;
  onClose(): void; onEdit(): void;
}) {
  const [history, setHistory] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFamilyHistory(memberId)
      .then(d => { setHistory(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [memberId]);

  const year = new Date().getFullYear();

  // Build colMap from history
  const colMap: Record<string, any> = {};
  (history?.collections ?? []).forEach((c: any) => { colMap[c.month] = c; });

  const totalPaid  = history?.summary?.total_paid  ?? 0;
  const outstanding = history?.summary?.total_outstanding ?? 0;
  const pct = history?.summary
    ? history.summary.total_due > 0
      ? Math.round((history.summary.total_paid / history.summary.total_due) * 100)
      : 0
    : 0;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(12,46,39,.55)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        width: "100%", maxWidth: 680,
        background: "#fff", borderRadius: "20px 20px 0 0",
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 -8px 40px rgba(0,0,0,.18)",
      }}>
        {/* drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 40, height: 4, borderRadius: 99, background: "#D8D1BD" }} />
        </div>

        {/* Header */}
        <div style={{
          padding: "14px 20px 12px", borderBottom: "1px solid #F0ECE0",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          position: "sticky", top: 0, background: "#fff", zIndex: 2,
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1C231F" }}>{memberName}</div>
            <div style={{ fontSize: 13, color: "#5B6660", marginTop: 2 }}>
              {memberNo} · {memberPhone} ·{" "}
              <strong style={{ color: COLORS.primary }}>{fmt(monthlyAmount)}/month</strong>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onEdit} style={{
              background: COLORS.primaryLight, color: COLORS.primary,
              border: `1px solid ${COLORS.primaryBorder}`, borderRadius: 10,
              padding: "8px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>Edit</button>
            <button onClick={onClose} style={{
              background: "none", border: "1px solid #E7E2D3", borderRadius: 10,
              width: 38, height: 38, display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer",
            }}>
              <X size={18} color="#93998F" />
            </button>
          </div>
        </div>

        {/* 3 summary tiles */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          gap: 1, background: "#F0ECE0", borderBottom: "1px solid #F0ECE0",
        }}>
          {[
            { label: "Total Paid",   value: fmt(totalPaid),   color: COLORS.primary },
            { label: "Outstanding",  value: fmt(outstanding),  color: outstanding > 0 ? "#A13A3A" : COLORS.primary },
            { label: "Collected",    value: `${pct}%`,         color: COLORS.primary },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "#fff", padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#93998F",
                textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 20, fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Year grid — ALL 12 months always visible */}
        <div style={{ padding: "18px 18px 28px" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "#93998F", padding: 24, fontSize: 14 }}>
              Loading history…
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#5B6660",
                textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                {year} — Complete History
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {MONTH_NAMES.map((name, i) => {
                  const key = `${year}-${String(i + 1).padStart(2, "0")}`;
                  const isFuture = key > currentMonthKey();
                  const row = colMap[key];
                  // A future month counts only when it was actually paid in
                  // advance; an unpaid one is not generated yet, so it is never
                  // pending no matter what the API sends back.
                  const c = isFuture && !((row?.total_paid ?? 0) > 0) ? undefined : row;

                  let bg = "#F7F5EF", borderC = "#E7E2D3", textC = "#93998F";
                  if (c?.status === "paid")    { bg = "#E9F5F0"; borderC = "#BFE0D4"; textC = "#0F5C4C"; }
                  if (c?.status === "pending") { bg = "#F8E9E9"; borderC = "#E8BBBB"; textC = "#A13A3A"; }

                  const balance = c ? Math.max((c.amount_due ?? 0) - (c.total_paid ?? 0), 0) : 0;

                  return (
                    <div key={key} style={{
                      background: bg, border: `1.5px solid ${borderC}`,
                      borderRadius: 12, padding: "12px 12px",
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: textC,
                        textTransform: "uppercase", letterSpacing: "0.05em" }}>{name}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: textC, marginTop: 3 }}>
                        {c
                          ? (c.status === "paid" ? "Paid" : "Pending")
                          : isFuture ? "Upcoming" : "—"}
                      </div>
                      {c && (
                        <div style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 12, marginTop: 2, color: textC }}>
                          {fmt(c.total_paid)}
                          {balance > 0 && (
                            <div style={{ color: "#A13A3A", fontWeight: 700 }}>
                              bal {fmt(balance)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pending months list */}
              {outstanding > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#A13A3A",
                    textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                    Pending Months
                  </div>
                  {history?.collections
                    ?.filter((c: any) => c.status !== "paid" && c.month <= currentMonthKey())
                    .map((c: any) => (
                      // Generated + unsettled only: advance months are never overdue.
                      <div key={c.month} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 14px", background: "#F8E9E9",
                        border: "1px solid #E8BBBB", borderRadius: 10, marginBottom: 6,
                      }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: 14, color: "#1C231F" }}>
                            {MONTH_NAMES[parseInt(c.month.split("-")[1]) - 1]} {c.month.split("-")[0]}
                          </span>
                          <Badge status={c.status} />
                        </div>
                        <span style={{
                          fontFamily: TYPOGRAPHY.fontMono, fontWeight: 800,
                          color: "#A13A3A", fontSize: 15,
                        }}>
                          {fmt(Math.max((c.amount_due ?? 0) - (c.total_paid ?? 0), 0))}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              {/* Payment history */}
              {history?.payments?.length > 0 && (
                <div style={{ marginTop: 22 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#5B6660",
                    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                    Payment History
                  </div>
                  {[...(history.payments)].sort((a: any, b: any) =>
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                  ).map((p: any) => {
                    const isAdvance = (p.covered_months?.length ?? 0) > 1;
                    const covLabel = p.covered_months?.length > 0
                      ? p.covered_months.map(fmtYM).join(", ")
                      : null;
                    const paidAt = p.created_at
                      ? new Date((/[Zz]|[+-]\d{2}:?\d{2}$/.test(p.created_at) ? p.created_at : p.created_at + "Z"))
                          .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                      : "—";
                    return (
                      <div key={p.id} style={{
                        padding: "12px 14px",
                        background: isAdvance ? "#FAF0DD" : "#F7F5EF",
                        border: `1.5px solid ${isAdvance ? "#E8D6A5" : "#E7E2D3"}`,
                        borderRadius: 12, marginBottom: 8,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 15,
                              fontWeight: 800, color: "#1C231F" }}>
                              {fmt(p.amount)}
                            </span>
                            {isAdvance && (
                              <span style={{
                                marginLeft: 8, fontSize: 10, fontWeight: 800,
                                background: "#B07A1E", color: "#fff",
                                borderRadius: 6, padding: "2px 7px",
                                letterSpacing: "0.06em",
                              }}>
                                ADVANCE · {p.covered_months.length} MONTHS
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 12, color: "#93998F" }}>{paidAt}</span>
                        </div>
                        {covLabel && (
                          <div style={{ fontSize: 12, color: isAdvance ? "#B07A1E" : "#5B6660",
                            marginTop: 5, fontWeight: 600 }}>
                            {isAdvance ? "Covers: " : "Month: "}{covLabel}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: "#93998F", marginTop: 3 }}>
                          {p.method ?? "—"} · {p.created_by === "user" ? "Self-paid" : p.created_by === "collector" ? "Collector" : p.created_by}
                          {p.status === "verified" ? " · Verified" : " · Pending"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pending Verification Panel ──────────────────────────────

const BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/api$/, "") || "";

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  // Server stores naive UTC datetimes — append Z so browser parses as UTC and converts to local IST
  const str = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(str);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function PendingVerificationPanel({ onVerified }: { onVerified(): void }) {
  const { pendingPayments: items, loading, actioning, refresh, verifyPay, rejectPay } = useNotifications();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const buildImageUrl = (path: string | null) => {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return `${BASE_URL}/${path.replace(/^\//, "")}`;
  };

  const handle = async (id: number, action: "verify" | "reject") => {
    try {
      if (action === "verify") await verifyPay(id);
      else await rejectPay(id);
      onVerified();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Action failed");
    }
  };

  // Don't render panel at all when no items and not loading
  if (!loading && items.length === 0) return null;

  return (
    <div style={{ background: "#fff", border: "1px solid #EAE6D9", borderRadius: 16, overflow: "hidden" }}>
      <div style={{
        padding: "14px 18px", borderBottom: "1px solid #F0ECE0",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Receipt size={15} color="#B07A1E" />
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1C231F" }}>
            Pending Verification
          </span>
          {items.length > 0 && (
            <span style={{
              background: "#F8E9E9", color: "#A13A3A", borderRadius: 999,
              padding: "2px 8px", fontSize: 11, fontWeight: 800,
            }}>{items.length}</span>
          )}
        </div>
        <button onClick={refresh} disabled={loading} style={{
          background: "none", border: "1px solid #E7E2D3", borderRadius: 7,
          width: 28, height: 28, display: "flex", alignItems: "center",
          justifyContent: "center", cursor: "pointer",
        }}>
          <RefreshCw size={12} color="#93998F" style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "20px 18px", color: "#93998F", fontSize: 13, textAlign: "center" }}>Loading…</div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          {items.map((p, i) => {
            const imgUrl = buildImageUrl(p.proof_image);
            const isLast = i === items.length - 1;
            const busy = actioning === p.id;
            return (
              <div key={p.id} style={{
                padding: "14px 18px",
                borderBottom: isLast ? "none" : "1px solid #F0ECE0",
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* Screenshot thumbnail */}
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt="proof"
                      onClick={() => setLightbox(imgUrl)}
                      onError={(e) => {
                        const t = e.currentTarget;
                        t.style.display = "none";
                        const ph = t.nextElementSibling as HTMLElement | null;
                        if (ph) ph.style.display = "flex";
                      }}
                      style={{
                        width: 56, height: 56, objectFit: "cover",
                        borderRadius: 8, border: "1px solid #E7E2D3",
                        cursor: "zoom-in", flexShrink: 0,
                      }}
                    />
                  ) : null}
                  <div style={{
                    width: 56, height: 56, borderRadius: 8,
                    background: "#F0ECE0", border: "1px solid #E7E2D3",
                    display: imgUrl ? "none" : "flex",
                    alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Receipt size={20} color="#C8C4B4" />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1C231F" }}>
                      {p.payer_name ?? "—"}
                    </div>
                    {p.paid_by_name && p.paid_by_name !== p.payer_name && (
                      <div style={{ fontSize: 11, color: COLORS.lapis, fontWeight: 600, marginTop: 1 }}>
                        Paid by {p.paid_by_name}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "#5B6660", marginTop: 2 }}>
                      <span style={{ fontWeight: 800, color: COLORS.primary }}>
                        ₹{p.amount.toLocaleString("en-IN")}
                      </span>
                      {" · "}
                      {(p.method ?? "UPI").toUpperCase()}
                    </div>
                    {p.covered_months?.length > 0 && (
                      <div style={{ fontSize: 11, color: "#B07A1E", marginTop: 2 }}>
                        {p.covered_months.length > 1 ? `Advance · ${p.covered_months.length} months: ` : "Covers: "}
                        {p.covered_months.map(fmtYM).join(", ")}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "#93998F", marginTop: 2 }}>
                      {fmtDateTime(p.created_at)}
                      {p.receipt_id ? ` · ${p.receipt_id}` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                    <button
                      disabled={busy}
                      onClick={() => handle(p.ref_id, "verify")}
                      style={{
                        background: "#E9F5F0", color: "#0F5C4C",
                        border: "1px solid #BFE0D4", borderRadius: 8,
                        padding: "6px 14px", fontSize: 12, fontWeight: 700,
                        cursor: busy ? "not-allowed" : "pointer",
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      {busy ? "…" : "✓ Verify"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => handle(p.ref_id, "reject")}
                      style={{
                        background: "#F8E9E9", color: "#A13A3A",
                        border: "1px solid #E8BBBB", borderRadius: 8,
                        padding: "6px 14px", fontSize: 12, fontWeight: 700,
                        cursor: busy ? "not-allowed" : "pointer",
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, cursor: "zoom-out",
          }}
        >
          <img
            src={lightbox}
            alt="proof full"
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Defaulters Panel ─────────────────────────────────────────
// Shows head names (not "X families") and which months are overdue.

function DefaultersPanel() {
  const [defData, setDefData] = useState<any>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  // Selection is per family_id, shared across tiers (a family belongs to
  // exactly one tier at a time, so this never collides).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState<number | null>(null); // tier currently sending, or null

  useEffect(() => {
    getDefaulters().then(d => setDefData(d)).catch(() => {});
  }, []);

  const tiers = [
    { months: 1,  label: "1 Month Due",      color: "#B07A1E", bg: "#FAF0DD", border: "#E8D6A5" },
    { months: 3,  label: "2–3 Months Due",   color: "#A13A3A", bg: "#F8E9E9", border: "#E8BBBB" },
    { months: 6,  label: "4–11 Months Due",  color: "#7A2E2E", bg: "#FAEEEE", border: "#E0B0B0" },
    { months: 12, label: "12+ Months Due",   color: "#4A0A0A", bg: "#FAEEEE", border: "#D09090" },
  ];

  const toggleOne = (familyId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId); else next.add(familyId);
      return next;
    });
  };

  const toggleAllInTier = (items: DefaulterItem[]) => {
    const ids = items.map(i => i.family_id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  // Sends to the checked families within this tier, or to every family in
  // the tier if none are checked — keeps the old "one click, whole bucket"
  // behavior while adding individual/multi-select on top of it.
  const sendReminders = async (months: number, items: DefaulterItem[]) => {
    const checkedInTier = items.filter(i => selected.has(i.family_id)).map(i => i.family_id);
    const targetIds = checkedInTier.length > 0 ? checkedInTier : items.map(i => i.family_id);
    if (targetIds.length === 0) return;

    setSending(months);
    try {
      const result = await notifyDefaulters(targetIds);
      setSelected(prev => {
        const next = new Set(prev);
        targetIds.forEach(id => next.delete(id));
        return next;
      });
      alert(
        `Push reminder sent to ${result.notified} of ${result.requested} famil${result.requested === 1 ? "y" : "ies"}.` +
        (result.skipped.length > 0 ? `\n${result.skipped.length} skipped (no registered app user/device).` : "")
      );
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to send reminder.");
    } finally {
      setSending(null);
    }
  };

  return (
    <div style={{
      background: "#fff", border: "1px solid #EAE6D9",
      borderRadius: 16, overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 18px", borderBottom: "1px solid #F0ECE0",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <AlertTriangle size={15} color="#A13A3A" />
        <span style={{ fontWeight: 700, fontSize: 14, color: "#1C231F" }}>Defaulters</span>
      </div>

      {tiers.map(({ months, label, color, bg, border }) => {
        const items: DefaulterItem[] = defData?.grouped?.[String(months)]?.items ?? [];
        const isOpen = expanded === months;
        const checkedCount = items.filter(i => selected.has(i.family_id)).length;
        const isSendingTier = sending === months;

        return (
          <div key={months} style={{ borderBottom: "1px solid #F0ECE0" }}>
            <div
              onClick={() => setExpanded(isOpen ? null : months)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 18px", cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  background: bg, color, border: `1px solid ${border}`,
                  fontWeight: 700, fontSize: 12, padding: "3px 9px", borderRadius: 6,
                }}>{label}</span>
                <span style={{ fontSize: 14, color: "#1C231F", fontWeight: 600 }}>
                  {items.length} {items.length === 1 ? "person" : "people"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {items.length > 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); sendReminders(months, items); }}
                    disabled={isSendingTier}
                    title={checkedCount > 0 ? `Send to ${checkedCount} selected` : `Send to all ${items.length}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      background: COLORS.primaryLight, color: COLORS.primary,
                      border: `1px solid ${COLORS.primaryBorder}`, borderRadius: 6,
                      padding: "4px 10px", fontSize: 12, fontWeight: 700,
                      cursor: isSendingTier ? "default" : "pointer",
                      opacity: isSendingTier ? 0.6 : 1,
                    }}
                  >
                    <Bell size={12} />
                    {isSendingTier ? "Sending…" : checkedCount > 0 ? `Remind (${checkedCount})` : "Remind All"}
                  </button>
                )}
                <ChevronRight size={14} color="#93998F"
                  style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "0.2s" }} />
              </div>
            </div>

            {isOpen && (
              <div style={{ background: "#FAF8F2", borderTop: "1px solid #F0ECE0" }}>
                {items.length === 0 ? (
                  <div style={{ padding: "12px 18px", fontSize: 13, color: "#93998F" }}>No defaulters</div>
                ) : (
                  <>
                    <div
                      onClick={() => toggleAllInTier(items)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 20px", cursor: "pointer", fontSize: 12,
                        color: "#5B6660", fontWeight: 600,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={items.length > 0 && items.every(i => selected.has(i.family_id))}
                        onChange={() => toggleAllInTier(items)}
                        onClick={e => e.stopPropagation()}
                      />
                      Select all in this tier
                    </div>
                    {items.map(item => (
                      <div key={item.family_id} style={{
                        padding: "10px 20px", borderBottom: "1px solid #F0ECE0",
                        display: "flex", alignItems: "flex-start", gap: 10,
                      }}>
                        <input
                          type="checkbox"
                          checked={selected.has(item.family_id)}
                          onChange={() => toggleOne(item.family_id)}
                          style={{ marginTop: 4 }}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flex: 1 }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#1C231F" }}>{item.name}</div>
                            <div style={{ fontSize: 12, color: "#5B6660", marginTop: 1, fontFamily: TYPOGRAPHY.fontMono }}>
                              {item.chanda_no} · {item.phone}
                            </div>
                            {/* Show WHICH months are overdue */}
                            <div style={{ marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {(item.months ?? []).map((m: string) => (
                                <span key={m} style={{
                                  background: bg, color, border: `1px solid ${border}`,
                                  fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
                                }}>
                                  {MONTH_NAMES[parseInt(m.split("-")[1]) - 1]} {m.split("-")[0]}
                                </span>
                              ))}
                            </div>
                          </div>
                          <span style={{
                            fontFamily: TYPOGRAPHY.fontMono, fontWeight: 800,
                            color, fontSize: 14, whiteSpace: "nowrap", marginLeft: 12,
                          }}>
                            {fmt(item.outstanding)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Recent Activity ──────────────────────────────────────────

function RecentActivity({ dashboard }: { dashboard: FinanceDashboard | null }) {
  const items = dashboard?.recent_payments ?? [];
  if (!items.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #EAE6D9", borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #F0ECE0",
        display: "flex", alignItems: "center", gap: 8 }}>
        <TrendingUp size={15} color={COLORS.primary} />
        <span style={{ fontWeight: 700, fontSize: 14, color: "#1C231F" }}>Recent Collections</span>
      </div>
      {items.slice(0, 7).map((p: any, i: number) => (
        <div key={p.id} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "11px 18px",
          borderBottom: i < Math.min(items.length, 7) - 1 ? "1px solid #F0ECE0" : undefined,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1C231F" }}>{p.head_name ?? "—"}</div>
            <div style={{ fontSize: 11, color: "#93998F", marginTop: 1 }}>
              {p.created_by === "user" ? "Paid via app" : (p.collected_by ?? "Collector")} · {fmtDateTime(p.collected_at ?? p.created_at)}
            </div>
          </div>
          <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontWeight: 700, color: COLORS.primary, fontSize: 14 }}>
            {fmt(p.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Cash Flow Panel ──────────────────────────────────────────

function fmtMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function CashFlowPanel({ dashboard, selectedMonth }: { dashboard: FinanceDashboard | null; selectedMonth: string }) {
  const cf = (dashboard as any)?.collection_periods?.this_month;
  if (!cf) return null;

  const methods = [
    { label: "Cash",   value: cf.cash,   color: "#0F5C4C" },
    { label: "UPI",    value: cf.upi,    color: "#1A6EA8" },
    { label: "Bank",   value: cf.bank,   color: "#6B4BB5" },
    { label: "Cheque", value: cf.cheque, color: "#B07A1E" },
    { label: "Other",  value: cf.other,  color: "#5B6660" },
  ].filter(m => m.value > 0);

  return (
    <div style={{
      background: "#fff", border: "1px solid #EAE6D9", borderRadius: 16,
      padding: "18px 20px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1C231F" }}>
          Money Received — {fmtMonthLabel(selectedMonth)}
        </span>
        <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 20, fontWeight: 800, color: COLORS.primary }}>{fmt(cf.total)}</span>
      </div>

      {/* Method breakdown */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {methods.map(m => (
          <div key={m.label} style={{
            background: "#F5FAF8", border: "1px solid #DFF0EA", borderRadius: 10,
            padding: "8px 14px", display: "flex", flexDirection: "column", gap: 2,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#93998F", textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.label}</span>
            <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 15, fontWeight: 800, color: m.color }}>{fmt(m.value)}</span>
          </div>
        ))}
      </div>

      {/* Cash vs Digital split */}
      <div style={{ display: "flex", gap: 12, paddingTop: 10, borderTop: "1px solid #F0ECE0" }}>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "#F0F8F5", borderRadius: 8, padding: "8px 12px" }}>
          <span style={{ fontSize: 12, color: "#5B6660", fontWeight: 600 }}>Cash</span>
          <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontWeight: 800, fontSize: 13, color: COLORS.primary }}>{fmt(cf.cash)}</span>
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "#EFF4FB", borderRadius: 8, padding: "8px 12px" }}>
          <span style={{ fontSize: 12, color: "#5B6660", fontWeight: 600 }}>GPay / Digital</span>
          <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontWeight: 800, fontSize: 13, color: "#1A6EA8" }}>{fmt((cf.upi ?? 0) + (cf.bank ?? 0) + (cf.cheque ?? 0) + (cf.other ?? 0))}</span>
        </div>
      </div>
      {/* Reconciliation note */}
      <div style={{ marginTop: 10, fontSize: 10.5, color: "#93998F", lineHeight: 1.5 }}>
        Cash + UPI + Bank + Cheque = Money Received (actual cash flow this month).
        "Covered" above shows dues settled — may differ due to advance or overdue payments.
      </div>
    </div>
  );
}

// ─── Helpers for month selection ─────────────────────────────

// ─── Manual Payment / Collection Sheet ───────────────────────

function ManualPaymentModal({ entry, onClose, onSaved }: {
  entry: { member: any; pendingMonths?: string[] } | null;
  onClose(): void;
  onSaved(): void;
}) {
  const [method, setMethod]     = useState("cash");
  const [note, setNote]         = useState("");
  const [txRef, setTxRef]       = useState("");
  const [purpose, setPurpose]   = useState("Monthly Chanda");
  const [saving, setSaving]     = useState(false);
  const [result, setResult]     = useState<any>(null);

  // Visit date defaults to current device date/time
  const nowLocal = new Date();
  const localISO = new Date(nowLocal.getTime() - nowLocal.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
  const [visitDate, setVisitDate] = useState(localISO);

  // How many months from the start of the run are selected. A run is always
  // contiguous, so one number describes the whole selection.
  const [monthCount, setMonthCount] = useState(0);
  // Non-chanda purposes have no months to derive a total from, so they need
  // their own amount. Without this the Save button could never be satisfied.
  const [otherAmount, setOtherAmount] = useState("");
  // Funds for attributing a donation. Loaded from /funds/ — the Record Payment
  // sheet previously offered a "Donation" purpose with nowhere to attach it,
  // so admin-recorded donations never reached the Funds dashboard.
  const [funds, setFunds] = useState<Array<{ id: number; name: string }>>([]);
  const [fundId, setFundId] = useState<number | null>(null);
  const [memberHistory, setMemberHistory] = useState<any>(null);
  const [histLoading, setHistLoading] = useState(false);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    import("../../api/fund")
      .then(({ getFunds }) => getFunds({ status: "active" }))
      .then(list => { if (!cancelled) setFunds(list.map(f => ({ id: f.id, name: f.name }))); })
      .catch(() => { if (!cancelled) setFunds([]); });
    return () => { cancelled = true; };
  }, [entry?.member?.id]);

  useEffect(() => {
    if (!entry) return;
    setHistLoading(true);
    getFamilyHistory(entry.member.id)
      .then(h => setMemberHistory(h))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, [entry?.member?.id]);

  if (!entry) return null;
  const m = entry.member;

  const monthlyAmt = m.monthly_amount ?? 0;

  // Unpaid generated months followed by advance months, as one continuous run.
  const monthRun = memberHistory
    ? buildMonthRun(memberHistory.collections ?? [], monthlyAmt, 12)
    : [];

  const selectedMonths = monthRun.slice(0, monthCount).map(r => r.month);
  const isChanda = purpose === "Monthly Chanda";
  const total = isChanda
    ? monthRun.slice(0, monthCount).reduce((sum, r) => sum + r.amount, 0)
    : Number(otherAmount || 0);



  async function handleSave() {
    if (purpose === "Monthly Chanda" && selectedMonths.length === 0) {
      alert("Select at least one month"); return;
    }
    if (purpose !== "Monthly Chanda" && total <= 0) {
      alert("Enter a valid amount"); return;
    }
    setSaving(true);
    try {
      const { adminRecordPayment } = await import("../../api/chanda");
      const payload: any = {
        member_id: m.id,
        method,
        purpose,
        transaction_ref: txRef || undefined,
        note: note || undefined,
        // Send an absolute instant, not a wall clock. <input type="datetime-local">
        // yields "2026-08-08T00:12" with no zone; sent as-is the backend stored it
        // as if it were UTC, then the client rendered it back in local time and
        // added the offset a second time — 12:12 AM arrived on the receipt as
        // 5:41 AM. new Date(...) reads that string in the browser's own zone, so
        // toISOString() gives the true instant and works from any timezone.
        collected_date: visitDate ? new Date(visitDate).toISOString() : undefined,
      };
      let res;
      if (purpose === "Monthly Chanda") {
        payload.months_list = [...selectedMonths].sort();
        payload.amount = total;
        res = await adminRecordPayment(payload);
      } else {
        // Route through /donations/ rather than admin-record: only a Donation
        // row carries fund_id, so this is what makes the money show up on the
        // Funds dashboard. admin-record would file it as a PaymentEntry with no
        // fund link, which is why funds never reflected admin-side donations.
        const { createDonation } = await import("../../api/donation");
        res = await createDonation({
          donor_name: m.name,
          member_id: m.id,
          amount: total,
          method: method as any,
          fund_id: fundId ?? undefined,
          note: note || undefined,
        });
      }
      setResult(res);
      onSaved();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Failed to record payment");
    } finally { setSaving(false); }
  }


  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(12,46,39,.5)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000,
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: "20px 20px 0 0",
        width: "100%", maxWidth: 520,
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 -8px 40px rgba(0,0,0,.2)",
      }} onClick={e => e.stopPropagation()}>

        {/* drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 40, height: 4, borderRadius: 99, background: "#D8D1BD" }} />
        </div>

        <div style={{ padding: "16px 24px 28px" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1C231F", marginBottom: 2 }}>
            Collect Payment
          </div>
          <div style={{ fontSize: 13, color: "#5B6660", marginBottom: 20 }}>
            {m.name} · {m.chanda_no} · <strong style={{ color: COLORS.primary }}>₹{monthlyAmt}/month</strong>
          </div>

          {result ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 32 }}>✓</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0F5C4C", marginTop: 8 }}>Payment Recorded</div>
              <div style={{ fontFamily: "monospace", fontSize: 13, color: "#5B6660", marginTop: 4 }}>{result.receipt_id}</div>
              <div style={{ fontSize: 13, color: "#5B6660", marginTop: 2 }}>
                ₹{result.amount?.toLocaleString("en-IN")} · {result.method?.toUpperCase()}
                {result.covered_months?.length > 0 && ` · ${result.covered_months.map(fmtYM).join(", ")}`}
              </div>
              <button onClick={onClose} style={{
                marginTop: 18, padding: "12px 32px", background: "#0F5C4C", color: "#fff",
                border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}>Done</button>
            </div>
          ) : (
            <>
              {/* Purpose */}
              <div style={{ marginBottom: 16 }}>
                <label style={LB}>Purpose</label>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {["Monthly Chanda", "Donation", "Other"].map(p => (
                    <button key={p} onClick={() => setPurpose(p)} style={{
                      padding: "6px 16px", borderRadius: 99, border: "1.5px solid",
                      borderColor: purpose === p ? "#0F5C4C" : "#E0DDD5",
                      background: purpose === p ? "#E9F5F0" : "#fff",
                      color: purpose === p ? "#0F5C4C" : "#5B6660",
                      fontWeight: 700, fontSize: 12, cursor: "pointer",
                    }}>{p}</button>
                  ))}
                </div>
              </div>

              {/* Month selection — only for chanda.
                  One contiguous run instead of two checkbox lists: tap a month
                  to pay everything up to it. See MonthRunSelector. */}
              {isChanda && (
                <div style={{ marginBottom: 16 }}>
                  <label style={LB}>Months</label>
                  <div style={{ marginTop: 8 }}>
                    {histLoading ? (
                      <div style={{ fontSize: 12, color: "#93998F", padding: "8px 0" }}>Loading months…</div>
                    ) : (
                      <MonthRunSelector
                        months={monthRun}
                        count={monthCount}
                        onCountChange={setMonthCount}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Amount + fund — non-chanda purposes.
                  A donation has no months to price it, so it needs an explicit
                  amount, and a fund to attribute it to. Neither existed before,
                  which is why recording anything but Chanda always failed. */}
              {!isChanda && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={LB}>Amount (₹)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={otherAmount}
                      placeholder="0"
                      onChange={e => setOtherAmount(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, ""))}
                      style={{
                        width: "100%", height: 42, marginTop: 6, padding: "0 12px",
                        border: "1.5px solid #E0DDD5", borderRadius: 10, fontSize: 15,
                        fontFamily: "monospace", fontWeight: 700, boxSizing: "border-box",
                      }}
                    />
                  </div>

                  {funds.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <label style={LB}>Fund (optional)</label>
                      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        <button onClick={() => setFundId(null)} style={{
                          padding: "6px 14px", borderRadius: 99, border: "1.5px solid",
                          borderColor: fundId === null ? "#0F5C4C" : "#E0DDD5",
                          background: fundId === null ? "#E9F5F0" : "#fff",
                          color: fundId === null ? "#0F5C4C" : "#5B6660",
                          fontWeight: 700, fontSize: 12, cursor: "pointer",
                        }}>General</button>
                        {funds.map(f => (
                          <button key={f.id} onClick={() => setFundId(f.id)} style={{
                            padding: "6px 14px", borderRadius: 99, border: "1.5px solid",
                            borderColor: fundId === f.id ? "#0F5C4C" : "#E0DDD5",
                            background: fundId === f.id ? "#E9F5F0" : "#fff",
                            color: fundId === f.id ? "#0F5C4C" : "#5B6660",
                            fontWeight: 700, fontSize: 12, cursor: "pointer",
                          }}>{f.name}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Payment Method */}
              <div style={{ marginBottom: 14 }}>
                <label style={LB}>Payment Method</label>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {["cash", "upi", "bank", "cheque"].map(me => (
                    <button key={me} onClick={() => setMethod(me)} style={{
                      padding: "6px 16px", borderRadius: 99, border: "1.5px solid",
                      borderColor: method === me ? "#0F5C4C" : "#E0DDD5",
                      background: method === me ? "#E9F5F0" : "#fff",
                      color: method === me ? "#0F5C4C" : "#5B6660",
                      fontWeight: 700, fontSize: 12, cursor: "pointer", textTransform: "uppercase",
                    }}>{me === "upi" ? "GPay/UPI" : me}</button>
                  ))}
                </div>
              </div>

              {(method === "upi" || method === "bank") && (
                <div style={{ marginBottom: 14 }}>
                  <label style={LB}>Transaction Reference</label>
                  <input value={txRef} onChange={e => setTxRef(e.target.value)}
                    placeholder="UTR / Txn ID" style={INP} />
                </div>
              )}

              {/* Visit date */}
              <div style={{ marginBottom: 14 }}>
                <label style={LB}>Visit / Collection Date</label>
                <input
                  type="datetime-local"
                  value={visitDate}
                  onChange={e => setVisitDate(e.target.value)}
                  style={INP}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={LB}>Note (optional)</label>
                <input value={note} onChange={e => setNote(e.target.value)}
                  placeholder="e.g. Cash handed to admin on 8 July" style={INP} />
              </div>

              {/* Live total */}
              {(isChanda ? selectedMonths.length > 0 : true) && (
                <div style={{
                  padding: "14px 18px", background: "#E9F5F0", borderRadius: 12,
                  marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#5B6660", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {isChanda ? `${selectedMonths.length} month${selectedMonths.length > 1 ? "s" : ""} selected` : purpose}
                    </div>
                    {isChanda && selectedMonths.length > 0 && (
                      <div style={{ fontSize: 11, color: "#5B6660", marginTop: 2 }}>
                        {[...selectedMonths].sort().map(fmtYM).join(", ")}
                      </div>
                    )}
                  </div>
                  <span style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 800, color: COLORS.primary }}>
                    ₹{total.toLocaleString("en-IN")}
                  </span>
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={onClose} style={{
                  flex: 1, padding: "12px 0", background: "#F5F2EA", color: "#5B6660",
                  border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>Cancel</button>
                <button onClick={handleSave} disabled={saving || (isChanda && selectedMonths.length === 0)} style={{
                  flex: 2, padding: "12px 0", background: COLORS.primary, color: "#fff",
                  border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14,
                  cursor: saving || (isChanda && selectedMonths.length === 0) ? "not-allowed" : "pointer",
                  opacity: saving || (isChanda && selectedMonths.length === 0) ? 0.6 : 1,
                }}>{saving ? "Recording…" : "Collect & Generate Receipt"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const LB: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#5B6660", textTransform: "uppercase", letterSpacing: "0.06em" };
const INP: React.CSSProperties = { display: "block", width: "100%", marginTop: 4, padding: "9px 12px", border: "1.5px solid #E0DDD5", borderRadius: 10, fontSize: 14, color: "#1C231F", outline: "none", boxSizing: "border-box" };

// ─── Stat Tile ────────────────────────────────────────────────

function StatTile({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #EAE6D9",
      borderRadius: 14, padding: "18px 20px",
      borderTop: `3px solid ${accent}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#93998F",
        textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 26, fontWeight: 800,
        color: accent === COLORS.danger ? "#A13A3A" : accent, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#93998F", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────

export default function ChandaDashboard() {
  const isMobile = useIsMobile();

  const [month, setMonth]         = useState(currentMonthKey());
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [members, setMembers]     = useState<MemberWithCollection[]>([]);
  const [defaulterMap, setDefaulterMap] = useState<Record<number, { months: number; outstanding: number }>>({});
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState("");

  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [zoneFilter, setZoneFilter]     = useState<string>("all");
  const [zones, setZones]               = useState<string[]>([]);

  const [addOpen, setAddOpen]     = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  const [detailId, setDetailId]   = useState<number | null>(null);
  const [editFamily, setEditFamily] = useState<any>(null);
  const [editOpen, setEditOpen]   = useState(false);
  const [manualEntry, setManualEntry] = useState<{ member: any; pendingMonths?: string[] } | null>(null);

  const [isOffline, setIsOffline]   = useState(false);
  const [cacheTime, setCacheTime]   = useState<number | null>(null);

  // ── data load ────────────────────────────────────────────

  async function loadData(silent = false) {
    try {
      if (!silent) setLoading(true); else setRefreshing(true);
      setError("");
      const [dashResult, memberResult, defResult] = await Promise.all([
        cachedFetch(`chanda_dashboard_${month}`, () => getDashboard(month)),
        cachedFetch(`chanda_members_${month}`,   () => getMembers(month)),
        cachedFetch(`chanda_defaulters`,          () => getDefaulters(1)),
      ]);
      const offline = dashResult.fromCache || memberResult.fromCache || defResult.fromCache;
      setIsOffline(offline);
      setCacheTime(offline ? (dashResult.cacheTime ?? memberResult.cacheTime ?? defResult.cacheTime) : null);
      setDashboard(dashResult.data);
      setMembers(memberResult.data);
      const map: Record<number, { months: number; outstanding: number }> = {};
      // Collect ALL defaulters across all buckets for the per-row indicator
      const defData = defResult.data;
      (["1","3","6","12"] as const).forEach(bucket => {
        (defData.grouped?.[bucket]?.items ?? []).forEach((d: DefaulterItem) => {
          if (!map[d.family_id]) {
            map[d.family_id] = { months: d.pending_months, outstanding: (d as any).outstanding ?? 0 };
          }
        });
      });
      setDefaulterMap(map);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to load data. Check your connection.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }

  useEffect(() => { loadData(); }, [month]);

  useEffect(() => {
    let cancelled = false;
    getZones().then((z) => { if (!cancelled) setZones(z); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Clear the sidebar badge the moment this page mounts —
  // the admin is actively looking at Chanda, so nothing is "unread".
  const { markAllRead } = useNotifications();
  useEffect(() => { markAllRead(); }, [markAllRead]);

  // ── WebSocket: live admin dashboard updates ───────────────
  const loadDataRef = useRef(loadData);
  useEffect(() => { loadDataRef.current = loadData; });

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const apiBase = (import.meta as any).env?.VITE_BACKEND_URL || "";
    const host = apiBase ? new URL(apiBase).host : window.location.host;
    const token = getAccessToken() || "";
    const wsUrl = `${proto}://${host}/ws/finance${token ? `?token=${token}` : ""}`;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "dashboard_updated" || msg.type === "monthly_amount_updated" ||
                msg.type === "payment_verified"   || msg.type === "payment_collected" ||
                msg.type === "family_updated"     || msg.type === "family_created") {
              loadDataRef.current(true);
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => { retryTimer = setTimeout(connect, 20_000); };
      } catch {}
    };
    connect();
    return () => {
      ws?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [month]);

  // ── filter ───────────────────────────────────────────────

  // Any filter active? Drives the "Clear filters" pill — previously the only way
  // back to an unfiltered list was re-clicking the exact active chip or hunting
  // for the All option in the dropdown, so people reloaded the page instead.
  const hasFilters = statusFilter !== "all" || zoneFilter !== "all" || search.trim() !== "";
  const clearFilters = () => { setStatusFilter("all"); setZoneFilter("all"); setSearch(""); };

  const filteredRows = useMemo(() => {
    // Case/space/punctuation-insensitive — "sa mohideen" finds "S.A. Mohideen".
    const matches = makeSearchMatcher(search);
    return members.filter(item => {
      const m = item.member;
      if (m.is_active === false) return false;
      const status = item.collections[0]?.status ?? "pending";
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (zoneFilter !== "all" && m.zone !== zoneFilter) return false;
      if (!matches(m.name, m.chanda_no, m.phone, m.address, m.zone)) return false;
      return true;
    });
  }, [members, search, statusFilter, zoneFilter]);

  const d = dashboard;
  const chanda = d?.chanda;
  const generatedCount = members.filter(member =>
    member.collections.some(collection => collection.month === month)
  ).length;
  const monthGenerated = members.length > 0 && generatedCount === members.length;
  const pct = Math.min(Math.max(chanda?.collection_pct ?? 0, 0), 100);

  // ── actions ──────────────────────────────────────────────

  async function handleGenerateMonth() {
    if (!window.confirm(`Generate records for ${month}?`)) return;
    try {
      setGenLoading(true);
      await generateMonth(month);
      await loadData(true);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Failed");
    } finally { setGenLoading(false); }
  }

  async function handleAddFamily(formData: any) {
    try {
      setAddLoading(true);
      await addFamily({
        chanda_no: formData.chandaNo?.trim() || undefined, name: formData.name,
        phone: formData.phone, address: formData.address,
        zone: formData.zone || undefined,
        street: formData.street || undefined,
        monthly_amount: formData.monthlyAmount,
        registration_date: formData.startMonth ? formData.startMonth + "-01" : undefined,
      });
      setAddOpen(false); await loadData(true);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Failed");
    } finally { setAddLoading(false); }
  }

  async function handleEditAmount(fields: { name: string; phone: string; amount: number }) {
    if (!editFamily) return;
    try {
      await updateFamily(editFamily.id, {
        name: fields.name,
        phone: fields.phone,
        monthly_amount: fields.amount,
      });
      setEditOpen(false); setEditFamily(null); await loadData(true);
    } catch (e: any) { alert(e?.response?.data?.detail || "Failed"); }
  }

  const detailMember = detailId !== null
    ? members.find(m => m.member.id === detailId)?.member ?? null
    : null;

  if (loading) return (
    <div style={{ padding: 60, textAlign: "center", color: "#93998F", fontSize: 15 }}>
      Loading…
    </div>
  );

  // ── layout constants ─────────────────────────────────────
  const px = isMobile ? 14 : 0;

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto", paddingBottom: 48 }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
        padding: isMobile ? "16px 14px 10px" : "0 0 24px",
      }}>
        <div>
          <h1 style={{
            margin: 0, fontFamily: TYPOGRAPHY.fontDisplay,
            fontSize: isMobile ? 24 : 32, fontWeight: 400, color: "#1C231F",
          }}>Chanda Management</h1>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "#5B6660" }}>{month}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{
              height: 38, padding: "0 10px", border: "1.5px solid #E7E2D3",
              borderRadius: 9, fontSize: 13, color: "#1C231F", background: "#fff",
              outline: "none", fontFamily: TYPOGRAPHY.fontMono,
            }} />
          <button onClick={() => loadData(true)} disabled={refreshing} style={{
            height: 38, width: 38, display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid #E7E2D3", borderRadius: 9, background: "#fff", cursor: "pointer",
          }}>
            <RefreshCw size={15} color="#93998F"
              style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
          </button>
          <div style={{
            background: COLORS.primaryLight, color: COLORS.primary,
            padding: "8px 14px", borderRadius: 9, fontWeight: 700, fontSize: 13,
            border: `1px solid ${COLORS.primaryBorder}`,
          }}>{members.length} Families</div>
        </div>
      </div>

      {/* ── Offline indicator ── */}
      {isOffline && (
        <div style={{
          margin: `0 ${px}px 12px`, padding: "10px 16px",
          background: "#FEF3D7", border: "1px solid #E8C84A55",
          borderRadius: 10, display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <WifiOff size={14} color="#B07A1E" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#B07A1E" }}>Offline Data</span>
            {cacheTime && (
              <span style={{ fontSize: 11, color: "#93998F", display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={10} /> Last synced {formatCacheAge(cacheTime)}
              </span>
            )}
          </div>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            style={{
              background: "#fff", border: "1px solid #E8C84A88", borderRadius: 7,
              padding: "4px 10px", fontSize: 11, fontWeight: 700, color: "#B07A1E",
              cursor: "pointer",
            }}
          >
            {refreshing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      )}

      {error && (
        <div style={{ margin: `0 ${px}px 14px`, padding: "11px 14px",
          background: "#F8E9E9", color: "#A13A3A", borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Stats ── */}
      {d && (
        <div style={{ padding: `0 ${px}px`, marginBottom: 14 }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(7, 1fr)",
            gap: 12,
          }}>
            <StatTile label="Families"   value={String(d.families?.total ?? 0)}
              sub={`${chanda?.paid ?? 0} paid · ${chanda?.pending ?? 0} pending`}
              accent={COLORS.primary} />
            <StatTile label="Expected"   value={fmt(chanda?.due)}
              accent={COLORS.accent} />
            <StatTile label="Covered"  value={fmt(chanda?.collected)}
              sub="dues settled" accent={COLORS.primary} />
            <StatTile label="Outstanding" value={fmt(chanda?.outstanding)}
              sub={(chanda?.outstanding ?? 0) > 0 ? "needs attention" : "all clear"}
              accent={(chanda?.outstanding ?? 0) > 0 ? COLORS.danger : COLORS.primary} />
            <StatTile label="Pending"    value={String(chanda?.pending ?? 0)}
              sub="families" accent={COLORS.warning} />
            <StatTile
              label="Awaiting Verify"
              value={String(d.pending_verification ?? 0)}
              sub={(d.pending_verification ?? 0) > 0 ? "user payments" : "all clear"}
              accent={(d.pending_verification ?? 0) > 0 ? COLORS.danger : COLORS.primary}
            />
          </div>
        </div>
      )}

      {/* ── Progress bar ── */}
      {d && (
        <div style={{ padding: `0 ${px}px`, marginBottom: 14 }}>
          <div style={{
            background: "#fff", border: "1px solid #EAE6D9",
            borderRadius: 14, padding: "16px 20px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1C231F" }}>Collection Progress</span>
              <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 20, fontWeight: 800,
                color: COLORS.primary }}>{pct.toFixed(1)}%</span>
            </div>
            <div style={{ height: 12, background: "#E9F5F0", borderRadius: 999, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${pct}%`, borderRadius: 999,
                background: `linear-gradient(90deg, ${COLORS.primary}, #1A8C6A)`,
                transition: "width 0.6s",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8,
              fontSize: 13, color: "#5B6660" }}>
              <span>{fmt(chanda?.collected)} collected</span>
              <span>of {fmt(chanda?.due)} expected</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Cash Flow This Month ── */}
      {d && (
        <div style={{ padding: `0 ${px}px`, marginBottom: 14 }}>
          <CashFlowPanel dashboard={d} selectedMonth={month} />
        </div>
      )}

      {/* ── Pending Expenses Warning ── */}
      {d && (d.expenses?.pending_count ?? 0) > 0 && (
        <div style={{ padding: `0 ${px}px`, marginBottom: 14 }}>
          <div style={{
            background: "#FEF6E6", border: "1px solid #F0D488", borderRadius: 12,
            padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
          }}>
            <AlertTriangle size={16} color="#B07A1E" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#8A5E10" }}>
                {d.expenses.pending_count} expense{d.expenses.pending_count !== 1 ? "s" : ""} awaiting approval
              </div>
              <div style={{ fontSize: 11, color: "#A97010", marginTop: 2 }}>
                {fmt(d.expenses.pending_total)} pending — these do NOT affect the current balance until approved
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending Verification Banner ── */}
      <div style={{ padding: `0 ${px}px`, marginBottom: 14 }}>
        <PendingVerificationPanel onVerified={() => loadData(true)} />
      </div>

      {/* ── Middle row: Actions | Defaulters | Recent ── */}
      <div style={{
        padding: `0 ${px}px`, marginBottom: 20,
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "200px 1fr 1fr",
        gap: 14, alignItems: "start",
      }}>

        {/* Quick Actions */}
        <div style={{
          background: "#fff", border: "1px solid #EAE6D9",
          borderRadius: 16, overflow: "hidden",
        }}>
          {[
            {
              label: genLoading ? "Generating…"
                : monthGenerated ? `✓ ${month} Generated`
                : `Generate ${month}`,
              icon: CalendarPlus, color: COLORS.primary, bg: COLORS.primaryLight,
              onClick: monthGenerated ? undefined : handleGenerateMonth,
              disabled: genLoading || monthGenerated,
            },
            { label: "Add Family",   icon: UserPlus,       color: COLORS.lapis,   bg: COLORS.lapisLight,  onClick: () => setAddOpen(true) },
            {
              label: "Export Excel", icon: FileSpreadsheet, color: COLORS.success, bg: COLORS.successLight,
              onClick: async () => { try { triggerDownload(await downloadMonthlyExcel(month), `chanda_${month}.xlsx`); } catch { alert("Failed"); } },
            },
            {
              label: "Export PDF",   icon: FileText,        color: "#A13A3A",      bg: "#F8E9E9",
              onClick: async () => { try { triggerDownload(await downloadMonthlyPDF(month), `chanda_${month}.pdf`); } catch { alert("Failed"); } },
            },
          ].map(({ label, icon: Icon, color, bg, onClick, disabled }) => (
            <button key={label} onClick={onClick} disabled={disabled} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12,
              padding: "13px 16px", background: "none",
              border: "none", borderBottom: "1px solid #F0ECE0",
              cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
              textAlign: "left",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9, background: bg, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon size={17} color={color} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1C231F" }}>{label}</span>
            </button>
          ))}
          <div style={{ padding: "12px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#93998F",
              textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Status</div>
            <Badge status={monthGenerated ? "paid" : "pending"} />
            <div style={{ fontSize: 11, color: "#93998F", marginTop: 4 }}>
              {monthGenerated ? `${generatedCount}/${members.length} generated` : "Not generated"}
            </div>
          </div>
        </div>

        {/* Defaulters */}
        <DefaultersPanel />

        {/* Recent Activity */}
        <RecentActivity dashboard={dashboard} />
      </div>

      {/* ── Family Table / Cards ── */}
      <div style={{ padding: `0 ${px}px` }}>

        {/* Toolbar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 10, marginBottom: 12,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1C231F" }}>
              Families — {month}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#5B6660" }}>
              {filteredRows.length} of {members.length} shown
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} color="#93998F" style={{
                position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              }} />
              <input placeholder="Search name, chanda no, phone, address…" value={search} onChange={e => setSearch(e.target.value)}
                style={{
                  height: 38, paddingLeft: 30, paddingRight: search ? 30 : 10,
                  border: "1.5px solid #E7E2D3", borderRadius: 9,
                  fontSize: 13, color: "#1C231F", background: "#fff", outline: "none",
                  width: isMobile ? 160 : 280,
                }} />
              {search && (
                <button onClick={() => setSearch("")} style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                }}><X size={12} color="#93998F" /></button>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}
                style={{
                  height: 38, padding: "0 28px 0 10px", border: "1.5px solid #E7E2D3",
                  borderRadius: 9, fontSize: 13, color: "#1C231F",
                  background: "#fff", outline: "none", appearance: "none", cursor: "pointer",
                }}>
                <option value="all">All Zones</option>
                {zones.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
              <ChevronDown size={12} color="#93998F" style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none",
              }} />
            </div>
            <div style={{ position: "relative" }}>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                style={{
                  height: 38, padding: "0 28px 0 10px", border: "1.5px solid #E7E2D3",
                  borderRadius: 9, fontSize: 13, color: "#1C231F",
                  background: "#fff", outline: "none", appearance: "none", cursor: "pointer",
                }}>
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </select>
              <ChevronDown size={12} color="#93998F" style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none",
              }} />
            </div>
          </div>
        </div>

        {/* Status pills */}
        {d && (
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              { k: "paid",    label: "Paid",    count: chanda?.paid },
              { k: "pending", label: "Pending", count: chanda?.pending },
            ].map(({ k, label, count }) => {
              const s = ST[k];
              return (
                <button key={k}
                  onClick={() => setStatusFilter(statusFilter === k ? "all" : k as StatusFilter)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 12px", borderRadius: 999,
                    border: `1.5px solid ${statusFilter === k ? s.dot : s.dot + "40"}`,
                    background: statusFilter === k ? s.bg : "transparent",
                    color: s.color, fontWeight: 700, fontSize: 13, cursor: "pointer",
                  }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot }} />
                  {label} · {count ?? 0}
                </button>
              );
            })}
            {hasFilters && (
              <button
                onClick={clearFilters}
                title="Clear all filters"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 999,
                  border: "1.5px dashed #C8C0A8", background: "transparent",
                  color: "#5B6660", fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}>
                <X size={12} /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* Empty */}
        {filteredRows.length === 0 ? (
          <div style={{
            padding: "48px 20px", textAlign: "center", background: "#fff",
            border: "1px solid #EAE6D9", borderRadius: 16, color: "#93998F", fontSize: 15,
          }}>
            {members.length === 0
              ? `No records for ${month}. Click "Generate ${month}" above.`
              : "No families match your filter."}
          </div>
        ) : isMobile ? (
          /* ── Mobile: Cards ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredRows.map(item => {
              const m = item.member;
              const col = item.collections[0];
              const status = col?.status ?? "pending";
              const defInfo = defaulterMap[m.id];
              const overdue = defInfo?.months ?? 0;
              const totalOutstanding = defInfo?.outstanding ?? (col ? Math.max((col.amount_due ?? 0) - (col.total_paid ?? 0), 0) : 0);
              const s = ST[status] ?? ST.pending;

              return (
                <div key={m.id} style={{
                  background: "#fff", border: "1px solid #EAE6D9",
                  borderRadius: 14, padding: "14px 16px",
                  borderLeft: `4px solid ${s.dot}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: "#1C231F" }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: "#5B6660", marginTop: 2, fontFamily: TYPOGRAPHY.fontMono }}>
                        {m.chanda_no} · {m.phone}
                      </div>
                    </div>
                    <Badge status={status} />
                  </div>

                  <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#93998F", fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: "0.06em" }}>Monthly</div>
                      <div style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 16, fontWeight: 800, color: "#1C231F" }}>
                        {fmt(m.monthly_amount)}
                      </div>
                    </div>
                    {totalOutstanding > 0 && (
                      <div>
                        <div style={{ fontSize: 10, color: "#93998F", fontWeight: 700,
                          textTransform: "uppercase", letterSpacing: "0.06em" }}>Total Outstanding</div>
                        <div style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 16, fontWeight: 800, color: "#A13A3A" }}>
                          {fmt(totalOutstanding)}
                        </div>
                      </div>
                    )}
                    {overdue > 1 && (
                      <div style={{ alignSelf: "flex-end", background: "#F8E9E9", color: "#A13A3A",
                        padding: "3px 9px", borderRadius: 7, fontSize: 12, fontWeight: 700 }}>
                        {overdue} months overdue
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 7, marginTop: 12,
                    borderTop: "1px solid #F0ECE0", paddingTop: 10 }}>
                    <MobAction label="View" color={COLORS.lapis}
                      onClick={() => setDetailId(m.id)} />
                    <MobAction label="Edit" color={COLORS.primary}
                      onClick={() => { setEditFamily(m); setEditOpen(true); }} />
                    <MobAction label="Record" color="#0F5C4C"
                      onClick={() => setManualEntry({ member: m })} />
                    <MobAction label="Statement" color={COLORS.accent}
                      onClick={async () => {
                        try { triggerDownload(await downloadFamilyStatementPDF(m.id), `statement_${m.chanda_no}.pdf`); }
                        catch { alert("Download failed"); }
                      }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Desktop: Table ── */
          <div style={{
            background: "#fff", border: "1px solid #EAE6D9",
            borderRadius: 16, overflow: "hidden",
          }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ background: "#FAF8F2" }}>
                  <tr>
                    {["Chanda No","Head Name","Phone","Monthly","Status","Outstanding","Actions"].map(h => (
                      <th key={h} style={{
                        padding: "12px 16px", textAlign: "left",
                        fontSize: 11, fontWeight: 700, color: "#5B6660",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        borderBottom: "1px solid #EFEBDE", whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(item => {
                    const m = item.member;
                    const col = item.collections[0];
                    const status = col?.status ?? "pending";
                    const defInfo = defaulterMap[m.id];
                    const overdue = defInfo?.months ?? 0;
                    const totalOutstanding = defInfo?.outstanding ?? (col ? Math.max((col.amount_due ?? 0) - (col.total_paid ?? 0), 0) : 0);

                    return (
                      <tr key={m.id}
                        style={{ borderBottom: "1px solid #EFEBDE" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#FAF8F2"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={TC}>
                          <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 12, color: "#5B6660", fontWeight: 600 }}>
                            {m.chanda_no}
                          </span>
                        </td>
                        <td style={TC}>
                          <div style={{ fontWeight: 700, color: "#1C231F", fontSize: 14 }}>{m.name}</div>
                          {overdue > 1 && (
                            <div style={{ fontSize: 11, color: "#A13A3A", marginTop: 2 }}>
                              {overdue} months overdue
                            </div>
                          )}
                        </td>
                        <td style={{ ...TC, fontFamily: TYPOGRAPHY.fontMono, fontSize: 12 }}>{m.phone}</td>
                        <td style={{ ...TC, fontFamily: TYPOGRAPHY.fontMono, fontWeight: 700 }}>{fmt(m.monthly_amount)}</td>
                        <td style={TC}><Badge status={status} /></td>
                        <td style={TC}>
                          {totalOutstanding > 0 ? (
                            <div>
                              <span style={{ fontFamily: TYPOGRAPHY.fontMono, fontWeight: 800, color: "#A13A3A", fontSize: 14 }}>{fmt(totalOutstanding)}</span>
                              {overdue > 0 && <div style={{ fontSize: 10, color: "#93998F", marginTop: 1 }}>{overdue} month{overdue > 1 ? "s" : ""}</div>}
                            </div>
                          ) : <span style={{ color: "#0F5C4C", fontWeight: 600 }}>—</span>}
                        </td>
                        <td style={TC}>
                          <div style={{ display: "flex", gap: 5 }}>
                            <DeskAction icon={Eye}            color={COLORS.lapis}   title="View History"
                              onClick={() => setDetailId(m.id)} />
                            <DeskAction icon={Edit3}          color={COLORS.primary} title="Edit Amount"
                              onClick={() => { setEditFamily(m); setEditOpen(true); }} />
                            <DeskAction icon={CalendarPlus}   color="#0F5C4C"        title="Record Payment"
                              onClick={() => setManualEntry({ member: m })} />
                            <DeskAction icon={Receipt}        color={COLORS.accent}  title="Statement"
                              onClick={async () => {
                                try { triggerDownload(await downloadFamilyStatementPDF(m.id), `statement_${m.chanda_no}.pdf`); }
                                catch { alert("Download failed"); }
                              }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      <ManualPaymentModal
        entry={manualEntry}
        onClose={() => setManualEntry(null)}
        onSaved={() => { loadData(true); }}
      />

      <AddFamilyModal open={addOpen} loading={addLoading}
        existingChandaNos={members.map(m => m.member.chanda_no)}
        onClose={() => setAddOpen(false)} onSave={handleAddFamily} />

      {editFamily && (
        <EditAmountModal open={editOpen}
          familyName={editFamily.name} chandaNo={editFamily.chanda_no}
          currentAmount={editFamily.monthly_amount} currentPhone={editFamily.phone}
          onClose={() => { setEditOpen(false); setEditFamily(null); }}
          onSave={handleEditAmount} />
      )}

      {detailId !== null && detailMember && (
        <FamilyDetail
          memberId={detailMember.id}
          memberName={detailMember.name}
          memberNo={detailMember.chanda_no}
          memberPhone={detailMember.phone}
          monthlyAmount={detailMember.monthly_amount}
          onClose={() => setDetailId(null)}
          onEdit={() => { setEditFamily(detailMember); setEditOpen(true); setDetailId(null); }}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────

function DeskAction({ icon: Icon, color, title, onClick }: {
  icon: any; color: string; title: string; onClick(): void;
}) {
  return (
    <button title={title} onClick={onClick} style={{
      width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
      background: "transparent", border: "1px solid #E7E2D3",
      borderRadius: 7, cursor: "pointer",
    }}
      onMouseEnter={e => { e.currentTarget.style.background = color + "18"; e.currentTarget.style.borderColor = color + "60"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "#E7E2D3"; }}>
      <Icon size={13} color={color} />
    </button>
  );
}

function MobAction({ label, color, onClick }: { label: string; color: string; onClick(): void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 4, padding: "6px 11px",
      border: `1px solid ${color}30`, borderRadius: 8, background: `${color}10`,
      color, fontSize: 13, fontWeight: 700, cursor: "pointer",
    }}>{label}</button>
  );
}

const TC: React.CSSProperties = { padding: "13px 16px", fontSize: 13, color: "#1C231F" };