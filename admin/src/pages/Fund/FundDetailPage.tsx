// src/pages/Fund/FundDetailPage.tsx

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import {
  getFund,
  getFundCollections,
  getFundExpenses,
  downloadFundReport,
  archiveFund,
  unarchiveFund,
  updateFund,
  type GetFundCollectionsParams,
  type GetFundExpensesParams,
} from "../../api/fund";
import type {
  Fund,
  FundCollection,
  FundExpense,
  UpdateFundPayload,
} from "../../types/fund";
import FundFormModal from "../../components/FundFormModal";
import ArchiveFundModal from "../../components/ArchiveFundModal";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (amount: number) =>
  `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const fmtMethod = (m: string) =>
  ({ cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque" }[m] ?? m);

// ─── Styles ──────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { padding: "24px 16px", maxWidth: "1200px", margin: "0 auto" },

  // Breadcrumb
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "14px",
    color: COLORS.textSecondary,
    marginBottom: "20px",
  },
  breadcrumbLink: {
    color: COLORS.primary,
    cursor: "pointer",
    textDecoration: "none",
    fontWeight: 500,
  },

  // Hero card
  hero: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "16px",
    padding: "24px",
    boxShadow: COLORS.shadowSm,
    marginBottom: "20px",
  },
  heroHeader: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "20px",
  },
  heroLeft: { flex: "1 1 auto", minWidth: 0 },
  fundName: {
    fontFamily: TYPOGRAPHY.fontDisplay,
    fontSize: "32px",
    fontWeight: 400,
    color: COLORS.text,
    letterSpacing: "0",
    margin: 0,
    lineHeight: 1.3,
  },
  fundDesc: {
    fontSize: "15px",
    color: COLORS.textSecondary,
    margin: "6px 0 0",
    lineHeight: 1.5,
  },
  heroActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    alignItems: "center",
    flexShrink: 0,
  },
  statusBadge: {
    padding: "5px 14px",
    borderRadius: "999px",
    fontSize: "13px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  btnPrimary: {
    height: "38px",
    padding: "0 18px",
    borderRadius: "10px",
    background: COLORS.primary,
    color: "#fff",
    fontWeight: 600,
    fontSize: "13px",
    border: "none",
    cursor: "pointer",
  },
  btnOutline: {
    height: "38px",
    padding: "0 18px",
    borderRadius: "10px",
    background: "transparent",
    color: COLORS.textSecondary,
    fontWeight: 500,
    fontSize: "13px",
    border: `1px solid ${COLORS.border}`,
    cursor: "pointer",
  },
  btnDanger: {
    height: "38px",
    padding: "0 18px",
    borderRadius: "10px",
    background: "transparent",
    color: COLORS.danger,
    fontWeight: 500,
    fontSize: "13px",
    border: `1px solid ${COLORS.danger}`,
    cursor: "pointer",
  },

  // Stats grid
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
  },
  statTile: {
    background: COLORS.backgroundAlt,
    borderRadius: "12px",
    padding: "16px",
    textAlign: "center",
  },
  statValue: {
    fontSize: "22px",
    fontWeight: 700,
    fontFamily: TYPOGRAPHY.fontDisplay,
    color: COLORS.text,
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: "12px",
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginTop: "4px",
  },

  // Progress bar
  progressWrap: { marginTop: "16px" },
  progressRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "13px",
    color: COLORS.textSecondary,
    marginBottom: "6px",
  },
  progressTrack: {
    width: "100%",
    height: "8px",
    background: COLORS.primaryLight,
    borderRadius: "999px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: "999px",
    background: COLORS.primary,
    transition: "width 0.6s ease",
  },

  // Meta row
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "20px",
    marginTop: "16px",
    paddingTop: "16px",
    borderTop: `1px solid ${COLORS.divider}`,
    fontSize: "13px",
    color: COLORS.textSecondary,
  },
  metaItem: { display: "flex", gap: "4px", alignItems: "center" },
  metaVal: { fontWeight: 600, color: COLORS.text },

  // Tab nav
  tabNav: {
    display: "flex",
    gap: "4px",
    borderBottom: `2px solid ${COLORS.border}`,
    marginBottom: "20px",
  },
  tab: {
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    border: "none",
    background: "transparent",
    color: COLORS.textSecondary,
    borderBottom: "2px solid transparent",
    marginBottom: "-2px",
    borderRadius: "6px 6px 0 0",
    transition: "color 0.2s, border-color 0.2s",
  },
  tabActive: {
    color: COLORS.primary,
    borderBottomColor: COLORS.primary,
    fontWeight: 600,
  },

  // Table section
  section: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "16px",
    padding: "0",
    boxShadow: COLORS.shadowSm,
    overflow: "hidden",
  },
  sectionHeader: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    padding: "16px 20px",
    borderBottom: `1px solid ${COLORS.border}`,
  },
  sectionTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: COLORS.text,
    margin: 0,
  },
  searchInput: {
    height: "36px",
    padding: "0 12px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "10px",
    background: COLORS.backgroundAlt,
    fontSize: "13px",
    outline: "none",
    minWidth: "200px",
    color: COLORS.text,
  },
  tableWrap: { overflowX: "auto" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "14px",
  },
  th: {
    padding: "12px 16px",
    textAlign: "left",
    fontWeight: 600,
    color: COLORS.textSecondary,
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    background: COLORS.backgroundAlt,
    borderBottom: `1px solid ${COLORS.border}`,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 16px",
    borderBottom: `1px solid ${COLORS.divider}`,
    color: COLORS.text,
    verticalAlign: "middle",
  },
  emptyCell: {
    padding: "48px 20px",
    textAlign: "center",
    color: COLORS.textMuted,
    fontSize: "14px",
  },

  // Pagination
  pagination: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 20px",
    borderTop: `1px solid ${COLORS.border}`,
    fontSize: "13px",
    color: COLORS.textSecondary,
    flexWrap: "wrap",
    gap: "8px",
  },
  pageBtn: {
    height: "32px",
    minWidth: "32px",
    padding: "0 10px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "8px",
    background: COLORS.surface,
    cursor: "pointer",
    fontSize: "13px",
    color: COLORS.text,
  },
  pageBtnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },

  // Report bar
  reportBar: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  reportLabel: { fontSize: "14px", color: COLORS.textSecondary, fontWeight: 500 },

  // Utility
  error: {
    background: COLORS.dangerLight,
    color: COLORS.danger,
    padding: "12px 16px",
    borderRadius: "12px",
    marginBottom: "16px",
    fontSize: "14px",
    border: `1px solid ${COLORS.danger}`,
  },
  loading: {
    textAlign: "center",
    padding: "60px 20px",
    color: COLORS.textSecondary,
    fontSize: "15px",
  },
  methodBadge: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    background: COLORS.primaryLight,
    color: COLORS.primary,
  },
  approvedBadge: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    background: COLORS.iconGreen,
    color: COLORS.primary,
  },
  pendingBadge: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    background: COLORS.backgroundAlt,
    color: COLORS.textMuted,
  },
};

// ─── Status badge colours ─────────────────────────────────────────────────────

function statusStyle(fund: Fund): React.CSSProperties {
  if (fund.is_archived || fund.status === "archived") return { background: "#E5E7EB", color: "#6B7280" };
  return { background: COLORS.iconGreen, color: COLORS.primary };  // live
}

function statusLabel(fund: Fund) {
  if (fund.is_archived || fund.status === "archived") return "Archived";
  return "Live";
}

// ─── Component ───────────────────────────────────────────────────────────────

type Tab = "collections" | "expenses";

const FundDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fundId = Number(id);

  // Fund state
  const [fund, setFund] = useState<Fund | null>(null);
  const [fundLoading, setFundLoading] = useState(true);
  const [fundError, setFundError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("collections");

  // Collections state
  const [collections, setCollections] = useState<FundCollection[]>([]);
  const [collTotal, setCollTotal] = useState(0);
  const [collPage, setCollPage] = useState(1);
  const [collTotalPages, setCollTotalPages] = useState(1);
  const [collSearch, setCollSearch] = useState("");
  const [collLoading, setCollLoading] = useState(false);
  const PAGE_SIZE = 10;

  // Expenses state
  const [expenses, setExpenses] = useState<FundExpense[]>([]);
  const [expTotal, setExpTotal] = useState(0);
  const [expPage, setExpPage] = useState(1);
  const [expTotalPages, setExpTotalPages] = useState(1);
  const [expSearch, setExpSearch] = useState("");
  const [expLoading, setExpLoading] = useState(false);

  // Modal state
  const [showEdit, setShowEdit] = useState(false);
  const [showArchive, setShowArchive] = useState(false);

  // Report download state
  const [reportLoading, setReportLoading] = useState(false);

  // ── Fetch fund ──────────────────────────────────────────────────────────────

  const loadFund = useCallback(async () => {
    if (!fundId) return;
    setFundLoading(true);
    setFundError(null);
    try {
      const data = await getFund(fundId);
      setFund(data);
    } catch (err: any) {
      setFundError(err?.response?.data?.detail ?? err.message ?? "Failed to load fund");
    } finally {
      setFundLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    loadFund();
  }, [loadFund]);

  // ── Fetch collections ───────────────────────────────────────────────────────

  const loadCollections = useCallback(async (page = 1, search = "") => {
    if (!fundId) return;
    setCollLoading(true);
    try {
      const params: GetFundCollectionsParams = { page, page_size: PAGE_SIZE };
      if (search.trim()) params.search = search.trim();
      const res = await getFundCollections(fundId, params);
      setCollections(res.items);
      setCollTotal(res.total);
      setCollTotalPages(res.total_pages);
      setCollPage(res.page);
    } catch {
      setCollections([]);
    } finally {
      setCollLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    if (activeTab === "collections") loadCollections(1, collSearch);
  }, [activeTab, fundId]); // eslint-disable-line

  // ── Fetch expenses ──────────────────────────────────────────────────────────

  const loadExpenses = useCallback(async (page = 1, search = "") => {
    if (!fundId) return;
    setExpLoading(true);
    try {
      const params: GetFundExpensesParams = { page, page_size: PAGE_SIZE };
      if (search.trim()) params.search = search.trim();
      const res = await getFundExpenses(fundId, params);
      setExpenses(res.items);
      setExpTotal(res.total);
      setExpTotalPages(res.total_pages);
      setExpPage(res.page);
    } catch {
      setExpenses([]);
    } finally {
      setExpLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    if (activeTab === "expenses") loadExpenses(1, expSearch);
  }, [activeTab, fundId]); // eslint-disable-line

  // ── Search debounce ─────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => loadCollections(1, collSearch), 400);
    return () => clearTimeout(t);
  }, [collSearch]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => loadExpenses(1, expSearch), 400);
    return () => clearTimeout(t);
  }, [expSearch]); // eslint-disable-line

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSaveEdit = async (payload: UpdateFundPayload) => {
    if (!fund) return;
    await updateFund(fund.id, payload);
    setShowEdit(false);
    await loadFund();
  };

  const handleConfirmArchive = async () => {
    if (!fund) return;
    if (fund.is_archived) {
      await unarchiveFund(fund.id);
    } else {
      await archiveFund(fund.id);
    }
    setShowArchive(false);
    await loadFund();
  };

  const handleDownloadReport = async (format: "pdf" | "excel") => {
    if (!fund) return;
    setReportLoading(true);
    try {
      const blob = await downloadFundReport(fund.id, { format });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fund_${fund.name.replace(/\s+/g, "_")}_report.${format === "excel" ? "xlsx" : "pdf"}`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? err.message ?? "Failed to download report");
    } finally {
      setReportLoading(false);
    }
  };

  // ── Render: loading / error ─────────────────────────────────────────────────

  if (fundLoading) {
    return (
      <div style={S.page}>
        <div style={S.loading}>Loading fund details…</div>
      </div>
    );
  }

  if (fundError || !fund) {
    return (
      <div style={S.page}>
        <div style={S.error}>⚠ {fundError ?? "Fund not found"}</div>
        <button style={S.btnOutline} onClick={() => navigate("/funds")}>
          ← Back to Funds
        </button>
      </div>
    );
  }

  const progress = Math.min(Math.max(fund.progress_percentage ?? 0, 0), 100);
  const showGoal = fund.goal_amount != null && fund.goal_amount > 0;

  // ── Render: collections tab ─────────────────────────────────────────────────

  const renderCollections = () => (
    <div style={S.section}>
      <div style={S.sectionHeader}>
        <h3 style={S.sectionTitle}>
          Collections{" "}
          <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>({collTotal})</span>
        </h3>
        <input
          style={S.searchInput}
          placeholder="Search donor, receipt, phone…"
          value={collSearch}
          onChange={(e) => setCollSearch(e.target.value)}
        />
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Donor</th>
              <th style={S.th}>Receipt</th>
              <th style={S.th}>Method</th>
              <th style={S.th}>Amount</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Phone</th>
            </tr>
          </thead>
          <tbody>
            {collLoading ? (
              <tr>
                <td colSpan={6} style={S.emptyCell}>
                  Loading…
                </td>
              </tr>
            ) : collections.length === 0 ? (
              <tr>
                <td colSpan={6} style={S.emptyCell}>
                  No collections found
                </td>
              </tr>
            ) : (
              collections.map((c) => (
                <tr key={c.id}>
                  <td style={S.td}>{c.donor_name}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: "12px", color: COLORS.textSecondary }}>
                    {c.receipt_id}
                  </td>
                  <td style={S.td}>
                    <span style={S.methodBadge}>{fmtMethod(c.method)}</span>
                  </td>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.success }}>
                    {fmt(c.amount)}
                  </td>
                  <td style={{ ...S.td, color: COLORS.textSecondary }}>
                    {fmtDate(c.donation_date ?? c.created_at)}
                  </td>
                  <td style={{ ...S.td, color: COLORS.textSecondary }}>
                    {c.phone ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {collTotalPages > 1 && (
        <div style={S.pagination}>
          <span>
            Page {collPage} of {collTotalPages} &nbsp;·&nbsp; {collTotal} records
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              style={{ ...S.pageBtn, ...(collPage <= 1 ? S.pageBtnDisabled : {}) }}
              disabled={collPage <= 1}
              onClick={() => loadCollections(collPage - 1, collSearch)}
            >
              ‹ Prev
            </button>
            <button
              style={{ ...S.pageBtn, ...(collPage >= collTotalPages ? S.pageBtnDisabled : {}) }}
              disabled={collPage >= collTotalPages}
              onClick={() => loadCollections(collPage + 1, collSearch)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ── Render: expenses tab ────────────────────────────────────────────────────

  const renderExpenses = () => (
    <div style={S.section}>
      <div style={S.sectionHeader}>
        <h3 style={S.sectionTitle}>
          Expenses{" "}
          <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>({expTotal})</span>
        </h3>
        <input
          style={S.searchInput}
          placeholder="Search title, vendor, receipt…"
          value={expSearch}
          onChange={(e) => setExpSearch(e.target.value)}
        />
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Title</th>
              <th style={S.th}>Category</th>
              <th style={S.th}>Vendor</th>
              <th style={S.th}>Amount</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {expLoading ? (
              <tr>
                <td colSpan={6} style={S.emptyCell}>
                  Loading…
                </td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={6} style={S.emptyCell}>
                  No expenses found
                </td>
              </tr>
            ) : (
              expenses.map((e) => (
                <tr key={e.id}>
                  <td style={S.td}>{e.title}</td>
                  <td style={{ ...S.td, color: COLORS.textSecondary }}>
                    {e.category_name ?? "—"}
                  </td>
                  <td style={{ ...S.td, color: COLORS.textSecondary }}>
                    {e.vendor_name ?? "—"}
                  </td>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.danger }}>
                    {fmt(e.amount)}
                  </td>
                  <td style={{ ...S.td, color: COLORS.textSecondary }}>
                    {fmtDate(e.expense_date ?? e.created_at)}
                  </td>
                  <td style={S.td}>
                    {e.approved_by ? (
                      <span style={S.approvedBadge}>Approved</span>
                    ) : (
                      <span style={S.pendingBadge}>Pending</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {expTotalPages > 1 && (
        <div style={S.pagination}>
          <span>
            Page {expPage} of {expTotalPages} &nbsp;·&nbsp; {expTotal} records
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              style={{ ...S.pageBtn, ...(expPage <= 1 ? S.pageBtnDisabled : {}) }}
              disabled={expPage <= 1}
              onClick={() => loadExpenses(expPage - 1, expSearch)}
            >
              ‹ Prev
            </button>
            <button
              style={{ ...S.pageBtn, ...(expPage >= expTotalPages ? S.pageBtnDisabled : {}) }}
              disabled={expPage >= expTotalPages}
              onClick={() => loadExpenses(expPage + 1, expSearch)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      {/* Breadcrumb */}
      <div style={S.breadcrumb}>
        <span style={S.breadcrumbLink} onClick={() => navigate("/funds")}>
          Funds
        </span>
        <span>›</span>
        <span>{fund.name}</span>
      </div>

      {/* Hero card */}
      <div style={S.hero}>
        <div style={S.heroHeader}>
          <div style={S.heroLeft}>
            <h1 style={S.fundName}>{fund.name}</h1>
            {fund.description && <p style={S.fundDesc}>{fund.description}</p>}
          </div>
          <div style={S.heroActions}>
            <span style={{ ...S.statusBadge, ...statusStyle(fund) }}>
              {statusLabel(fund)}
            </span>
            {!fund.is_archived && (
              <button
                style={S.btnPrimary}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.primary)}
                onClick={() => setShowEdit(true)}
              >
                Edit
              </button>
            )}
            <button
              style={fund.is_archived ? S.btnOutline : S.btnDanger}
              onClick={() => setShowArchive(true)}
            >
              {fund.is_archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        </div>

        {/* Stats tiles */}
        <div style={S.statsGrid}>
          <div style={S.statTile}>
            <div style={{ ...S.statValue, color: COLORS.success }}>{fmt(fund.collected_amount)}</div>
            <div style={S.statLabel}>Collected</div>
          </div>
          <div style={S.statTile}>
            <div style={{ ...S.statValue, color: COLORS.danger }}>{fmt(fund.spent_amount)}</div>
            <div style={S.statLabel}>Spent</div>
          </div>
          <div style={S.statTile}>
            <div style={{ ...S.statValue, color: COLORS.lapis }}>{fmt(fund.balance)}</div>
            <div style={S.statLabel}>Balance</div>
          </div>
          <div style={S.statTile}>
            <div style={S.statValue}>{fund.donation_count}</div>
            <div style={S.statLabel}>Donations</div>
          </div>
          <div style={S.statTile}>
            <div style={S.statValue}>{fund.expense_count}</div>
            <div style={S.statLabel}>Expenses</div>
          </div>
          <div style={S.statTile}>
            <div style={S.statValue}>{fund.donor_count}</div>
            <div style={S.statLabel}>Donors</div>
          </div>
        </div>

        {/* Progress bar */}
        {showGoal && (
          <div style={S.progressWrap}>
            <div style={S.progressRow}>
              <span>Progress — {progress.toFixed(1)}%</span>
              <span>Goal: {fmt(fund.goal_amount!)}</span>
            </div>
            <div style={S.progressTrack}>
              <div style={{ ...S.progressFill, width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Meta row */}
        <div style={S.metaRow}>
          {fund.start_date && (
            <span style={S.metaItem}>
              Start: <span style={S.metaVal}>{fmtDate(fund.start_date)}</span>
            </span>
          )}
          {fund.expected_end_date && (
            <span style={S.metaItem}>
              Target: <span style={S.metaVal}>{fmtDate(fund.expected_end_date)}</span>
            </span>
          )}
          {fund.completed_at && (
            <span style={S.metaItem}>
              Completed: <span style={S.metaVal}>{fmtDate(fund.completed_at)}</span>
            </span>
          )}
          <span style={S.metaItem}>
            Created by: <span style={S.metaVal}>{fund.created_by ?? "—"}</span>
          </span>
          {fund.last_donation_at && (
            <span style={S.metaItem}>
              Last donation: <span style={S.metaVal}>{fmtDate(fund.last_donation_at)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Report download bar */}
      <div style={S.reportBar}>
        <span style={S.reportLabel}>Download Report:</span>
        {(["pdf", "excel"] as const).map((fmt_) => (
          <button
            key={fmt_}
            style={S.btnOutline}
            disabled={reportLoading}
            onClick={() => handleDownloadReport(fmt_)}
          >
            {fmt_ === "excel" ? "Excel" : "PDF"}
          </button>
        ))}
        {reportLoading && (
          <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>Generating…</span>
        )}
      </div>

      {/* Tab navigation */}
      <div style={S.tabNav}>
        {(["collections", "expenses"] as Tab[]).map((tab) => (
          <button
            key={tab}
            style={{
              ...S.tab,
              ...(activeTab === tab ? S.tabActive : {}),
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "collections" ? "Collections" : "Expenses"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "collections" ? renderCollections() : renderExpenses()}

      {/* Edit modal */}
      <FundFormModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSave={handleSaveEdit}
        initialData={fund}
        isEditing
      />

      {/* Archive modal */}
      <ArchiveFundModal
        open={showArchive}
        onClose={() => setShowArchive(false)}
        onConfirm={handleConfirmArchive}
        fundName={fund.name}
        fundId={fund.id}
      />
    </div>
  );
};

export default FundDetailPage;
