import React, { useEffect, useState, useCallback } from "react";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import {
  listPendingRegistrations,
  getPendingRegistration,
  approveRegistration,
  rejectRegistration,
  type PendingUser,
  type PendingDetail,
  type ApprovePayload,
} from "../../api/registrations";
import { resetUserPassword } from "../../api/users";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDateTime = (s?: string | null) => {
  if (!s) return "—";
  // Treat bare ISO strings as UTC (backend stores in UTC without "Z")
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const initials = (name?: string | null) => {
  if (!name) return "?";
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page:        { padding: "16px", maxWidth: "1100px", margin: "0 auto" },
  title:       { fontFamily: TYPOGRAPHY.fontDisplay, fontSize: "32px", fontWeight: 400, color: COLORS.text, marginBottom: "4px" },
  subtitle:    { fontSize: "15px", color: COLORS.textSecondary, marginBottom: "24px" },
  emptyBox:    { textAlign: "center", padding: "80px 24px", color: COLORS.textMuted },
  emptyIcon:   { fontSize: "48px", marginBottom: "16px" },
  emptyMsg:    { fontSize: "16px", fontWeight: 600, color: COLORS.textSecondary },
  emptyHint:   { fontSize: "14px", color: COLORS.textMuted, marginTop: "6px" },
  card:        { background: COLORS.surface, borderRadius: "16px", border: `1px solid ${COLORS.border}`,
                 boxShadow: COLORS.shadowSm, padding: "20px", marginBottom: "12px",
                 display: "flex", alignItems: "center", gap: "16px", cursor: "pointer",
                 transition: "box-shadow 0.2s, transform 0.2s" },
  avatar:      { width: "48px", height: "48px", borderRadius: "50%", background: COLORS.accentLight,
                 color: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center",
                 fontWeight: 700, fontSize: "16px", flexShrink: 0 },
  cardInfo:    { flex: 1, minWidth: 0 },
  cardName:    { fontSize: "16px", fontWeight: 700, color: COLORS.text },
  cardMeta:    { fontSize: "13px", color: COLORS.textSecondary, marginTop: "3px" },
  pendingBadge: { display: "inline-block", padding: "3px 12px", borderRadius: "999px", fontSize: "11px",
                  fontWeight: 700, background: COLORS.warningLight ?? "#FFF8E6", color: COLORS.warning ?? "#A97300",
                  textTransform: "uppercase", letterSpacing: "0.05em" },
  reviewBtn:   { padding: "8px 20px", borderRadius: "10px", border: `1px solid ${COLORS.primaryBorder}`,
                 background: COLORS.primaryLight, color: COLORS.primary, fontWeight: 700, fontSize: "13px",
                 cursor: "pointer", flexShrink: 0, transition: "background 0.2s" },

  // ── Modal ─────────────────────────────────────────────────────────────────
  overlay:     { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200,
                 display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
                 animation: "fadeIn 0.2s ease" },
  modal:       { background: COLORS.surface, borderRadius: "20px", width: "540px", maxWidth: "100%",
                 maxHeight: "90vh", overflowY: "auto", boxShadow: COLORS.shadowLg ?? "0 20px 60px rgba(0,0,0,0.2)",
                 animation: "slideUp 0.25s ease" },
  modalHeader: { padding: "22px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  modalTitle:  { fontSize: "18px", fontWeight: 700, color: COLORS.text },
  modalClose:  { width: "32px", height: "32px", borderRadius: "50%", border: "none",
                 background: COLORS.backgroundAlt, cursor: "pointer", fontSize: "18px",
                 color: COLORS.textSecondary, display: "flex", alignItems: "center", justifyContent: "center",
                 flexShrink: 0 },
  modalBody:   { padding: "20px 24px 28px" },

  sectionLabel: { fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                  color: COLORS.textMuted, marginBottom: "10px", marginTop: "20px" },
  infoRow:     { display: "flex", justifyContent: "space-between", padding: "7px 0",
                 borderBottom: `1px solid ${COLORS.divider}`, fontSize: "14px" },
  infoLabel:   { color: COLORS.textSecondary },
  infoValue:   { fontWeight: 500, color: COLORS.text, maxWidth: "260px", wordBreak: "break-word", textAlign: "right" },

  field:       { marginBottom: "14px" },
  label:       { display: "block", fontSize: "12px", fontWeight: 700, color: COLORS.textSecondary,
                 marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.04em" },
  input:       { width: "100%", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${COLORS.border}`,
                 fontSize: "14px", background: COLORS.surface, color: COLORS.text,
                 boxSizing: "border-box", outline: "none", transition: "border-color 0.2s" },
  select:      { width: "100%", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${COLORS.border}`,
                 fontSize: "14px", background: COLORS.surface, color: COLORS.text,
                 boxSizing: "border-box", outline: "none", appearance: "none",
                 backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
                 backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", cursor: "pointer" },
  textarea:    { width: "100%", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${COLORS.border}`,
                 fontSize: "14px", background: COLORS.surface, color: COLORS.text,
                 boxSizing: "border-box", outline: "none", resize: "vertical", minHeight: "70px", fontFamily: "inherit" },
  actionRow:   { display: "flex", gap: "10px", marginTop: "24px" },
  approveBtn:  { flex: 1, padding: "12px", borderRadius: "12px", border: "none",
                 background: COLORS.primary, color: "#fff", fontWeight: 700, fontSize: "14px",
                 cursor: "pointer", transition: "background 0.2s" },
  rejectBtn:   { flex: 1, padding: "12px", borderRadius: "12px", border: `1px solid ${COLORS.danger}`,
                 background: COLORS.dangerLight, color: COLORS.danger, fontWeight: 700, fontSize: "14px",
                 cursor: "pointer", transition: "background 0.2s" },
  cancelBtn:   { padding: "12px 20px", borderRadius: "12px", border: `1px solid ${COLORS.border}`,
                 background: COLORS.backgroundAlt, color: COLORS.textMuted, fontWeight: 600, fontSize: "14px",
                 cursor: "pointer" },
  suggCard:    { padding: "10px 14px", borderRadius: "10px", border: `1px solid ${COLORS.border}`,
                 background: COLORS.backgroundAlt, cursor: "pointer", marginBottom: "6px",
                 transition: "border-color 0.2s, background 0.2s" },
  suggSel:     { borderColor: COLORS.primary, background: COLORS.primaryLight },
  spinner:     { textAlign: "center", padding: "40px", color: COLORS.textMuted },
  errorBanner: { background: COLORS.dangerLight, color: COLORS.danger, padding: "12px 16px",
                 borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.danger}` },
  successBanner: { background: COLORS.successLight ?? "#EEF9EE", color: COLORS.success, padding: "12px 16px",
                   borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.success}` },
};

const css = document.createElement("style");
css.innerHTML = `
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes slideUp { from { transform: translateY(24px); opacity: 0 } to { transform: none; opacity: 1 } }
`;
document.head.appendChild(css);

const apiErr = (e: any, fallback: string): string => {
  const detail = e?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join("; ");
  return fallback;
};

// ─── Approval Modal ───────────────────────────────────────────────────────────

interface ApprovalModalProps {
  userId: number;
  onClose: () => void;
  onDone: () => void;
}

function ApprovalModal({ userId, onClose, onDone }: ApprovalModalProps) {
  const [detail, setDetail] = useState<PendingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [resetPwd, setResetPwd] = useState("12345678");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // Approval form state
  const [familyAction, setFamilyAction] = useState<"create" | "none">("none");
  const [newChandaNo, setNewChandaNo] = useState("");
  const [activeFromMonth, setActiveFromMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [role, setRole] = useState("member");
  const [chandaAmount, setChandaAmount] = useState("");
  const [phoneOverride, setPhoneOverride] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  // Reject form state
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    getPendingRegistration(userId)
      .then((d) => {
        setDetail(d);
        setPhoneOverride(d.user.phone ?? "");
        setAdminNotes(d.user.admin_notes ?? "");
      })
      .catch(() => setError("Failed to load user details"))
      .finally(() => setLoading(false));
  }, [userId]);

  const handleApprove = async () => {
    if (!detail) return;
    setError(null);
    setBusy(true);
    try {
      const payload: ApprovePayload = {
        family_action: familyAction,
        new_chanda_no: familyAction === "create" ? (newChandaNo || null) : null,
        active_from_month: familyAction === "create" ? activeFromMonth : null,
        role,
        chanda_amount: chandaAmount ? parseFloat(chandaAmount) : null,
        phone_override: phoneOverride || null,
        admin_notes: adminNotes || null,
      };
      await approveRegistration(userId, payload);
      onDone();
    } catch (e: any) {
      setError(apiErr(e, "Approval failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setError("Rejection reason is required"); return; }
    setError(null);
    setBusy(true);
    try {
      await rejectRegistration(userId, rejectReason);
      onDone();
    } catch (e: any) {
      setError(apiErr(e, "Rejection failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>Review Registration</div>
          <button style={S.modalClose} onClick={onClose}>✕</button>
        </div>
        <div style={S.modalBody}>
          {loading ? (
            <div style={S.spinner}>Loading…</div>
          ) : !detail ? (
            <div style={S.errorBanner}>Failed to load user details</div>
          ) : (
            <>
              {error && <div style={S.errorBanner}>⚠ {error}</div>}

              {/* User info */}
              <div style={S.sectionLabel}>Applicant</div>
              {[
                ["Name", detail.user.name],
                ["Phone", detail.user.phone ?? "—"],
                ["Address", detail.user.address ?? "—"],
                ["Registered", fmtDateTime(detail.user.registered_at)],
              ].map(([label, value]) => (
                <div key={label} style={S.infoRow}>
                  <span style={S.infoLabel}>{label}</span>
                  <span style={S.infoValue}>{value}</span>
                </div>
              ))}

              {mode === "approve" ? (
                <>
                  <div style={S.sectionLabel}>Phone Override (optional)</div>
                  <div style={S.field}>
                    <input style={S.input} value={phoneOverride} onChange={(e) => setPhoneOverride(e.target.value)} placeholder="Leave blank to keep original" />
                  </div>

                  <div style={S.sectionLabel}>Family Assignment</div>
                  <div style={S.field}>
                    <label style={S.label}>Action</label>
                    <select style={S.select} value={familyAction} onChange={(e) => setFamilyAction(e.target.value as any)}>
                      <option value="none">No family (staff / standalone)</option>
                      <option value="create">Create new family</option>
                    </select>
                  </div>

                  {familyAction === "create" && (
                    <>
                      <div style={S.field}>
                        <label style={S.label}>Chanda Number (optional — auto-generated if blank)</label>
                        <input style={S.input} value={newChandaNo} onChange={(e) => setNewChandaNo(e.target.value)} placeholder="e.g. MM-0042" />
                      </div>
                      <div style={S.field}>
                        <label style={S.label}>Active From Month</label>
                        <input
                          style={S.input}
                          type="month"
                          value={activeFromMonth}
                          onChange={(e) => setActiveFromMonth(e.target.value)}
                        />
                        <div style={{ fontSize: "11px", color: COLORS.textMuted, marginTop: "4px" }}>
                          Pending chanda records will be created from this month onwards
                        </div>
                      </div>
                    </>
                  )}

                  <div style={S.sectionLabel}>Account Details</div>
                  <div style={S.field}>
                    <label style={S.label}>Role</label>
                    <select style={S.select} value={role} onChange={(e) => setRole(e.target.value)}>
                      <option value="member">Member</option>
                      <option value="head">Family Head</option>
                      <option value="collector">Collector</option>
                      <option value="imam">Imam</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div style={S.field}>
                    <label style={S.label}>Monthly Chanda Amount (₹)</label>
                    <input style={S.input} type="number" value={chandaAmount} onChange={(e) => setChandaAmount(e.target.value)} placeholder="Leave blank to inherit family default" />
                  </div>

                  <div style={S.field}>
                    <label style={S.label}>Admin Notes (optional)</label>
                    <textarea style={S.textarea} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Internal notes visible only to admins" />
                  </div>

                  <div style={S.actionRow}>
                    <button style={S.cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
                    <button
                      style={{ ...S.rejectBtn, flex: "none", padding: "12px 20px", opacity: busy ? 0.6 : 1 }}
                      onClick={() => setMode("reject")}
                      disabled={busy}
                    >
                      Reject
                    </button>
                    <button
                      style={{ ...S.approveBtn, opacity: busy ? 0.6 : 1 }}
                      onClick={handleApprove}
                      disabled={busy}
                    >
                      {busy ? "Approving…" : "Approve & Activate"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginTop: "16px" }}>
                    <label style={S.label}>Reason for Rejection</label>
                    <textarea
                      style={S.textarea}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Explain why this registration is being rejected…"
                    />
                  </div>
                  <div style={S.actionRow}>
                    <button style={S.cancelBtn} onClick={() => setMode("approve")} disabled={busy}>
                      ← Back
                    </button>
                    <button
                      style={{ ...S.rejectBtn, opacity: busy ? 0.6 : 1 }}
                      onClick={handleReject}
                      disabled={busy}
                    >
                      {busy ? "Rejecting…" : "Reject Registration"}
                    </button>
                  </div>
                </>
              )}

              {/* ── Reset Password ── */}
              <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: `1px solid ${COLORS.divider}` }}>
                <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: COLORS.textMuted, marginBottom: "10px" }}>
                  Reset Password
                </div>
                {resetMsg && (
                  <div style={{ ...S.successBanner, marginBottom: "10px" }}>✓ {resetMsg}</div>
                )}
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    style={{ ...S.input, flex: 1 }}
                    value={resetPwd}
                    onChange={(e) => setResetPwd(e.target.value)}
                    placeholder="Temporary password (min 8 chars)"
                  />
                  <button
                    style={{ padding: "9px 16px", borderRadius: "10px", border: `1px solid ${COLORS.danger}`, background: COLORS.dangerLight, color: COLORS.danger, fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" as const, opacity: resetBusy || resetPwd.length < 8 ? 0.5 : 1 }}
                    disabled={resetBusy || resetPwd.length < 8}
                    onClick={async () => {
                      setResetBusy(true);
                      setResetMsg(null);
                      try {
                        await resetUserPassword(userId, resetPwd);
                        setResetMsg("Password reset — user must change on next login");
                      } catch (e: any) {
                        setError(apiErr(e, "Password reset failed"));
                      } finally {
                        setResetBusy(false);
                      }
                    }}
                  >
                    {resetBusy ? "…" : "🔑 Reset"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PendingRegistrationsPage: React.FC = () => {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listPendingRegistrations());
    } catch {
      setError("Failed to load pending registrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDone = (msg: string) => {
    setReviewingId(null);
    setSuccess(msg || "Done");
    fetchData();
    setTimeout(() => setSuccess(null), 4000);
  };

  return (
    <div style={S.page}>
      <h1 style={S.title}>Pending Registrations</h1>
      <p style={S.subtitle}>
        {loading ? "Loading…" : `${users.length} registration${users.length !== 1 ? "s" : ""} awaiting review`}
      </p>

      {error && <div style={S.errorBanner}>⚠ {error}</div>}
      {success && <div style={S.successBanner}>✓ {success}</div>}

      {!loading && users.length === 0 ? (
        <div style={S.emptyBox}>
          <div style={S.emptyIcon}>✓</div>
          <div style={S.emptyMsg}>All caught up!</div>
          <div style={S.emptyHint}>No pending registrations at the moment.</div>
        </div>
      ) : (
        users.map((u) => (
          <div
            key={u.id}
            style={S.card}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = COLORS.shadow; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = COLORS.shadowSm; }}
          >
            <div style={S.avatar}>{initials(u.name)}</div>
            <div style={S.cardInfo}>
              <div style={S.cardName}>{u.name}</div>
              <div style={S.cardMeta}>
                {u.phone ?? "No phone"} · Registered {fmtDateTime(u.registered_at)}
              </div>
              <div style={{ marginTop: "6px" }}>
                <span style={S.pendingBadge}>Pending Approval</span>
              </div>
            </div>
            <button
              style={S.reviewBtn}
              onClick={() => setReviewingId(u.id)}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = COLORS.primaryLighter; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = COLORS.primaryLight; }}
            >
              Review →
            </button>
          </div>
        ))
      )}

      {reviewingId !== null && (
        <ApprovalModal
          userId={reviewingId}
          onClose={() => setReviewingId(null)}
          onDone={() => handleDone("Registration processed successfully")}
        />
      )}
    </div>
  );
};

export default PendingRegistrationsPage;
