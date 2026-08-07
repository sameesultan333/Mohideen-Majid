/**
 * Finance Timeline — unified chanda + donation + expense feed.
 * Replaces the old "Collection History" (chanda-only) page.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Banknote, Image as ImageIcon, X, Search,
  ChevronLeft, ChevronRight, RefreshCw, Calendar, SlidersHorizontal,
  TrendingDown, Gift, WifiOff, Copy, CheckCheck, Wallet, RotateCcw,
} from "lucide-react";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import api from "../../api/axios";
import { requestPaymentRollback } from "../../api/chanda";

const SURFACE_HOVER = "#F7F9F8";

const fmt = (n: number | null | undefined) =>
  `₹${Math.abs(n ?? 0).toLocaleString("en-IN")}`;

function fmtDT(iso: string | null | undefined) {
  if (!iso) return "—";
  const s = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function fmtDateOnly(iso: string | null | undefined) {
  if (!iso) return "—";
  const s = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) setMatches(media.matches);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [matches, query]);
  return matches;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelineEntry {
  entry_type: "chanda" | "donation" | "expense" | "cash_submission";
  id: number;
  receipt_id: string | null;
  amount: number;
  method: string | null;
  created_at: string | null;
  created_by: string | null;
  head_name: string;
  head_id: number | null;
  chanda_no: string | null;
  collected_by: string | null;
  collected_at: string | null;
  proof_image: string | null;
  transaction_ref: string | null;
  notes: string | null;
  covered_months: string[];
  status: string;
  rollback_status?: string;
  payment_source?: string;
  description: string;
  purpose?: string;
  category?: string;
  fund_id?: number | null;
  submitted_amount?: number;
  start_date?: string | null;
  end_date?: string | null;
}

// ── Payment classification ─────────────────────────────────────────────────────

function classifyPayment(coveredMonths: string[]): { label: string; bg: string; color: string } | null {
  if (!coveredMonths || coveredMonths.length === 0) return null;
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const sorted = [...coveredMonths].sort();
  const earliest = sorted[0];
  const latest   = sorted[sorted.length - 1];
  if (latest < currentYM) {
    const n = coveredMonths.length;
    return { label: `Paid ${n} Past Month${n > 1 ? "s" : ""}`, bg: "#FEE8E8", color: "#9B2B2B" };
  }
  if (earliest > currentYM) return { label: "Advance Payment",             bg: "#FEF6E6", color: "#A9812E" };
  if (coveredMonths.length > 1) return { label: "Multi-month",             bg: "#EBF2FC", color: "#2C5F8A" };
  return                           { label: "Current Month",                bg: "#E8F5F0", color: "#0F5C4C" };
}

// ── Receipt ID copy button ────────────────────────────────────────────────────

function ReceiptId({ id }: { id: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span style={{ color: COLORS.textMuted, fontSize: 11 }}>—</span>;
  const copy = () => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{
        fontFamily: TYPOGRAPHY.fontMono, fontSize: 11, fontWeight: 700,
        color: COLORS.primary, letterSpacing: "0.04em",
      }}>{id}</span>
      <button onClick={copy} title="Copy receipt ID" style={{
        background: "none", border: "none", cursor: "pointer", padding: 2,
        color: copied ? COLORS.success : COLORS.textMuted,
        display: "inline-flex", alignItems: "center",
      }}>
        {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
      </button>
    </span>
  );
}

// ── Image modal ──────────────────────────────────────────────────────────────

function ImageModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.8)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", maxWidth: 640, width: "100%" }}>
        <button onClick={onClose} style={{
          position: "absolute", top: -14, right: -14, background: "#fff",
          border: "none", borderRadius: "50%", width: 32, height: 32,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        }}>
          <X size={16} />
        </button>
        <img src={src} alt="Proof" style={{ width: "100%", borderRadius: 12, maxHeight: "80vh", objectFit: "contain" }} />
      </div>
    </div>
  );
}

function buildImgUrl(proof_image: string | null | undefined, backend: string): string | null {
  if (!proof_image) return null;
  if (proof_image.startsWith("http")) return proof_image;
  const base = backend.replace(/\/api\/?$/, "");
  if (proof_image.startsWith("/")) return `${base}${proof_image}`;
  return `${base}/${proof_image}`;
}

// ── Entry type meta ───────────────────────────────────────────────────────────

const TYPE_META = {
  chanda:          { label: "Chanda",          bg: COLORS.primaryLight,  color: COLORS.primary,  icon: Banknote },
  donation:        { label: "Donation",        bg: "#FEF6E6",             color: "#A9812E",       icon: Gift },
  expense:         { label: "Expense",         bg: "#FEE8E8",             color: "#9B2B2B",       icon: TrendingDown },
  cash_submission: { label: "Cash Submission", bg: "#F0EFF8",             color: "#5148A0",       icon: Wallet },
};

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ entry, onClose }: { entry: TimelineEntry | null; onClose: () => void }) {
  const BACKEND = (import.meta as any).env?.VITE_BACKEND_URL || "";
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [submittingRollback, setSubmittingRollback] = useState(false);
  const isMobile = useMediaQuery("(max-width: 640px)");

  if (!entry) return null;

  const imgUrl = buildImgUrl(entry.proof_image, BACKEND);
  const meta = TYPE_META[entry.entry_type];
  const pad = isMobile ? 16 : 24;
  const isExpense = entry.entry_type === "expense";

  const handleRollback = async () => {
    if (!entry || entry.entry_type !== "chanda") return;
    if (!entry.id) return;
    setSubmittingRollback(true);
    try {
      await requestPaymentRollback(entry.id, rollbackReason.trim() || undefined);
      setRollbackReason("");
      onClose();
    } catch {
      alert("Unable to submit rollback request.");
    } finally {
      setSubmittingRollback(false);
    }
  };

  const detailRows = [
    entry.entry_type === "chanda" && { label: "Source",            value: entry.created_by !== "user" ? "Collector" : "Self (mobile app)" },
    entry.entry_type === "chanda" && { label: "Collected by",      value: entry.collected_by || "—" },
    entry.entry_type === "donation" && { label: "Donor",           value: entry.head_name },
    entry.entry_type === "donation" && { label: "Purpose",         value: entry.purpose || "—" },
    entry.entry_type === "expense" && { label: "Category",         value: entry.category || "—" },
    entry.entry_type === "expense" && { label: "Approved by",      value: entry.collected_by || "—" },
    entry.entry_type === "cash_submission" && { label: "Collector",value: entry.head_name },
    entry.entry_type === "cash_submission" && { label: "Submitted to", value: entry.collected_by || "—" },
    entry.entry_type === "cash_submission" && entry.submitted_amount != null && { label: "Submitted Amount", value: `₹${entry.submitted_amount.toLocaleString("en-IN")}` },
    entry.entry_type === "cash_submission" && { label: "Period",   value: entry.start_date ? `${fmtDateOnly(entry.start_date)} → ${fmtDateOnly(entry.end_date)}` : "—" },
    { label: "Date & Time",      value: fmtDT(entry.created_at) },
    entry.entry_type !== "cash_submission" && { label: "Transaction Ref", value: entry.transaction_ref || "—" },
    { label: "Notes",            value: entry.notes || "—" },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <>
      {lightbox && <ImageModal src={lightbox} onClose={() => setLightbox(null)} />}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)" }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 1001,
        width: isMobile ? "100vw" : "min(460px, 100vw)", background: COLORS.surface,
        overflowY: "auto", boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: `${pad}px ${pad}px 16px`, borderBottom: `1px solid ${COLORS.divider}`,
          position: "sticky", top: 0, background: COLORS.surface, zIndex: 1,
        }}>
          <div style={{ minWidth: 0, paddingRight: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ background: meta.bg, color: meta.color, borderRadius: 8, padding: "3px 10px", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>
                {meta.label}
              </span>
            </div>
            <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, color: COLORS.text }}>{entry.head_name}</div>
            <ReceiptId id={entry.receipt_id} />
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0 }}>
            <X size={22} color={COLORS.textMuted} />
          </button>
        </div>

        {/* Amount block */}
        <div style={{
          padding: `18px ${pad}px`, borderBottom: `1px solid ${COLORS.divider}`,
          background: isExpense ? "#FEF2F2" : COLORS.primaryLight,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: isExpense ? "#9B2B2B" : COLORS.primary, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
            {isExpense ? "Amount Spent" : "Amount Received"}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: TYPOGRAPHY.fontDisplay, fontSize: isMobile ? 32 : 40, fontWeight: 700, color: isExpense ? "#9B2B2B" : COLORS.text }}>
              {isExpense ? "−" : "+"}{fmt(entry.amount)}
            </span>
            {entry.method && (
              <span style={{ background: isExpense ? "#fee" : "#e8f5f0", color: isExpense ? "#9B2B2B" : COLORS.primary, borderRadius: 7, padding: "3px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                {entry.method.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Detail rows */}
        <div style={{ padding: `14px ${pad}px 0` }}>
          {detailRows.map(({ label, value }) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              padding: "10px 0", borderBottom: `1px solid ${COLORS.divider}`, gap: 16,
            }}>
              <span style={{ fontSize: 12, color: COLORS.textMuted, minWidth: 110, flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, textAlign: "right", wordBreak: "break-word" }}>{value}</span>
            </div>
          ))}

          {/* Covered months */}
          {entry.covered_months?.length > 0 && (
            <div style={{ padding: "10px 0", borderBottom: `1px solid ${COLORS.divider}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>Months Covered ({entry.covered_months.length})</span>
                {(() => { const cls = classifyPayment(entry.covered_months); return cls ? (
                  <span style={{ background: cls.bg, color: cls.color, borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{cls.label}</span>
                ) : null; })()}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {entry.covered_months.map((ym: string) => {
                  const [y, m] = ym.split("-");
                  const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
                  return (
                    <span key={ym} style={{ background: COLORS.primaryLight, color: COLORS.primary, borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 600 }}>{label}</span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rollback action for verified chanda payments */}
          {entry.entry_type === "chanda" && entry.status === "verified" && entry.rollback_status !== "pending" && (
            <div style={{ paddingTop: 18, paddingBottom: 12 }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>Rollback request</div>
              <textarea
                value={rollbackReason}
                onChange={e => setRollbackReason(e.target.value)}
                placeholder="Reason for rollback (optional)"
                rows={3}
                style={{ width: "100%", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
              />
              <button disabled={submittingRollback} onClick={handleRollback} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, background: "#F5F3FF", color: "#7C3AED", border: "1px solid #DDD6FE", cursor: submittingRollback ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                <RotateCcw size={13} /> {submittingRollback ? "Submitting…" : "Request rollback"}
              </button>
            </div>
          )}

          {/* Proof image */}
          {entry.entry_type !== "expense" && (
            <div style={{ paddingTop: 16, paddingBottom: 24 }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 10 }}>Payment Proof / Screenshot</div>
              {imgUrl ? (
                <div onClick={() => setLightbox(imgUrl)} style={{ cursor: "zoom-in", borderRadius: 10, overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
                  <img src={imgUrl} alt="Proof" style={{ width: "100%", objectFit: "contain", maxHeight: 300, display: "block" }}
                    onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }} />
                  <div style={{ padding: "6px 10px", background: SURFACE_HOVER, fontSize: 11, color: COLORS.textMuted, textAlign: "center" }}>Click to enlarge</div>
                </div>
              ) : (
                <div style={{ padding: "14px 16px", background: COLORS.warningLight || "#FEF6E6", borderRadius: 10, display: "flex", alignItems: "center", gap: 10 }}>
                  <ImageIcon size={16} color={COLORS.warning} />
                  <span style={{ fontSize: 12, color: COLORS.warning }}>
                    {entry.created_by !== "user" ? "No proof image uploaded for this collection" : "No image (user self-payment)"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Method badge ──────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, { bg: string; color: string }> = {
  cash:   { bg: "#E8F5F0", color: "#0F5C4C" },
  upi:    { bg: "#FEF6E6", color: "#A9812E" },
  gpay:   { bg: "#FEF6E6", color: "#A9812E" },
  bank:   { bg: "#EBF2FC", color: "#2C5F8A" },
  cheque: { bg: "#F3EEF9", color: "#6B4B9E" },
};
function methodStyle(m: string | null) {
  return m ? (METHOD_COLORS[m.toLowerCase()] ?? { bg: "#F0F0F0", color: "#555" }) : { bg: "#F0F0F0", color: "#555" };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const filterLabelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: COLORS.textMuted,
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5,
};

const selectStyle: React.CSSProperties = {
  padding: "9px 12px", border: `1px solid ${COLORS.border}`, borderRadius: 8,
  fontSize: 13, background: COLORS.surface, cursor: "pointer", outline: "none", boxSizing: "border-box",
};

const pageBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 34, height: 34, borderRadius: 8,
  border: `1px solid ${COLORS.border}`, background: COLORS.surface,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
});

// ── Main Page ─────────────────────────────────────────────────────────────────

import React from "react";

export default function CollectionHistoryPage() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const isNarrow = useMediaQuery("(max-width: 420px)");

  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [selected, setSelected] = useState<TimelineEntry | null>(null);

  // Filters
  const [search, setSearch]           = useState("");
  const [filterType, setFilterType]   = useState("");      // "chanda"|"donation"|"expense"|""
  const [filterBy, setFilterBy]       = useState("");      // "collector"|"user"|"admin"|""
  const [filterMethod, setFilterMethod] = useState("");
  const [fromDate, setFromDate]       = useState("");
  const [toDate, setToDate]           = useState("");

  const CACHE_KEY = "finance_timeline_cache";
  const PER_PAGE  = 50;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    const params: Record<string, string> = { page: String(p), per_page: String(PER_PAGE) };
    if (filterType)   params.type       = filterType;
    if (filterBy)     params.created_by = filterBy;
    if (filterMethod) params.method     = filterMethod;
    if (fromDate)     params.from_date  = fromDate + "T00:00:00";
    if (toDate)       params.to_date    = toDate   + "T23:59:59";
    if (search.trim()) params.search    = search.trim();

    try {
      const { data } = await api.get("/finance/timeline", { params });
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
      setIsOffline(false);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ entries: data.entries ?? [], total: data.total ?? 0, ts: Date.now() }));
    } catch {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        try {
          const cached = JSON.parse(raw);
          setEntries(cached.entries ?? []);
          setTotal(cached.total ?? 0);
          setIsOffline(true);
        } catch { setEntries([]); }
      } else {
        setEntries([]);
      }
    } finally {
      setLoading(false);
    }
  }, [filterType, filterBy, filterMethod, fromDate, toDate, search]);

  useEffect(() => { setPage(1); load(1); }, [load]);
  useEffect(() => { load(page); }, [page]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket: live updates ───────────────────────────────
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const apiBase = (import.meta as any).env?.VITE_BACKEND_URL || "";
    const host = apiBase ? new URL(apiBase).host : window.location.host;
    const token = localStorage.getItem("access_token") || "";
    const wsUrl = `${proto}://${host}/ws/finance${token ? `?token=${token}` : ""}`;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (["dashboard_updated", "monthly_amount_updated", "payment_verified", "payment_collected"].includes(msg.type)) {
              loadRef.current(1);
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => { retryTimer = setTimeout(connect, 20_000); };
      } catch {}
    };
    connect();
    return () => { ws?.close(); if (retryTimer) clearTimeout(retryTimer); };
  }, []);

  const hasFilters = !!(filterType || filterBy || filterMethod || fromDate || toDate || search);
  const clearFilters = () => { setFilterType(""); setFilterBy(""); setFilterMethod(""); setFromDate(""); setToDate(""); setSearch(""); };

  return (
    <div style={{ maxWidth: 1180, paddingBottom: 40, padding: isMobile ? "0 12px 40px" : "0" }}>
      {selected && <DetailPanel entry={selected} onClose={() => setSelected(null)} />}

      {/* Header */}
      <div style={{
        display: "flex", flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "flex-start", justifyContent: "space-between",
        gap: 12, marginBottom: isMobile ? 16 : 24, marginTop: isMobile ? 16 : 0,
      }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: TYPOGRAPHY.fontDisplay, fontSize: isMobile ? 24 : 32, fontWeight: 400, color: COLORS.text }}>
            Finance Timeline
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.textSecondary }}>
            Chanda · Donations · Expenses — {total.toLocaleString("en-IN")} entries
          </p>
        </div>
        <button onClick={() => load(page)} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "8px 14px", border: `1px solid ${COLORS.border}`, borderRadius: 10,
          background: COLORS.surface, cursor: "pointer", fontSize: 12, color: COLORS.textSecondary,
          width: isMobile ? "100%" : "auto", flexShrink: 0,
        }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Offline banner */}
      {isOffline && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          background: "#FEF6E6", border: "1px solid #F0D488", borderRadius: 10, marginBottom: 14,
          fontSize: 12, color: "#A97010",
        }}>
          <WifiOff size={14} color="#B07A1E" />
          Showing cached data — offline
        </div>
      )}

      {/* Filters */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 14, marginBottom: isMobile ? 14 : 20,
        padding: isMobile ? "14px" : "16px 18px", background: COLORS.surface,
        borderRadius: 14, border: `1px solid ${COLORS.cardBorder}`, overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.textMuted }}>
          <SlidersHorizontal size={12} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filters</span>
        </div>

        {/* Search */}
        <div style={{ position: "relative", width: "100%" }}>
          <Search size={13} color={COLORS.textMuted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Receipt ID · Name · Phone · Chanda No…"
            style={{
              width: "100%", paddingLeft: 30, paddingRight: 10, paddingTop: 9, paddingBottom: 9,
              border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 13,
              background: COLORS.background || SURFACE_HOVER, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Type + Source + Method */}
        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 1fr", gap: 8, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={filterLabelStyle}>Type</div>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
              <option value="">All types</option>
              <option value="chanda">Chanda</option>
              <option value="donation">Donation</option>
              <option value="expense">Expense</option>
              <option value="cash_submission">Cash Submission</option>
            </select>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={filterLabelStyle}>Source</div>
            <select value={filterBy} onChange={e => setFilterBy(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
              <option value="">All sources</option>
              <option value="collector">Collector</option>
              <option value="user">Self (app)</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={filterLabelStyle}>Method</div>
            <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
              <option value="">All methods</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI / GPay</option>
              <option value="bank">Bank</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
        </div>

        {/* Date range */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={filterLabelStyle}>From date</div>
            <div style={{ position: "relative" }}>
              <Calendar size={13} color={COLORS.textMuted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                style={{ ...selectStyle, width: "100%", paddingLeft: 30, colorScheme: "light" }} />
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={filterLabelStyle}>To date</div>
            <div style={{ position: "relative" }}>
              <Calendar size={13} color={COLORS.textMuted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                style={{ ...selectStyle, width: "100%", paddingLeft: 30, colorScheme: "light" }} />
            </div>
          </div>
        </div>

        {hasFilters && (
          <button onClick={clearFilters} style={{
            padding: "8px 12px", border: `1px solid ${COLORS.border}`, borderRadius: 8,
            background: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: COLORS.textMuted,
            alignSelf: isMobile ? "stretch" : "flex-start",
          }}>
            Clear filters
          </button>
        )}
      </div>

      {/* ── Mobile card list ── */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: COLORS.textMuted, fontSize: 14, background: COLORS.surface, borderRadius: 14 }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: COLORS.textMuted, fontSize: 14, background: COLORS.surface, borderRadius: 14 }}>No entries found.</div>
          ) : entries.map(e => {
            const meta  = TYPE_META[e.entry_type];
            const Icon  = meta.icon;
            const ms    = methodStyle(e.method);
            const cls   = classifyPayment(e.covered_months);
            const isExp = e.entry_type === "expense";
            return (
              <div key={`${e.entry_type}_${e.id}`} onClick={() => setSelected(e)} style={{
                background: COLORS.surface, borderRadius: 14, border: `1px solid ${COLORS.cardBorder}`,
                padding: 14, cursor: "pointer",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={14} color={meta.color} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.text }}>{e.head_name}</div>
                      <ReceiptId id={e.receipt_id} />
                    </div>
                  </div>
                  <ChevronRight size={16} color={COLORS.textMuted} style={{ flexShrink: 0, marginTop: 4 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${COLORS.divider}` }}>
                  <div>
                    <div style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 16, fontWeight: 700, color: isExp ? "#9B2B2B" : COLORS.text }}>
                      {isExp ? "−" : "+"}{fmt(e.amount)}
                    </div>
                    {cls && <div style={{ fontSize: 9, fontWeight: 800, color: cls.color, textTransform: "uppercase", marginTop: 2 }}>{cls.label}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    {e.method && <span style={{ ...ms, borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{e.method.toUpperCase()}</span>}
                    <span style={{ fontSize: 10.5, color: COLORS.textMuted }}>{fmtDateOnly(e.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Desktop table ── */
        <div style={{ background: COLORS.surface, borderRadius: 16, border: `1px solid ${COLORS.cardBorder}`, overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1.4fr 1fr 90px 90px 140px 36px",
            padding: "11px 18px", borderBottom: `1px solid ${COLORS.divider}`,
            background: COLORS.background || SURFACE_HOVER,
          }}>
            {["Party / Description", "Receipt ID", "Type", "Amount", "Method", "Date & Time", ""].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 800, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: 48, textAlign: "center", color: COLORS.textMuted, fontSize: 14 }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: COLORS.textMuted, fontSize: 14 }}>No entries found.</div>
          ) : entries.map((e, i) => {
            const meta  = TYPE_META[e.entry_type];
            const Icon  = meta.icon;
            const ms    = methodStyle(e.method);
            const cls   = classifyPayment(e.covered_months);
            const isExp = e.entry_type === "expense";
            return (
              <div
                key={`${e.entry_type}_${e.id}`}
                onClick={() => setSelected(e)}
                style={{
                  display: "grid", gridTemplateColumns: "2fr 1.4fr 1fr 90px 90px 140px 36px",
                  padding: "13px 18px", cursor: "pointer",
                  borderBottom: i < entries.length - 1 ? `1px solid ${COLORS.divider}` : "none",
                  transition: "background 0.12s", alignItems: "center",
                }}
                onMouseEnter={ev => (ev.currentTarget.style.background = SURFACE_HOVER)}
                onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}
              >
                {/* Name + icon */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={13} color={meta.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{e.head_name}</div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                      {e.entry_type === "chanda" ? (e.created_by !== "user" ? "Collector" : "App self-pay") : meta.label}
                      {e.entry_type === "chanda" && e.proof_image && <ImageIcon size={11} color={COLORS.primary} style={{ marginLeft: 4 }} />}
                    </div>
                  </div>
                </div>

                {/* Receipt ID */}
                <div onClick={ev => ev.stopPropagation()}>
                  <ReceiptId id={e.receipt_id} />
                </div>

                {/* Type badge */}
                <div>
                  <span style={{ background: meta.bg, color: meta.color, borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
                    {meta.label}
                  </span>
                </div>

                {/* Amount + classification */}
                <div>
                  <div style={{ fontFamily: TYPOGRAPHY.fontMono, fontSize: 13, fontWeight: 700, color: isExp ? "#9B2B2B" : COLORS.text }}>
                    {isExp ? "−" : "+"}{fmt(e.amount)}
                  </div>
                  {cls && (
                    <span style={{ background: cls.bg, color: cls.color, borderRadius: 4, padding: "2px 5px", fontSize: 8, fontWeight: 800, textTransform: "uppercase", display: "inline-block", marginTop: 2 }}>
                      {cls.label}
                    </span>
                  )}
                </div>

                {/* Method */}
                <div>
                  {e.method ? (
                    <span style={{ ...ms, borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      {e.method.toUpperCase()}
                    </span>
                  ) : <span style={{ fontSize: 11, color: COLORS.textMuted }}>—</span>}
                </div>

                {/* Date */}
                <div style={{ fontSize: 11, color: COLORS.textSecondary }}>{fmtDT(e.created_at)}</div>

                {/* Arrow */}
                <div style={{ textAlign: "right" }}><ChevronRight size={14} color={COLORS.textMuted} /></div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 8 : 12, marginTop: 20, flexWrap: "wrap" }}>
          <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={pageBtnStyle(page === 1)}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: isMobile ? 12 : 13, color: COLORS.textSecondary, textAlign: "center" }}>
            Page {page} of {totalPages} · {total} total
          </span>
          <button disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} style={pageBtnStyle(page === totalPages)}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
