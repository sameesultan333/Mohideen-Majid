import React, { useEffect, useState, useCallback } from "react";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import {
  listCashSubmissions,
  approveCashSubmission,
  rejectCashSubmission,
  getCashSubmissionTransactions,
  type CashSubmission,
  type CashSubmissionTransaction,
} from "../../api/registrations";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const fmtDateTime = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const statusColor = (status: string) => {
  if (status === "approved") return { bg: COLORS.successLight ?? "#EEF9EE", text: COLORS.success };
  if (status === "rejected") return { bg: COLORS.dangerLight, text: COLORS.danger };
  return { bg: COLORS.warningLight ?? "#FFF8E6", text: COLORS.warning ?? "#A97300" };
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page:         { padding: "16px", maxWidth: "1100px", margin: "0 auto" },
  title:        { fontFamily: TYPOGRAPHY.fontDisplay, fontSize: "32px", fontWeight: 400, color: COLORS.text, marginBottom: "4px" },
  subtitle:     { fontSize: "15px", color: COLORS.textSecondary, marginBottom: "24px" },
  toolbar:      { display: "flex", gap: "10px", marginBottom: "20px", alignItems: "center", flexWrap: "wrap" },
  filterBtn:    { padding: "7px 16px", borderRadius: "10px", border: `1px solid ${COLORS.border}`,
                  background: COLORS.surface, fontSize: "13px", fontWeight: 600, cursor: "pointer",
                  transition: "background 0.2s, border-color 0.2s", color: COLORS.textSecondary },
  filterBtnActive: { background: COLORS.primaryLight, borderColor: COLORS.primaryBorder, color: COLORS.primary },
  emptyBox:     { textAlign: "center", padding: "80px 24px", color: COLORS.textMuted },
  card:         { background: COLORS.surface, borderRadius: "16px", border: `1px solid ${COLORS.border}`,
                  boxShadow: COLORS.shadowSm, padding: "20px", marginBottom: "12px",
                  display: "flex", gap: "16px", alignItems: "flex-start",
                  transition: "box-shadow 0.2s" },
  cardLeft:     { flex: 1, minWidth: 0 },
  cardName:     { fontSize: "15px", fontWeight: 700, color: COLORS.text, marginBottom: "2px" },
  cardMeta:     { fontSize: "13px", color: COLORS.textSecondary, marginBottom: "6px" },
  cardAmt:      { fontSize: "24px", fontWeight: 800, color: COLORS.text, fontFamily: "'Fraunces', serif" },
  amtLine:      { fontSize: "12px", color: COLORS.textMuted, marginTop: "2px" },
  badge:        { display: "inline-block", padding: "4px 14px", borderRadius: "999px", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" },
  period:       { fontSize: "12px", color: COLORS.textSecondary, marginTop: "4px" },
  rejectNote:   { marginTop: "6px", fontSize: "12px", color: COLORS.danger, fontStyle: "italic" },
  actionBtns:   { display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 },
  approveBtn:   { padding: "8px 18px", borderRadius: "10px", border: "none",
                  background: COLORS.primary, color: "#fff", fontWeight: 700, fontSize: "13px",
                  cursor: "pointer", transition: "background 0.2s", whiteSpace: "nowrap" },
  rejectBtn:    { padding: "8px 18px", borderRadius: "10px", border: `1px solid ${COLORS.danger}`,
                  background: COLORS.dangerLight, color: COLORS.danger, fontWeight: 700, fontSize: "13px",
                  cursor: "pointer", transition: "background 0.2s", whiteSpace: "nowrap" },

  // ── Modal ─────────────────────────────────────────────────────────────────
  overlay:      { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
                  animation: "fadeIn 0.2s ease" },
  modal:        { background: COLORS.surface, borderRadius: "20px", width: "420px", maxWidth: "100%",
                  boxShadow: COLORS.shadowLg ?? "0 20px 60px rgba(0,0,0,0.2)", animation: "slideUp 0.25s ease" },
  modalHeader:  { padding: "22px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" },
  modalTitle:   { fontSize: "17px", fontWeight: 700, color: COLORS.text },
  modalClose:   { width: "32px", height: "32px", borderRadius: "50%", border: "none",
                  background: COLORS.backgroundAlt, cursor: "pointer", fontSize: "18px",
                  color: COLORS.textSecondary, display: "flex", alignItems: "center", justifyContent: "center" },
  modalBody:    { padding: "20px 24px 28px" },
  label:        { display: "block", fontSize: "12px", fontWeight: 700, color: COLORS.textSecondary,
                  marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "16px" },
  input:        { width: "100%", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${COLORS.border}`,
                  fontSize: "14px", background: COLORS.surface, color: COLORS.text,
                  boxSizing: "border-box", outline: "none" },
  textarea:     { width: "100%", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${COLORS.border}`,
                  fontSize: "14px", background: COLORS.surface, color: COLORS.text,
                  boxSizing: "border-box", outline: "none", resize: "vertical", minHeight: "70px", fontFamily: "inherit" },
  modalActions: { display: "flex", gap: "10px", marginTop: "22px" },
  modalCancel:  { flex: 1, padding: "11px", borderRadius: "12px", border: `1px solid ${COLORS.border}`,
                  background: COLORS.backgroundAlt, color: COLORS.textMuted, fontWeight: 600, fontSize: "14px",
                  cursor: "pointer" },
  modalConfirm: { flex: 1, padding: "11px", borderRadius: "12px", border: "none",
                  fontWeight: 700, fontSize: "14px", cursor: "pointer", transition: "opacity 0.2s" },
  errorBanner:  { background: COLORS.dangerLight, color: COLORS.danger, padding: "10px 14px",
                  borderRadius: "10px", marginBottom: "14px", fontSize: "13px", border: `1px solid ${COLORS.danger}` },
  successBanner: { background: COLORS.successLight ?? "#EEF9EE", color: COLORS.success, padding: "12px 16px",
                   borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.success}` },
};

const css = document.createElement("style");
css.innerHTML = `
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes slideUp { from { transform: translateY(16px); opacity: 0 } to { transform: none; opacity: 1 } }
`;
document.head.appendChild(css);

// ─── Approve Modal ────────────────────────────────────────────────────────────

interface ApproveModalProps {
  sub: CashSubmission;
  onClose: () => void;
  onDone: () => void;
}

function ApproveModal({ sub, onClose, onDone }: ApproveModalProps) {
  const [approvedAmount, setApprovedAmount] = useState(String(sub.submitted_amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await approveCashSubmission(sub.id, approvedAmount ? parseFloat(approvedAmount) : undefined);
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to approve");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>Approve Cash Submission</div>
          <button style={S.modalClose} onClick={onClose}>✕</button>
        </div>
        <div style={S.modalBody}>
          {error && <div style={S.errorBanner}>⚠ {error}</div>}
          <div style={{ fontSize: "14px", color: COLORS.textSecondary }}>
            <strong style={{ color: COLORS.text }}>{sub.collector_name}</strong> submitted ₹{sub.submitted_amount.toLocaleString("en-IN")} for{" "}
            {fmtDate(sub.start_date)} → {fmtDate(sub.end_date)}
          </div>
          <label style={S.label}>Submitted Amount</label>
          <div style={{ fontSize: "20px", fontWeight: 800, color: COLORS.text, fontFamily: "'Fraunces', serif", marginBottom: "4px" }}>
            ₹{sub.submitted_amount.toLocaleString("en-IN")}
          </div>
          <label style={{ ...S.label, marginTop: "14px" }}>Approved Amount (₹)</label>
          <input
            style={S.input}
            type="number"
            value={approvedAmount}
            onChange={(e) => setApprovedAmount(e.target.value)}
            placeholder={String(sub.submitted_amount)}
          />
          <div style={{ fontSize: "12px", color: COLORS.textMuted, marginTop: "6px" }}>
            Edit only if approving a different amount
          </div>
          <div style={S.modalActions}>
            <button style={S.modalCancel} onClick={onClose} disabled={busy}>Cancel</button>
            <button
              style={{ ...S.modalConfirm, background: COLORS.primary, color: "#fff", opacity: busy ? 0.6 : 1 }}
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy ? "Approving…" : "Confirm Approval"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────

interface RejectModalProps {
  sub: CashSubmission;
  onClose: () => void;
  onDone: () => void;
}

function RejectModal({ sub, onClose, onDone }: RejectModalProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!reason.trim()) { setError("Reason is required"); return; }
    setBusy(true);
    setError(null);
    try {
      await rejectCashSubmission(sub.id, reason);
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to reject");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>Reject Submission</div>
          <button style={S.modalClose} onClick={onClose}>✕</button>
        </div>
        <div style={S.modalBody}>
          {error && <div style={S.errorBanner}>⚠ {error}</div>}
          <div style={{ fontSize: "14px", color: COLORS.textSecondary }}>
            Rejecting ₹{sub.submitted_amount.toLocaleString("en-IN")} from <strong style={{ color: COLORS.text }}>{sub.collector_name}</strong>
          </div>
          <label style={S.label}>Reason for Rejection</label>
          <textarea
            style={S.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this submission is being rejected…"
          />
          <div style={S.modalActions}>
            <button style={S.modalCancel} onClick={onClose} disabled={busy}>Cancel</button>
            <button
              style={{ ...S.modalConfirm, background: COLORS.danger, color: "#fff", opacity: busy ? 0.6 : 1 }}
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy ? "Rejecting…" : "Reject Submission"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Transactions Modal ───────────────────────────────────────────────────────

interface TransactionsModalProps {
  sub: CashSubmission;
  onClose: () => void;
}

function TransactionsModal({ sub, onClose }: TransactionsModalProps) {
  const [txns, setTxns] = useState<CashSubmissionTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCashSubmissionTransactions(sub.id)
      .then(setTxns)
      .catch(() => setError("Failed to load transactions"));
  }, [sub.id]);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, width: "520px" }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>Transactions — {sub.collector_name}</div>
          <button style={S.modalClose} onClick={onClose}>✕</button>
        </div>
        <div style={{ ...S.modalBody, maxHeight: "60vh", overflowY: "auto" }}>
          {error && <div style={S.errorBanner}>⚠ {error}</div>}
          {!txns && !error && <div style={{ color: COLORS.textMuted, fontSize: "14px" }}>Loading…</div>}
          {txns && txns.length === 0 && (
            <div style={{ color: COLORS.textMuted, fontSize: "14px" }}>No transactions found.</div>
          )}
          {txns && txns.map((t) => (
            <div
              key={`${t.type}-${t.id}`}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: `1px solid ${COLORS.border}`,
              }}
            >
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: COLORS.text }}>
                  {t.head_name ?? "—"}
                </div>
                <div style={{ fontSize: "12px", color: COLORS.textSecondary }}>
                  {t.type === "chanda" ? "Monthly Chanda" : "Donation"} · {t.method?.toUpperCase()} ·{" "}
                  {t.date ? fmtDate(t.date) : "—"}
                </div>
              </div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: COLORS.text }}>
                ₹{parseFloat(t.amount).toLocaleString("en-IN")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type FilterType = "all" | "pending" | "approved" | "rejected";

const CashSubmissionsPage: React.FC = () => {
  const [subs, setSubs] = useState<CashSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("pending");
  const [approving, setApproving] = useState<CashSubmission | null>(null);
  const [rejecting, setRejecting] = useState<CashSubmission | null>(null);
  const [viewingTxns, setViewingTxns] = useState<CashSubmission | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listCashSubmissions();
      setSubs(Array.isArray(result) ? result : []);
    } catch {
      setError("Failed to load cash submissions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDone = () => {
    setApproving(null);
    setRejecting(null);
    setSuccess("Done");
    fetchData();
    setTimeout(() => setSuccess(null), 4000);
  };

  const filtered = subs.filter((s) => filter === "all" || s.status === filter);

  const counts = {
    all: subs.length,
    pending: subs.filter((s) => s.status === "pending").length,
    approved: subs.filter((s) => s.status === "approved").length,
    rejected: subs.filter((s) => s.status === "rejected").length,
  };

  return (
    <div style={S.page}>
      <h1 style={S.title}>Cash Submissions</h1>
      <p style={S.subtitle}>
        {loading ? "Loading…" : `${counts.pending} pending · ${counts.approved} approved · ${counts.rejected} rejected`}
      </p>

      {error && <div style={S.errorBanner}>⚠ {error}</div>}
      {success && <div style={S.successBanner}>✓ {success}</div>}

      <div style={S.toolbar}>
        {(["all", "pending", "approved", "rejected"] as FilterType[]).map((f) => (
          <button
            key={f}
            style={{ ...S.filterBtn, ...(filter === f ? S.filterBtnActive : {}) }}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
        <button
          style={{ ...S.filterBtn, marginLeft: "auto" }}
          onClick={fetchData}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = COLORS.primaryLight; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = COLORS.surface; }}
        >
          Refresh
        </button>
      </div>

      {!loading && filtered.length === 0 ? (
        <div style={S.emptyBox}>No {filter === "all" ? "" : filter} submissions found.</div>
      ) : (
        filtered.map((sub) => {
          const sc = statusColor(sub.status);
          return (
            <div
              key={sub.id}
              style={S.card}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = COLORS.shadow; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = COLORS.shadowSm; }}
            >
              <div style={S.cardLeft}>
                <div style={S.cardName}>{sub.collector_name}</div>
                {sub.receiving_admin_name && (
                  <div style={{ ...S.cardMeta, marginBottom: "2px" }}>
                    Submitted to: <strong style={{ color: COLORS.text }}>{sub.receiving_admin_name}</strong>
                  </div>
                )}
                <div style={S.cardMeta}>Submitted {fmtDateTime(sub.submitted_at)}</div>
                <div style={S.cardAmt}>₹{sub.submitted_amount.toLocaleString("en-IN")}</div>
                {(sub.cash_amount !== null || sub.online_amount !== null) && (
                  <div style={S.amtLine}>
                    Cash: ₹{(sub.cash_amount ?? 0).toLocaleString("en-IN")} · Online: ₹{(sub.online_amount ?? 0).toLocaleString("en-IN")}
                  </div>
                )}
                {sub.approved_amount !== null && sub.approved_amount !== sub.submitted_amount && (
                  <div style={S.amtLine}>Approved: ₹{sub.approved_amount.toLocaleString("en-IN")}</div>
                )}
                <div style={S.period}>
                  Period: {fmtDate(sub.start_date)} → {fmtDate(sub.end_date)}
                </div>
                {sub.notes && (
                  <div style={{ ...S.period, marginTop: "4px", fontStyle: "italic" }}>"{sub.notes}"</div>
                )}
                {sub.rejection_reason && (
                  <div style={S.rejectNote}>Rejected: {sub.rejection_reason}</div>
                )}
                <div style={{ marginTop: "8px", display: "flex", gap: "10px", alignItems: "center" }}>
                  <span style={{ ...S.badge, background: sc.bg, color: sc.text }}>
                    {sub.status}
                  </span>
                  <button
                    style={{ ...S.filterBtn, padding: "4px 12px", fontSize: "12px" }}
                    onClick={() => setViewingTxns(sub)}
                  >
                    View Transactions
                  </button>
                </div>
              </div>
              {sub.status === "pending" && (
                <div style={S.actionBtns}>
                  <button
                    style={S.approveBtn}
                    onClick={() => setApproving(sub)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = COLORS.primaryHover; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = COLORS.primary; }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    style={S.rejectBtn}
                    onClick={() => setRejecting(sub)}
                  >
                    ✕ Reject
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {approving && (
        <ApproveModal sub={approving} onClose={() => setApproving(null)} onDone={handleDone} />
      )}
      {rejecting && (
        <RejectModal sub={rejecting} onClose={() => setRejecting(null)} onDone={handleDone} />
      )}
      {viewingTxns && (
        <TransactionsModal sub={viewingTxns} onClose={() => setViewingTxns(null)} />
      )}
    </div>
  );
};

export default CashSubmissionsPage;
