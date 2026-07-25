import React, { useEffect, useState, useCallback } from "react";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import {
  getExpenses,
  getExpenseCategories,
  createExpense,
  approveExpense,
  deleteExpense,
  downloadExpenseReport,
  type ExpenseCategory,
  type Expense,
  type ExpenseFilters,
  type CreateExpensePayload,
} from "../../api/expenses";
import { getFunds } from "../../api/fund";
import type { Fund } from "../../types/fund";
import api from "../../api/axios";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const today = () => new Date().toISOString().split("T")[0];

// Web-compatible image upload
const uploadImageWeb = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post("/upload/image", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.url;
};

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

const CACHE_EXPENSES_KEY = "expenses_cache";
const CACHE_FILTERS_KEY = "expenses_filters_cache";

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

  header: { display: "flex", flexDirection: "column", gap: "14px", marginBottom: "20px" },
  headerRow: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "12px" },
  title: { fontFamily: TYPOGRAPHY.fontDisplay, fontSize: "32px", fontWeight: 400, letterSpacing: "0", color: COLORS.text, marginBottom: "2px" },
  subtitle: { fontSize: "13.5px", color: COLORS.textSecondary },
  btnPrimary: { height: "42px", padding: "0 20px", borderRadius: "11px", background: COLORS.primary, color: "#fff", fontWeight: 600, fontSize: "14px", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", flexShrink: 0, boxShadow: COLORS.shadowPrimary, transition: "background 0.2s, transform 0.1s" },

  // Toolbar — mobile-first: stacked sections instead of one wrapping row
  toolbar: { display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" },
  searchRow: { display: "flex", gap: "8px" },
  searchInput: { flex: 1, minWidth: 0, height: "40px", padding: "0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "10px", background: COLORS.surface, fontSize: "14px", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s", color: COLORS.text, boxSizing: "border-box" },
  refreshBtn: { width: "40px", height: "40px", borderRadius: "10px", border: `1px solid ${COLORS.border}`, background: COLORS.surface, cursor: "pointer", fontSize: "15px", color: COLORS.textSecondary, flexShrink: 0, transition: "background 0.2s" },
  filterGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" },
  filterSelect: { height: "40px", padding: "0 30px 0 12px", border: `1px solid ${COLORS.border}`, borderRadius: "10px", background: COLORS.surface, fontSize: "13px", outline: "none", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", cursor: "pointer", color: COLORS.text, width: "100%", boxSizing: "border-box" },
  exportRow: { display: "flex", alignItems: "center", gap: "8px" },
  exportLabel: { fontSize: "12.5px", color: COLORS.textMuted, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 },
  exportGroup: { display: "flex", flex: 1, border: `1px solid ${COLORS.border}`, borderRadius: "10px", overflow: "hidden" },
  exportBtn: { flex: 1, height: "36px", border: "none", borderLeft: `1px solid ${COLORS.border}`, background: COLORS.surface, fontSize: "12px", fontWeight: 600, cursor: "pointer", color: COLORS.textSecondary, transition: "background 0.2s" },

  tableCard: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "16px", boxShadow: COLORS.shadowSm, overflow: "hidden" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "14px" },
  th: { padding: "12px 14px", textAlign: "left", fontWeight: 600, color: COLORS.textSecondary, fontSize: "11.5px", textTransform: "uppercase", letterSpacing: "0.04em", background: COLORS.backgroundAlt, borderBottom: `1px solid ${COLORS.border}`, whiteSpace: "nowrap" },
  td: { padding: "12px 14px", borderBottom: `1px solid ${COLORS.divider}`, color: COLORS.text, verticalAlign: "middle", wordBreak: "break-word" },
  emptyCell: { padding: "56px 20px", textAlign: "center", color: COLORS.textMuted, fontSize: "14px" },
  pagination: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: `1px solid ${COLORS.border}`, fontSize: "13px", color: COLORS.textSecondary, flexWrap: "wrap", gap: "8px" },
  pageBtn: { height: "32px", padding: "0 12px", border: `1px solid ${COLORS.border}`, borderRadius: "8px", background: COLORS.surface, cursor: "pointer", fontSize: "13px", color: COLORS.text, transition: "background 0.2s" },
  badge: { display: "inline-block", padding: "2px 9px", borderRadius: "999px", fontSize: "11px", fontWeight: 700 },
  errorBanner: { background: COLORS.dangerLight, color: COLORS.danger, padding: "11px 14px", borderRadius: "11px", marginBottom: "14px", fontSize: "13.5px", fontWeight: 500, animation: "fadeIn 0.3s ease" },
  offlineBanner: { background: COLORS.warningLight, color: COLORS.warning, padding: "8px 14px", borderRadius: "11px", marginBottom: "14px", fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", gap: "8px", animation: "fadeIn 0.3s ease" },

  // Mobile Cards
  cardList: { display: "flex", flexDirection: "column", gap: "10px" },
  card: { background: COLORS.surface, borderRadius: "14px", border: `1px solid ${COLORS.border}`, boxShadow: COLORS.shadowSm, overflow: "hidden" },
  cardHeader: { padding: "14px 14px 0", display: "flex", alignItems: "flex-start", gap: "12px" },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: "14.5px", fontWeight: 600, color: COLORS.text, wordBreak: "break-word", lineHeight: 1.35 },
  cardMeta: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginTop: "5px" },
  cardBody: { padding: "10px 14px 14px", display: "flex", flexDirection: "column", gap: "8px" },
  cardRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${COLORS.divider}`, fontSize: "12.5px" },
  cardRowLabel: { color: COLORS.textMuted, fontWeight: 500 },
  cardRowValue: { fontWeight: 600, color: COLORS.text, textAlign: "right" as const, wordBreak: "break-word" },
  cardActions: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" },

  // Modal
  overlay: { position: "fixed", inset: 0, background: "rgba(15,17,21,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", animation: "fadeIn 0.2s ease" },
  modal: { background: COLORS.surface, borderRadius: "18px", width: "100%", maxWidth: "540px", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.22)", animation: "slideUp 0.25s ease" },
  modalHeader: { flexShrink: 0, padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${COLORS.divider}` },
  modalTitle: { fontSize: "17px", fontWeight: 700, color: COLORS.text, letterSpacing: "-0.01em" },
  modalClose: { width: "30px", height: "30px", borderRadius: "8px", border: "none", background: COLORS.backgroundAlt, cursor: "pointer", fontSize: "15px", color: COLORS.textSecondary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  modalBody: { padding: "18px 20px", overflowY: "auto", flex: 1, minHeight: 0 },
  formGroup: { marginBottom: "12px" },
  label: { position: "static", top: "auto", left: "auto", transform: "none", zIndex: "auto", display: "block", fontSize: "12px", fontWeight: 600, color: COLORS.textSecondary, marginBottom: "6px", textTransform: "uppercase" as const, letterSpacing: "0.04em" },
  required: { color: COLORS.danger, marginLeft: "2px" },
  input: { width: "100%", height: "40px", padding: "0 12px", border: `1px solid ${COLORS.border}`, borderRadius: "9px", background: COLORS.backgroundAlt, fontSize: "14px", outline: "none", transition: "border-color 0.15s ease, box-shadow 0.15s ease", color: COLORS.text, boxSizing: "border-box" },
  inputWithPrefix: { width: "100%", height: "40px", padding: "0 12px 0 28px", border: `1px solid ${COLORS.border}`, borderRadius: "9px", background: COLORS.backgroundAlt, fontSize: "14px", outline: "none", transition: "border-color 0.15s ease, box-shadow 0.15s ease", color: COLORS.text, boxSizing: "border-box" },
  prefixWrap: { position: "relative" as const },
  prefixSymbol: { position: "absolute" as const, left: "12px", top: "50%", transform: "translateY(-50%)", fontSize: "14px", color: COLORS.textMuted, fontWeight: 600, pointerEvents: "none" as const },
  select: { width: "100%", height: "40px", padding: "0 12px", border: `1px solid ${COLORS.border}`, borderRadius: "9px", background: COLORS.backgroundAlt, fontSize: "13.5px", outline: "none", color: COLORS.text, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", cursor: "pointer", boxSizing: "border-box" },
  textarea: { width: "100%", padding: "10px 12px", border: `1px solid ${COLORS.border}`, borderRadius: "9px", background: COLORS.backgroundAlt, fontSize: "14px", outline: "none", color: COLORS.text, resize: "vertical", minHeight: "64px", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.5 },
  row2: { display: "grid", gap: "10px" },
  submitRow: { flexShrink: 0, display: "flex", gap: "8px", justifyContent: "flex-end", padding: "14px 20px", borderTop: `1px solid ${COLORS.divider}`, background: COLORS.surface },
  uploadArea: { position: "static", top: "auto", left: "auto", transform: "none", zIndex: "auto", display: "block", marginTop: "0", border: `1.5px dashed ${COLORS.border}`, borderRadius: "9px", padding: "16px", textAlign: "center", cursor: "pointer", color: COLORS.textMuted, fontSize: "12.5px", fontWeight: 500, background: COLORS.backgroundAlt, transition: "border-color 0.15s ease" },
  uploadPreview: { width: "100%", maxHeight: "110px", objectFit: "cover", borderRadius: "8px", marginTop: "8px" },
  btnOutlineModal: { height: "38px", padding: "0 18px", borderRadius: "9px", border: `1px solid ${COLORS.border}`, background: "transparent", fontSize: "13.5px", fontWeight: 500, color: COLORS.textSecondary, cursor: "pointer", transition: "background 0.15s ease" },
  btnPrimaryModal: { height: "38px", padding: "0 18px", borderRadius: "9px", background: COLORS.primary, color: "#fff", fontWeight: 600, fontSize: "13.5px", border: "none", cursor: "pointer", transition: "background 0.15s ease", boxShadow: COLORS.shadowPrimary },

  btnSuccess: { height: "32px", padding: "0 11px", borderRadius: "8px", border: "none", background: COLORS.iconGreen, color: COLORS.primary, fontSize: "11.5px", cursor: "pointer", fontWeight: 700, transition: "background 0.2s" },
  btnDanger: { height: "32px", padding: "0 11px", borderRadius: "8px", border: "none", background: COLORS.dangerLight, color: COLORS.danger, fontSize: "11.5px", cursor: "pointer", fontWeight: 700, transition: "background 0.2s" },

  // Skeleton
  skeleton: { background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", borderRadius: "8px" },
  skeletonRow: { display: "flex", gap: "12px", padding: "12px 16px", borderBottom: `1px solid ${COLORS.divider}` },
  skeletonCell: { flex: 1, height: "18px" },
};

// ─── Inject keyframes (once) ───────────────────────────────────────────────

let keyframesInjected = false;
const injectKeyframes = () => {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const el = document.createElement("style");
  el.innerHTML = `
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  `;
  document.head.appendChild(el);
};

// ─── Expense Form Modal ───────────────────────────────────────────────────────

interface ExpenseModalProps {
  funds: Fund[];
  categories: ExpenseCategory[];
  onClose: () => void;
  onSuccess: (e: Expense) => void;
}

const ExpenseModal: React.FC<ExpenseModalProps> = ({ funds, categories, onClose, onSuccess }) => {
  const isMobile = useMediaQuery("(max-width: 600px)");

  const [fundId, setFundId] = useState<number | "">("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today());
  const [note, setNote] = useState("");
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeFunds = funds.filter((f) => !f.is_archived && f.status !== "archived");
  const activeCategories = categories.filter((c) => c.is_active);

  const row2Style = { ...S.row2, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" };
  const modalStyle = { ...S.modal, maxHeight: isMobile ? "92vh" : "88vh" };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const url = await uploadImageWeb(file);
      setReceiptImage(url);
    } catch {
      setError("Failed to upload receipt image");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    const amt = parseFloat(amount);
    if (!title.trim()) { setError("Title is required"); return; }
    if (!amount || isNaN(amt) || amt <= 0) { setError("Enter a valid amount greater than 0"); return; }

    const payload: CreateExpensePayload = {
      title: title.trim(),
      amount: amt,
      category_id: categoryId !== "" ? Number(categoryId) : undefined,
      fund_id: fundId !== "" ? Number(fundId) : undefined,
      vendor_name: vendor.trim() || undefined,
      expense_date: expenseDate || undefined,
      note: note.trim() || undefined,
      receipt_image: receiptImage ?? undefined,
    };

    setSubmitting(true);
    try {
      const result = await createExpense(payload);
      onSuccess(result);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err.message ?? "Failed to create expense");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>New Expense</div>
          <button style={S.modalClose} onClick={onClose}>✕</button>
        </div>

        <div style={S.modalBody}>
          {error && <div style={S.errorBanner}>⚠ {error}</div>}

          <div style={S.formGroup}>
            <div style={S.label}>Title <span style={S.required}>*</span></div>
            <input style={S.input} placeholder="Brief description of expense" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div style={row2Style}>
            <div style={S.formGroup}>
              <div style={S.label}>Amount <span style={S.required}>*</span></div>
              <div style={S.prefixWrap}>
                <span style={S.prefixSymbol}>₹</span>
                <input style={S.inputWithPrefix} type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            <div style={S.formGroup}>
              <div style={S.label}>Date</div>
              <input style={S.input} type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>

          <div style={row2Style}>
            <div style={S.formGroup}>
              <div style={S.label}>Fund</div>
              <select style={S.select} value={fundId} onChange={(e) => setFundId(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">General Mosque</option>
                {activeFunds.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div style={S.formGroup}>
              <div style={S.label}>Category</div>
              <select style={S.select} value={categoryId} onChange={(e) => setCategoryId(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Select category</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={S.formGroup}>
            <div style={S.label}>Vendor / Supplier</div>
            <input style={S.input} placeholder="Vendor name" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>

          <div style={S.formGroup}>
            <div style={S.label}>Receipt Image</div>
            {receiptImage ? (
              <div>
                <img src={receiptImage} alt="Receipt" style={S.uploadPreview} />
                <button
                  style={{ ...S.btnDanger, marginTop: "6px" }}
                  onClick={() => setReceiptImage(null)}
                >
                  Remove
                </button>
              </div>
            ) : (
              <label style={{ ...S.uploadArea, opacity: uploadingImage ? 0.6 : 1 }}>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageChange} disabled={uploadingImage} />
                {uploadingImage ? "Uploading…" : "Tap to upload receipt image"}
              </label>
            )}
          </div>

          <div style={{ ...S.formGroup, marginBottom: 0 }}>
            <div style={S.label}>Notes</div>
            <textarea style={S.textarea} placeholder="Optional notes…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div style={S.submitRow}>
          <button style={S.btnOutlineModal} onClick={onClose}>Cancel</button>
          <button
            style={{ ...S.btnPrimaryModal, opacity: submitting ? 0.7 : 1 }}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Record Expense"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const ExpensesPage: React.FC = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const isNarrow = useMediaQuery("(max-width: 480px)");

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [search, setSearch] = useState("");
  const [fundFilter, setFundFilter] = useState<number | "">("");
  const [categoryFilter, setCategoryFilter] = useState<number | "">("");
  const [approvedFilter, setApprovedFilter] = useState<"" | "true" | "false">("");

  const [funds, setFunds] = useState<Fund[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const PAGE_SIZE = 15;

  useEffect(() => {
    injectKeyframes();
  }, []);

  // ── Load funds and categories ──────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      getFunds({ include_archived: false }),
      getExpenseCategories(),
    ]).then(([f, c]) => {
      setFunds(f);
      setCategories(c);
    }).catch(() => {});
  }, []);

  // ── Load expenses ──────────────────────────────────────────────────────────

  const loadExpenses = useCallback(async (p = 1, s = search, doCache = true) => {
    setLoading(true);
    setError(null);
    setFromCache(false);
    try {
      const filters: ExpenseFilters = { page: p, page_size: PAGE_SIZE };
      if (s.trim()) filters.search = s.trim();
      if (fundFilter !== "") (filters as any).fund_id = Number(fundFilter);
      if (categoryFilter !== "") filters.category_id = Number(categoryFilter);
      if (approvedFilter !== "") filters.approved = approvedFilter === "true";
      const res = await getExpenses(filters);
      setExpenses(res.items);
      setTotal(res.total);
      setTotalPages(res.total_pages);
      setPage(res.page);
      if (doCache) {
        setCache(CACHE_EXPENSES_KEY, res);
        setCache(CACHE_FILTERS_KEY, { search, fundFilter, categoryFilter, approvedFilter, page: p });
      }
    } catch (err: any) {
      const cached = getCache<{ items: Expense[]; total: number; total_pages: number; page: number }>(CACHE_EXPENSES_KEY);
      if (cached) {
        setExpenses(cached.items);
        setTotal(cached.total);
        setTotalPages(cached.total_pages);
        setPage(cached.page);
        setFromCache(true);
        setError(null);
      } else {
        setError(err?.response?.data?.detail ?? err.message ?? "Failed to load expenses");
      }
    } finally {
      setLoading(false);
    }
  }, [search, fundFilter, categoryFilter, approvedFilter]);

  useEffect(() => { loadExpenses(1, search); }, [fundFilter, categoryFilter, approvedFilter]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => loadExpenses(1, search), 400);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleApprove = async (id: number) => {
    try {
      await approveExpense(id);
      loadExpenses(page, search, false);
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? "Failed to approve expense");
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this expense? This cannot be undone.")) return;
    try {
      await deleteExpense(id);
      loadExpenses(page, search, false);
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? "Failed to delete");
    }
  };

  const handleReport = async (format: "pdf" | "excel") => {
    setReportLoading(true);
    try {
      const blob = await downloadExpenseReport(format, {
        ...(fundFilter !== "" ? { fund_id: Number(fundFilter) } : {}),
        ...(categoryFilter !== "" ? { category_id: Number(categoryFilter) } : {}),
      } as any);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expenses_report.${format === "excel" ? "xlsx" : "pdf"}`;
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

  // ── Render desktop table ──────────────────────────────────────────────────

  const renderDesktopTable = () => (
    <div style={S.tableCard}>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Receipt</th>
              <th style={S.th}>Title</th>
              <th style={S.th}>Fund</th>
              <th style={S.th}>Category</th>
              <th style={S.th}>Vendor</th>
              <th style={S.th}>Amount</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Created By</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={10} style={S.td}>
                    <div style={S.skeletonRow}>
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 2 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 0.8 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 0.8 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 0.8 }} />
                      <div style={{ ...S.skeleton, ...S.skeletonCell, flex: 1.2 }} />
                    </div>
                  </td>
                </tr>
              ))
            ) : expenses.length === 0 ? (
              <tr><td colSpan={10} style={S.emptyCell}>No expenses found</td></tr>
            ) : expenses.map((e) => (
              <tr key={e.id}>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: "12px", color: COLORS.textSecondary }}>{e.receipt_id}</td>
                <td style={S.td}>
                  <div style={{ fontWeight: 500 }}>{e.title}</div>
                  {e.receipt_image && (
                    <a href={e.receipt_image} target="_blank" rel="noreferrer" style={{ fontSize: "11px", color: COLORS.primary }}>
                      View Receipt ↗
                    </a>
                  )}
                </td>
                <td style={{ ...S.td, color: COLORS.textSecondary }}>
                  {(e as any).fund_name ?? <span style={{ color: COLORS.textMuted, fontStyle: "italic" }}>General Mosque</span>}
                </td>
                <td style={{ ...S.td, color: COLORS.textSecondary }}>{e.category_name ?? "—"}</td>
                <td style={{ ...S.td, color: COLORS.textSecondary }}>{(e as any).vendor_name ?? "—"}</td>
                <td style={{ ...S.td, fontWeight: 600, color: COLORS.danger, fontFamily: TYPOGRAPHY.fontDisplay }}>{fmt(e.amount)}</td>
                <td style={S.td}>
                  {e.approved_at ? (
                    <span style={{ ...S.badge, background: COLORS.iconGreen, color: COLORS.primary }}>Approved</span>
                  ) : (
                    <span style={{ ...S.badge, background: COLORS.backgroundAlt, color: COLORS.textMuted }}>Pending</span>
                  )}
                </td>
                <td style={{ ...S.td, fontSize: "13px", color: COLORS.textSecondary }}>{e.created_by}</td>
                <td style={{ ...S.td, color: COLORS.textSecondary, whiteSpace: "nowrap" }}>
                  {fmtDate((e as any).expense_date ?? e.created_at)}
                </td>
                <td style={{ ...S.td, display: "flex", gap: "6px", flexWrap: "nowrap" }}>
                  {!e.approved_at && (
                    <button style={S.btnSuccess} onClick={() => handleApprove(e.id)}>Approve</button>
                  )}
                  <button style={S.btnDanger} onClick={() => handleDelete(e.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={S.pagination}>
          <span>{total} expenses · Page {page} of {totalPages}</span>
          <div style={{ display: "flex", gap: "6px" }}>
            <button style={{ ...S.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => loadExpenses(page - 1, search)}>
              ‹ Prev
            </button>
            <button style={{ ...S.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => loadExpenses(page + 1, search)}>
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ── Render mobile cards ──────────────────────────────────────────────────

  const renderMobileCards = () => {
    if (loading) {
      return (
        <div style={S.cardList}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={S.card}>
              <div style={S.cardHeader}>
                <div style={{ ...S.skeleton, width: "60%", height: "18px" }} />
              </div>
              <div style={S.cardBody}>
                <div style={{ ...S.skeleton, height: "14px", width: "80%" }} />
                <div style={{ ...S.skeleton, height: "14px", width: "60%" }} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (expenses.length === 0) {
      return <div style={{ ...S.tableCard, ...S.emptyCell }}>No expenses found</div>;
    }

    return (
      <div style={S.cardList}>
        {expenses.map((e) => (
          <div key={e.id} style={S.card}>
            <div style={S.cardHeader}>
              <div style={S.cardInfo}>
                <div style={S.cardTitle}>{e.title}</div>
                <div style={S.cardMeta}>
                  <span style={{ fontFamily: "monospace", fontSize: "11px", color: COLORS.textMuted }}>{e.receipt_id}</span>
                  {e.approved_at ? (
                    <span style={{ ...S.badge, background: COLORS.iconGreen, color: COLORS.primary }}>Approved</span>
                  ) : (
                    <span style={{ ...S.badge, background: COLORS.backgroundAlt, color: COLORS.textMuted }}>Pending</span>
                  )}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: COLORS.danger, whiteSpace: "nowrap", fontFamily: TYPOGRAPHY.fontDisplay }}>{fmt(e.amount)}</div>
            </div>
            <div style={S.cardBody}>
              <div style={S.cardRow}>
                <span style={S.cardRowLabel}>Fund</span>
                <span style={S.cardRowValue}>{(e as any).fund_name ?? "General Mosque"}</span>
              </div>
              <div style={S.cardRow}>
                <span style={S.cardRowLabel}>Category</span>
                <span style={S.cardRowValue}>{e.category_name ?? "—"}</span>
              </div>
              <div style={S.cardRow}>
                <span style={S.cardRowLabel}>Vendor</span>
                <span style={S.cardRowValue}>{(e as any).vendor_name ?? "—"}</span>
              </div>
              <div style={{ ...S.cardRow, borderBottom: e.receipt_image ? `1px solid ${COLORS.divider}` : "none" }}>
                <span style={S.cardRowLabel}>Date</span>
                <span style={S.cardRowValue}>{fmtDate((e as any).expense_date ?? e.created_at)}</span>
              </div>
              {e.receipt_image && (
                <div style={{ ...S.cardRow, borderBottom: "none" }}>
                  <span style={S.cardRowLabel}>Receipt</span>
                  <a href={e.receipt_image} target="_blank" rel="noreferrer" style={{ color: COLORS.primary, fontSize: "12.5px", fontWeight: 600 }}>View ↗</a>
                </div>
              )}
              <div style={S.cardActions}>
                {!e.approved_at && (
                  <button style={S.btnSuccess} onClick={() => handleApprove(e.id)}>Approve</button>
                )}
                <button style={S.btnDanger} onClick={() => handleDelete(e.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}

        {totalPages > 1 && (
          <div style={{ ...S.pagination, ...S.tableCard, marginTop: "2px" }}>
            <span>{total} total · Page {page}/{totalPages}</span>
            <div style={{ display: "flex", gap: "6px" }}>
              <button style={{ ...S.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => loadExpenses(page - 1, search)}>‹</button>
              <button style={{ ...S.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => loadExpenses(page + 1, search)}>›</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Main render ───────────────────────────────────────────────────────────

  return (
    <div style={{ ...S.page, padding: isMobile ? "12px" : "24px" }}>
      <div style={S.header}>
        <div style={S.headerRow}>
          <div>
            <h1 style={S.title}>Expenses</h1>
            <p style={S.subtitle}>Record and manage all masjid expenditures.</p>
          </div>
          <button
            style={{ ...S.btnPrimary, width: isMobile ? "100%" : "auto" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.primary)}
            onClick={() => setShowModal(true)}
          >
            <span>+</span> New Expense
          </button>
        </div>
      </div>

      {fromCache && (
        <div style={S.offlineBanner}>
          <span>●</span> Viewing cached data
        </div>
      )}
      {error && <div style={S.errorBanner}>⚠ {error}</div>}

      <div style={S.toolbar}>
        <div style={S.searchRow}>
          <input
            style={S.searchInput}
            placeholder="Search title, vendor, receipt ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`)}
            onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
          />
          <button
            style={S.refreshBtn}
            onClick={() => loadExpenses(page, search)}
            onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
            onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.surface)}
            title="Refresh"
          >
            ⟳
          </button>
        </div>

        <div style={{ ...S.filterGrid, gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 1fr" }}>
          <select style={S.filterSelect} value={fundFilter} onChange={(e) => setFundFilter(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">All Funds</option>
            <option value="0">General Mosque</option>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select style={S.filterSelect} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select style={S.filterSelect} value={approvedFilter} onChange={(e) => setApprovedFilter(e.target.value as "" | "true" | "false")}>
            <option value="">All Status</option>
            <option value="true">Approved</option>
            <option value="false">Pending</option>
          </select>
        </div>

        <div style={S.exportRow}>
          <span style={S.exportLabel}>Export</span>
          <div style={S.exportGroup}>
            {(["pdf", "excel"] as const).map((f, i) => (
              <button
                key={f}
                style={{ ...S.exportBtn, borderLeft: i === 0 ? "none" : `1px solid ${COLORS.border}`, opacity: reportLoading ? 0.6 : 1 }}
                disabled={reportLoading}
                onClick={() => handleReport(f)}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
                onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.surface)}
              >
                {f === "excel" ? "Excel" : "PDF"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isMobile ? renderMobileCards() : renderDesktopTable()}

      {showModal && (
        <ExpenseModal
          funds={funds}
          categories={categories}
          onClose={() => setShowModal(false)}
          onSuccess={(exp) => {
            setShowModal(false);
            loadExpenses(1, search);
            alert(`Expense recorded! Receipt: ${exp.receipt_id}`);
          }}
        />
      )}
    </div>
  );
};

export default ExpensesPage;