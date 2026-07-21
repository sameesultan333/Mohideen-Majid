import React, { useEffect, useState, useCallback, useRef } from "react";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import {
  getDonations,
  createDonation,
  deleteDonation,
  downloadDonationReport,
  getDonationPurposes,
  searchMembers,
  type DonationFilters,
  type MemberSearchResult,
} from "../../api/donation";
import { getFunds } from "../../api/fund";
import type { Donation, DonationMethod, DonorType, CreateDonationPayload } from "../../types/donation";
import type { DonationPurpose } from "../../types/donation";
import type { Fund } from "../../types/fund";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const fmtMethod = (m: string) =>
  ({ cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque", other: "Other" }[m] ?? m);

const today = () => new Date().toISOString().split("T")[0];

// ─── Media Query Hook ──────────────────────────────────────────────────────

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = React.useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) setMatches(media.matches);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [matches, query]);
  return matches;
};

// ─── Cache Helpers ──────────────────────────────────────────────────────────

const CACHE_DONATIONS_KEY = "donations_cache";
const CACHE_FILTERS_KEY = "donations_filters_cache";

const getCache = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const setCache = <T,>(key: string, data: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore
  }
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { padding: "16px", maxWidth: "1400px", margin: "0 auto" },
  header: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", gap: "12px" },
  title: { fontFamily: TYPOGRAPHY.fontDisplay, fontSize: "32px", fontWeight: 400, letterSpacing: "0", color: COLORS.text, marginBottom: "4px" },
  subtitle: { fontSize: "15px", color: COLORS.textSecondary },
  btnPrimary: { height: "44px", padding: "0 24px", borderRadius: "12px", background: COLORS.primary, color: "#fff", fontWeight: 600, fontSize: "14px", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px", flexShrink: 0, boxShadow: COLORS.shadowPrimary, transition: "background 0.2s, transform 0.1s" },
  toolbar: { display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "20px", alignItems: "center" },
  searchInput: { flex: "1 1 200px", minWidth: "160px", height: "42px", padding: "0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.surface, fontSize: "14px", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s", color: COLORS.text },
  filterSelect: { height: "42px", padding: "0 32px 0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.surface, fontSize: "14px", outline: "none", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", minWidth: "140px", cursor: "pointer", color: COLORS.text },
  reportBar: { display: "flex", gap: "8px", marginLeft: "auto", alignItems: "center", flexWrap: "wrap" },
  reportLabel: { fontSize: "13px", color: COLORS.textSecondary, fontWeight: 500, whiteSpace: "nowrap" },
  btnOutline: { height: "38px", padding: "0 14px", borderRadius: "10px", border: `1px solid ${COLORS.border}`, background: COLORS.surface, fontSize: "13px", cursor: "pointer", color: COLORS.textSecondary, fontWeight: 500, transition: "background 0.2s, border-color 0.2s" },
  btnDanger: { height: "34px", padding: "0 12px", borderRadius: "8px", border: "none", background: COLORS.dangerLight, color: COLORS.danger, fontSize: "12px", cursor: "pointer", fontWeight: 600, transition: "background 0.2s" },
  tableCard: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "16px", boxShadow: COLORS.shadowSm, overflow: "hidden" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "14px" },
  th: { padding: "12px 14px", textAlign: "left", fontWeight: 600, color: COLORS.textSecondary, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", background: COLORS.backgroundAlt, borderBottom: `1px solid ${COLORS.border}`, whiteSpace: "nowrap" },
  td: { padding: "12px 14px", borderBottom: `1px solid ${COLORS.divider}`, color: COLORS.text, verticalAlign: "middle" },
  emptyCell: { padding: "60px 20px", textAlign: "center", color: COLORS.textMuted, fontSize: "15px" },
  pagination: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: `1px solid ${COLORS.border}`, fontSize: "13px", color: COLORS.textSecondary, flexWrap: "wrap", gap: "8px" },
  pageBtn: { height: "32px", padding: "0 12px", border: `1px solid ${COLORS.border}`, borderRadius: "8px", background: COLORS.surface, cursor: "pointer", fontSize: "13px", color: COLORS.text, transition: "background 0.2s" },
  badge: { display: "inline-block", padding: "2px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 },
  errorBanner: { background: COLORS.dangerLight, color: COLORS.danger, padding: "12px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.danger}`, animation: "fadeIn 0.3s ease" },
  offlineBanner: { background: COLORS.warningLight, color: COLORS.warning, padding: "8px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.warning}`, display: "flex", alignItems: "center", gap: "8px", animation: "fadeIn 0.3s ease" },

  // Mobile Cards
  cardList: { display: "flex", flexDirection: "column", gap: "12px" },
  card: { background: COLORS.surface, borderRadius: "16px", border: `1px solid ${COLORS.border}`, boxShadow: COLORS.shadowSm, overflow: "hidden", transition: "box-shadow 0.3s, transform 0.3s" },
  cardHeader: { padding: "16px", display: "flex", alignItems: "flex-start", gap: "12px", cursor: "default" },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: "16px", fontWeight: 600, color: COLORS.text, wordBreak: "break-word" },
  cardMeta: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginTop: "4px" },
  cardBody: { padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: "10px" },
  cardRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${COLORS.divider}`, fontSize: "13px" },
  cardRowLabel: { color: COLORS.textSecondary },
  cardRowValue: { fontWeight: 500, color: COLORS.text, textAlign: "right" as const },
  cardActions: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "6px" },

  // Modals – no emojis
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", animation: "fadeIn 0.25s ease" },
  modal: { background: COLORS.surface, borderRadius: "20px", width: "100%", maxWidth: "560px", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.18)" },
  modalHeader: { padding: "20px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontSize: "20px", fontWeight: 700, color: COLORS.text },
  modalClose: { width: "32px", height: "32px", borderRadius: "8px", border: "none", background: COLORS.backgroundAlt, cursor: "pointer", fontSize: "18px", color: COLORS.textSecondary, display: "flex", alignItems: "center", justifyContent: "center" },
  modalBody: { padding: "20px 24px 24px" },
  formGroup: { marginBottom: "16px" },
  label: { display: "block", fontSize: "13px", fontWeight: 600, color: COLORS.text, marginBottom: "6px" },
  required: { color: COLORS.danger, marginLeft: "2px" },
  input: { width: "100%", height: "42px", padding: "0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.backgroundAlt, fontSize: "14px", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s", color: COLORS.text, boxSizing: "border-box" },
  select: { width: "100%", height: "42px", padding: "0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.backgroundAlt, fontSize: "14px", outline: "none", color: COLORS.text, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", cursor: "pointer", boxSizing: "border-box" },
  textarea: { width: "100%", padding: "10px 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.backgroundAlt, fontSize: "14px", outline: "none", color: COLORS.text, resize: "vertical", minHeight: "80px", boxSizing: "border-box", fontFamily: "inherit" },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" },
  donorTypeBtns: { display: "flex", gap: "8px" },
  donorTypeBtn: { flex: 1, height: "40px", borderRadius: "10px", border: `1px solid ${COLORS.border}`, background: COLORS.backgroundAlt, cursor: "pointer", fontSize: "13px", fontWeight: 500, color: COLORS.textSecondary, transition: "all 0.15s" },
  donorTypeBtnActive: { background: COLORS.primary, color: "#fff", border: `1px solid ${COLORS.primary}` },
  memberResult: { border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.backgroundAlt, marginTop: "6px", overflow: "hidden", maxHeight: "200px", overflowY: "auto" },
  memberItem: { padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${COLORS.divider}`, transition: "background 0.15s" },
  selectedMember: { background: COLORS.primaryLight, border: `1px solid ${COLORS.primary}`, borderRadius: "12px", padding: "10px 14px", marginTop: "6px", fontSize: "13px", color: COLORS.primary, display: "flex", justifyContent: "space-between", alignItems: "center" },
  submitRow: { display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "20px", paddingTop: "16px", borderTop: `1px solid ${COLORS.divider}` },
  receiptSuccess: { textAlign: "center", padding: "16px 0 24px" },
  receiptCheck: { width: "56px", height: "56px", borderRadius: "50%", background: COLORS.successLight, color: COLORS.success, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontSize: "28px", fontWeight: 700 },
  receiptAmount: { fontSize: "22px", fontWeight: 700, color: COLORS.success, marginBottom: "4px" },

  // Skeleton
  skeleton: { background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", borderRadius: "12px" },
  skeletonRow: { display: "flex", gap: "12px", padding: "12px 16px", borderBottom: `1px solid ${COLORS.divider}` },
  skeletonCell: { flex: 1, height: "20px" },
};

// ─── Inject keyframes ──────────────────────────────────────────────────────

const keyframes = document.createElement("style");
keyframes.innerHTML = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
document.head.appendChild(keyframes);

// ─── Receipt Modal ─────────────────────────────────────────────────────────

const ReceiptModal: React.FC<{ donation: Donation; onClose: () => void }> = ({ donation, onClose }) => (
  <div style={S.overlay} onClick={onClose}>
    <div style={{ ...S.modal, maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
      <div style={S.modalHeader}>
        <div style={S.modalTitle}>Donation Receipt</div>
        <button style={S.modalClose} onClick={onClose}>✕</button>
      </div>
      <div style={S.modalBody}>
        <div style={S.receiptSuccess}>
          <div style={S.receiptCheck}>✓</div>
          <div style={S.receiptAmount}>{fmt(donation.amount)}</div>
          <div style={{ fontSize: "14px", color: COLORS.textSecondary }}>Donation recorded successfully</div>
        </div>
        {[
          ["Receipt ID", donation.receipt_id],
          ["Donor", donation.donor_name],
          ["Fund", donation.fund_name ?? "General Mosque"],
          ["Purpose", donation.purpose_name ?? "—"],
          ["Method", fmtMethod(donation.method)],
          ["Recorded by", donation.recorded_by],
          ["Date", fmtDate(donation.donation_date ?? donation.created_at)],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COLORS.divider}`, fontSize: "14px" }}>
            <span style={{ color: COLORS.textSecondary }}>{k}</span>
            <span style={{ fontWeight: 500, color: COLORS.text }}>{v}</span>
          </div>
        ))}
        <button
          style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", marginTop: "20px" }}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  </div>
);

// ─── New Donation Modal ───────────────────────────────────────────────────────

interface DonationModalProps {
  funds: Fund[];
  purposes: DonationPurpose[];
  onClose: () => void;
  onSuccess: (d: Donation) => void;
}

const DonationModal: React.FC<DonationModalProps> = ({ funds, purposes, onClose, onSuccess }) => {
  const [donorType, setDonorType] = useState<DonorType>("walk_in");
  const [fundId, setFundId] = useState<number | "">("");
  const [purposeId, setPurposeId] = useState<number | "">("");
  const [method, setMethod] = useState<DonationMethod>("cash");
  const [amount, setAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [donationDate, setDonationDate] = useState(today());

  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<MemberSearchResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);
  const [memberSearching, setMemberSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (donorType !== "member") return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!memberSearch.trim() || selectedMember) {
      setMemberResults([]);
      return;
    }
    setMemberSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchMembers(memberSearch);
        setMemberResults(res);
      } catch {
        setMemberResults([]);
      } finally {
        setMemberSearching(false);
      }
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [memberSearch, donorType, selectedMember]);

  const selectMember = (m: MemberSearchResult) => {
    setSelectedMember(m);
    setDonorName(m.name);
    setPhone(m.phone);
    setMemberSearch("");
    setMemberResults([]);
  };

  const clearMember = () => {
    setSelectedMember(null);
    setDonorName("");
    setPhone("");
    setMemberSearch("");
  };

  const handleSubmit = async () => {
    setError(null);
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setError("Enter a valid amount greater than 0"); return; }
    if (donorType === "walk_in" && !donorName.trim()) { setError("Donor name is required for walk-in"); return; }
    if (donorType === "member" && !selectedMember) { setError("Please search and select a member"); return; }

    const payload: CreateDonationPayload = {
      amount: amt,
      method,
      donor_type: donorType,
      fund_id: fundId !== "" ? Number(fundId) : undefined,
      purpose_id: purposeId !== "" ? Number(purposeId) : undefined,
      donation_date: donationDate || undefined,
      note: note.trim() || undefined,
    };

    if (donorType === "member" && selectedMember) {
      payload.donor_name = selectedMember.name;
      payload.head_id = selectedMember.id;
      payload.phone = selectedMember.phone;
      payload.chanda_no = selectedMember.chanda_no;
    } else if (donorType === "walk_in") {
      payload.donor_name = donorName.trim();
      payload.phone = phone.trim() || undefined;
    } else {
      payload.donor_name = "Anonymous";
    }

    setSubmitting(true);
    try {
      const result = await createDonation(payload);
      onSuccess(result);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err.message ?? "Failed to record donation");
    } finally {
      setSubmitting(false);
    }
  };

  const activeFunds = funds.filter((f) => !f.is_archived && f.status !== "archived");
  const activePurposes = purposes.filter((p) => p.is_active && !p.is_archived);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>New Donation</div>
          <button style={S.modalClose} onClick={onClose}>✕</button>
        </div>
        <div style={S.modalBody}>
          {error && <div style={{ ...S.errorBanner, marginBottom: "16px" }}>⚠ {error}</div>}

          <div style={S.formGroup}>
            <label style={S.label}>Fund</label>
            <select style={S.select} value={fundId} onChange={(e) => setFundId(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">General Mosque (No Fund)</option>
              {activeFunds.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          <div style={S.formGroup}>
            <label style={S.label}>Donor Type<span style={S.required}>*</span></label>
            <div style={S.donorTypeBtns}>
              {(["member", "walk_in", "anonymous"] as DonorType[]).map((t) => (
                <button
                  key={t}
                  style={{ ...S.donorTypeBtn, ...(donorType === t ? S.donorTypeBtnActive : {}) }}
                  onClick={() => { setDonorType(t); clearMember(); setDonorName(""); setPhone(""); }}
                >
                  {t === "walk_in" ? "Walk-in" : t === "member" ? "Member" : "Anonymous"}
                </button>
              ))}
            </div>
          </div>

          {donorType === "member" && (
            <div style={S.formGroup}>
              <label style={S.label}>Search Member<span style={S.required}>*</span></label>
              {selectedMember ? (
                <div style={S.selectedMember}>
                  <span>
                    <strong>{selectedMember.name}</strong> &nbsp;·&nbsp; {selectedMember.phone} &nbsp;·&nbsp; {selectedMember.chanda_no}
                  </span>
                  <button
                    style={{ border: "none", background: "none", color: COLORS.danger, cursor: "pointer", fontWeight: 600, fontSize: "13px" }}
                    onClick={clearMember}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    style={S.input}
                    placeholder="Search by name, phone or chanda number…"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                  />
                  {memberSearching && (
                    <div style={{ fontSize: "12px", color: COLORS.textMuted, marginTop: "4px" }}>Searching…</div>
                  )}
                  {memberResults.length > 0 && (
                    <div style={S.memberResult}>
                      {memberResults.map((m) => (
                        <div
                          key={m.id}
                          style={S.memberItem}
                          onClick={() => selectMember(m)}
                          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <div style={{ fontWeight: 600, fontSize: "14px", color: COLORS.text }}>{m.name}</div>
                          <div style={{ fontSize: "12px", color: COLORS.textSecondary }}>
                            {m.phone} &nbsp;·&nbsp; Chanda: {m.chanda_no}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!memberSearching && memberSearch.trim() && memberResults.length === 0 && (
                    <div style={{ fontSize: "12px", color: COLORS.textMuted, marginTop: "4px" }}>No members found</div>
                  )}
                </>
              )}
            </div>
          )}

          {donorType === "walk_in" && (
            <div style={S.row2}>
              <div style={S.formGroup}>
                <label style={S.label}>Donor Name<span style={S.required}>*</span></label>
                <input style={S.input} placeholder="Full name" value={donorName} onChange={(e) => setDonorName(e.target.value)} />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Phone</label>
                <input style={S.input} placeholder="+91 …" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
          )}

          <div style={S.row2}>
            <div style={S.formGroup}>
              <label style={S.label}>Amount (₹)<span style={S.required}>*</span></label>
              <input style={S.input} type="number" min="1" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Payment Method<span style={S.required}>*</span></label>
              <select style={S.select} value={method} onChange={(e) => setMethod(e.target.value as DonationMethod)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div style={S.row2}>
            <div style={S.formGroup}>
              <label style={S.label}>Purpose</label>
              <select style={S.select} value={purposeId} onChange={(e) => setPurposeId(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">General Donation</option>
                {activePurposes.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Date</label>
              <input style={S.input} type="date" value={donationDate} onChange={(e) => setDonationDate(e.target.value)} />
            </div>
          </div>

          <div style={S.formGroup}>
            <label style={S.label}>Notes</label>
            <textarea style={S.textarea} placeholder="Optional notes…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div style={S.submitRow}>
            <button style={S.btnOutline} onClick={onClose}>Cancel</button>
            <button
              style={{ ...S.btnPrimary, opacity: submitting ? 0.7 : 1 }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Recording…" : "Record Donation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const DonationsPage: React.FC = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [donations, setDonations] = useState<Donation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [search, setSearch] = useState("");
  const [fundFilter, setFundFilter] = useState<number | "">("");
  const [methodFilter, setMethodFilter] = useState("");

  const [funds, setFunds] = useState<Fund[]>([]);
  const [purposes, setPurposes] = useState<DonationPurpose[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [receipt, setReceipt] = useState<Donation | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const PAGE_SIZE = 15;

  // Load supporting data once
  useEffect(() => {
    Promise.all([
      getFunds({ include_archived: false }),
      getDonationPurposes(),
    ]).then(([f, p]) => {
      setFunds(f);
      setPurposes(p);
    }).catch(() => {});
  }, []);

  const loadDonations = useCallback(async (p = 1, s = search, doCache = true) => {
    setLoading(true);
    setError(null);
    setFromCache(false);
    try {
      const params: DonationFilters = { page: p, page_size: PAGE_SIZE };
      if (s.trim()) params.search = s.trim();
      if (fundFilter !== "") params.fund_id = Number(fundFilter);
      if (methodFilter) params.method = methodFilter;
      const res = await getDonations(params);
      setDonations(res.items);
      setTotal(res.total);
      setTotalPages(res.total_pages);
      setPage(res.page);
      if (doCache) {
        setCache(CACHE_DONATIONS_KEY, res);
        setCache(CACHE_FILTERS_KEY, { search: s, fundFilter, methodFilter, page: p });
      }
    } catch (err: any) {
      const cached = getCache<{ items: Donation[]; total: number; total_pages: number; page: number }>(CACHE_DONATIONS_KEY);
      if (cached) {
        setDonations(cached.items);
        setTotal(cached.total);
        setTotalPages(cached.total_pages);
        setPage(cached.page);
        setFromCache(true);
        setError(null);
      } else {
        setError(err?.response?.data?.detail ?? err.message ?? "Failed to load donations");
      }
    } finally {
      setLoading(false);
    }
  }, [search, fundFilter, methodFilter]);

  useEffect(() => { loadDonations(1, search); }, [fundFilter, methodFilter]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => loadDonations(1, search), 400);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this donation? This action cannot be undone.")) return;
    try {
      await deleteDonation(id);
      loadDonations(page, search, false);
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? err.message ?? "Failed to delete");
    }
  };

  const handleReport = async (format: "pdf" | "excel") => {
    setReportLoading(true);
    try {
      const params: any = { format };
      if (fundFilter !== "") params.fund_id = Number(fundFilter);
      if (methodFilter) params.method = methodFilter;
      const blob = await downloadDonationReport({ format, ...params });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `donations_report.${format === "excel" ? "xlsx" : "pdf"}`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? "Failed to download report");
    } finally {
      setReportLoading(false);
    }
  };

  const methodBadgeStyle = (m: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; color: string }> = {
      cash: { bg: COLORS.iconGreen, color: COLORS.primary },
      upi: { bg: COLORS.primaryLight, color: COLORS.primary },
      bank: { bg: COLORS.lapisLight, color: COLORS.lapis },
      cheque: { bg: COLORS.iconGold, color: COLORS.accent },
      other: { bg: COLORS.backgroundAlt, color: COLORS.textMuted },
    };
    const c = colors[m] ?? colors.other;
    return { ...S.badge, background: c.bg, color: c.color };
  };

  // ─── Render desktop table ──────────────────────────────────────────────────

  const renderDesktopTable = () => (
    <div style={S.tableCard}>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Receipt</th>
              <th style={S.th}>Donor</th>
              <th style={S.th}>Fund</th>
              <th style={S.th}>Purpose</th>
              <th style={S.th}>Method</th>
              <th style={S.th}>Amount</th>
              <th style={S.th}>Recorded By</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={9} style={S.td}>
                    <div style={S.skeletonRow}>
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1.5 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 0.8 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 0.8 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 0.8 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                    </div>
                  </td>
                </tr>
              ))
            ) : donations.length === 0 ? (
              <tr><td colSpan={9} style={S.emptyCell}>No donations found</td></tr>
            ) : donations.map((d) => (
              <tr key={d.id}>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: "12px", color: COLORS.textSecondary }}>{d.receipt_id}</td>
                <td style={S.td}>
                  <div style={{ fontWeight: 500 }}>{d.donor_name}</div>
                  {d.phone && <div style={{ fontSize: "12px", color: COLORS.textMuted }}>{d.phone}</div>}
                </td>
                <td style={{ ...S.td, color: COLORS.textSecondary }}>
                  {d.fund_name ?? <span style={{ color: COLORS.textMuted, fontStyle: "italic" }}>General Mosque</span>}
                </td>
                <td style={{ ...S.td, color: COLORS.textSecondary }}>{d.purpose_name ?? "—"}</td>
                <td style={S.td}><span style={methodBadgeStyle(d.method)}>{fmtMethod(d.method)}</span></td>
                <td style={{ ...S.td, fontWeight: 600, color: COLORS.success }}>{fmt(d.amount)}</td>
                <td style={{ ...S.td, color: COLORS.textSecondary, fontSize: "13px" }}>{d.recorded_by}</td>
                <td style={{ ...S.td, color: COLORS.textSecondary, whiteSpace: "nowrap" }}>
                  {fmtDate(d.donation_date ?? d.created_at)}
                </td>
                <td style={S.td}>
                  <button style={S.btnDanger} onClick={() => handleDelete(d.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={S.pagination}>
          <span>{total} donations · Page {page} of {totalPages}</span>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              style={{ ...S.pageBtn, opacity: page <= 1 ? 0.4 : 1 }}
              disabled={page <= 1}
              onClick={() => loadDonations(page - 1, search)}
            >
              ‹ Prev
            </button>
            <button
              style={{ ...S.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }}
              disabled={page >= totalPages}
              onClick={() => loadDonations(page + 1, search)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ─── Render mobile cards ──────────────────────────────────────────────────

  const renderMobileCards = () => {
    if (loading) {
      return Array.from({ length: 3 }).map((_, i) => (
        <div key={i} style={S.card}>
          <div style={S.cardHeader}>
            <div style={{ ...S.skeleton, width: "60%", height: "20px" }} />
          </div>
          <div style={S.cardBody}>
            <div style={{ ...S.skeleton, height: "16px", width: "80%" }} />
            <div style={{ ...S.skeleton, height: "16px", width: "60%" }} />
          </div>
        </div>
      ));
    }

    if (donations.length === 0) {
      return <div style={S.emptyCell}>No donations found</div>;
    }

    return (
      <div style={S.cardList}>
        {donations.map((d) => (
          <div key={d.id} style={S.card}>
            <div style={S.cardHeader}>
              <div style={S.cardInfo}>
                <div style={S.cardTitle}>{d.donor_name}</div>
                <div style={S.cardMeta}>
                  <span style={{ fontFamily: "monospace", fontSize: "12px", color: COLORS.textSecondary }}>{d.receipt_id}</span>
                  <span style={methodBadgeStyle(d.method)}>{fmtMethod(d.method)}</span>
                </div>
              </div>
            </div>
            <div style={S.cardBody}>
              <div style={S.cardRow}>
                <span style={S.cardRowLabel}>Amount</span>
                <span style={{ ...S.cardRowValue, color: COLORS.success }}>{fmt(d.amount)}</span>
              </div>
              <div style={S.cardRow}>
                <span style={S.cardRowLabel}>Fund</span>
                <span style={S.cardRowValue}>{d.fund_name ?? "General Mosque"}</span>
              </div>
              <div style={S.cardRow}>
                <span style={S.cardRowLabel}>Purpose</span>
                <span style={S.cardRowValue}>{d.purpose_name ?? "—"}</span>
              </div>
              {d.phone && (
                <div style={S.cardRow}>
                  <span style={S.cardRowLabel}>Phone</span>
                  <span style={S.cardRowValue}>{d.phone}</span>
                </div>
              )}
              <div style={S.cardRow}>
                <span style={S.cardRowLabel}>Collected By</span>
                <span style={S.cardRowValue}>{d.recorded_by}</span>
              </div>
              <div style={S.cardRow}>
                <span style={S.cardRowLabel}>Date</span>
                <span style={S.cardRowValue}>{fmtDate(d.donation_date ?? d.created_at)}</span>
              </div>
              <div style={S.cardActions}>
                <button style={S.btnDanger} onClick={() => handleDelete(d.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ─── Main render ───────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Donations</h1>
          <p style={S.subtitle}>Record and manage all donations to the masjid.</p>
        </div>
        <button
          style={S.btnPrimary}
          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.primary)}
          onClick={() => setShowModal(true)}
        >
          <span>+</span> New Donation
        </button>
      </div>

      {fromCache && (
        <div style={S.offlineBanner}>
          <span>●</span> Viewing cached data
        </div>
      )}
      {error && <div style={S.errorBanner}>⚠ {error}</div>}

      <div style={S.toolbar}>
        <input
          style={S.searchInput}
          placeholder="Search by donor, receipt ID, phone, chanda no…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`)}
          onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
        />
        <select style={S.filterSelect} value={fundFilter} onChange={(e) => setFundFilter(e.target.value === "" ? "" : Number(e.target.value))}>
          <option value="">All Funds</option>
          <option value="0">General Mosque</option>
          {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select style={S.filterSelect} value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
          <option value="">All Methods</option>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="bank">Bank</option>
          <option value="cheque">Cheque</option>
          <option value="other">Other</option>
        </select>
        <button
          style={S.btnOutline}
          onClick={() => loadDonations(page, search)}
          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
          onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.surface)}
        >
          ⟳
        </button>

        <div style={S.reportBar}>
          <span style={S.reportLabel}>Export:</span>
          {(["pdf", "excel"] as const).map((fmt) => (
            <button
              key={fmt}
              style={S.btnOutline}
              disabled={reportLoading}
              onClick={() => handleReport(fmt)}
              onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
              onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.surface)}
            >
              {fmt === "excel" ? "Excel" : "PDF"}
            </button>
          ))}
        </div>
      </div>

      {isMobile ? renderMobileCards() : renderDesktopTable()}

      {showModal && (
        <DonationModal
          funds={funds}
          purposes={purposes}
          onClose={() => setShowModal(false)}
          onSuccess={(d) => {
            setShowModal(false);
            setReceipt(d);
            loadDonations(1, search);
          }}
        />
      )}

      {receipt && <ReceiptModal donation={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
};

export default DonationsPage;