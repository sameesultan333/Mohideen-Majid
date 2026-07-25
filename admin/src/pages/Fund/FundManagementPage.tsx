import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import {
  getFundDashboard,
  getFunds,
  createFund,
  updateFund,
  archiveFund,
  unarchiveFund,
  downloadFundReport,
} from "../../api/fund";
import type {
  Fund,
  FundDashboard,
  CreateFundPayload,
  UpdateFundPayload,
  FundStatus,
} from "../../types/fund";
import FundCard from "../../components/FundCard";
import FundFormModal from "../../components/FundFormModal";
import ArchiveFundModal from "../../components/ArchiveFundModal";

// ─── Window size hook ──────────────────────────────────────────────────
const useWindowSize = () => {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const handler = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return size;
};

// ─── Styles ──────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "24px 16px",
    maxWidth: "1400px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "24px",
    gap: "12px",
  },
  headerLeft: { flex: "1 1 auto" },
  title: {
    fontSize: "28px",
    fontWeight: 600,
    letterSpacing: "-0.4px",
    color: COLORS.text,
    margin: 0,
  },
  subtitle: {
    fontSize: "15px",
    color: COLORS.textSecondary,
    margin: "4px 0 0",
  },
  addButton: {
    height: "44px",
    padding: "0 24px",
    borderRadius: "12px",
    background: COLORS.primary,
    color: "#fff",
    fontWeight: 600,
    fontSize: "14px",
    border: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    boxShadow: COLORS.shadowPrimary,
    transition: "background 0.2s, transform 0.1s",
  },
  statCard: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    padding: "16px",
    boxShadow: COLORS.shadowSm,
    transition: "box-shadow 0.2s, transform 0.2s",
  },
  statNumber: {
    fontSize: "26px",
    fontWeight: 600,
    fontFamily: TYPOGRAPHY.fontDisplay,
    color: COLORS.text,
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: "13px",
    color: COLORS.textSecondary,
    marginTop: "4px",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "20px",
    alignItems: "center",
  },
  searchInput: {
    flex: "1 1 200px",
    minWidth: "160px",
    height: "42px",
    padding: "0 14px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    background: COLORS.surface,
    fontSize: "14px",
    outline: "none",
    color: COLORS.text,
  },
  filterSelect: {
    height: "42px",
    padding: "0 32px 0 14px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    background: COLORS.surface,
    fontSize: "14px",
    outline: "none",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center",
    minWidth: "130px",
    cursor: "pointer",
    color: COLORS.text,
  },
  refreshButton: {
    height: "42px",
    padding: "0 16px",
    borderRadius: "12px",
    border: `1px solid ${COLORS.border}`,
    background: COLORS.surface,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "14px",
    fontWeight: 500,
    color: COLORS.textSecondary,
    transition: "background 0.2s",
  },
  emptyState: {
    textAlign: "center" as const,
    padding: "60px 20px",
    color: COLORS.textSecondary,
  },
  emptyTitle: {
    fontSize: "20px",
    fontWeight: 600,
    color: COLORS.text,
    marginBottom: "8px",
  },
  errorBanner: {
    background: COLORS.dangerLight,
    color: COLORS.danger,
    padding: "12px 16px",
    borderRadius: "12px",
    marginBottom: "16px",
    fontSize: "14px",
    border: `1px solid ${COLORS.danger}`,
  },
  offlineIndicator: {
    background: COLORS.warningLight || "#FAF0DD",
    color: COLORS.warning || "#B07A1E",
    padding: "8px 16px",
    borderRadius: "12px",
    marginBottom: "16px",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    border: `1px solid ${COLORS.warning || "#B07A1E"}`,
  },
  loadingSkeleton: {
    background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
    borderRadius: "12px",
    minHeight: "300px",
  },
};

// ─── Dynamic style helpers ──────────────────────────────────────────────
const getStatsStyle = (cols: number): React.CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${cols}, 1fr)`,
  gap: "12px",
  marginBottom: "24px",
});

const getGridStyle = (mobile: boolean): React.CSSProperties => ({
  display: "grid",
  gridTemplateColumns: mobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))",
  gap: "20px",
  marginTop: "4px",
});

// ─── Shimmer animation ──────────────────────────────────────────────────
const shimmerStyle = document.createElement("style");
shimmerStyle.innerHTML = `@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`;
document.head.appendChild(shimmerStyle);

// ─── Offline cache helpers ──────────────────────────────────────────────
const CACHE_KEY = "funds_cache";
const CACHE_DASHBOARD_KEY = "funds_dashboard_cache";

const getCache = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
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

// ─── Component ──────────────────────────────────────────────────────────
const FundManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const { width } = useWindowSize();
  const isMobile = width < 768;
  const statsCols = width < 480 ? 2 : width < 768 ? 3 : 5;

  const [funds, setFunds] = useState<Fund[]>([]);
  const [dashboard, setDashboard] = useState<FundDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FundStatus>("active");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingFund, setEditingFund] = useState<Fund | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [fundToArchive, setFundToArchive] = useState<Fund | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setFromCache(false);
    try {
      const [dashboardData, fundsData] = await Promise.all([
        getFundDashboard(),
        getFunds({ include_archived: true }),
      ]);
      setDashboard(dashboardData);
      setFunds(fundsData);
      setCache(CACHE_KEY, fundsData);
      setCache(CACHE_DASHBOARD_KEY, dashboardData);
    } catch (err: any) {
      const cachedFunds = getCache<Fund[]>(CACHE_KEY);
      const cachedDashboard = getCache<FundDashboard>(CACHE_DASHBOARD_KEY);
      if (cachedFunds?.length) {
        setFunds(cachedFunds);
        if (cachedDashboard) setDashboard(cachedDashboard);
        setFromCache(true);
        setError(null);
      } else {
        setError(err.message || "Failed to load funds. Please check your connection.");
        setFunds([]);
        setDashboard(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredFunds = useMemo(() => {
    let result = funds;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (f) => f.name.toLowerCase().includes(q) || (f.description && f.description.toLowerCase().includes(q))
      );
    }
    if (statusFilter === "active") {
      result = result.filter((f) => !f.is_archived && f.status !== "archived");
    } else if (statusFilter !== "all") {
      result = result.filter((f) => f.is_archived || f.status === "archived");
    }
    result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return result;
  }, [funds, search, statusFilter]);

  const handleCreate = () => {
    setEditingFund(null);
    setShowCreateModal(true);
  };
  const handleEdit = (id: number) => {
    const fund = funds.find((f) => f.id === id);
    if (fund) {
      setEditingFund(fund);
      setShowCreateModal(true);
    }
  };
  const handleView = (id: number) => navigate(`/funds/${id}`);
  const handleReport = async (id: number) => {
    try {
      const blob = await downloadFundReport(id, { format: "pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fund = funds.find((f) => f.id === id);
      a.download = `fund_${fund?.name || id}_report.pdf`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || "Failed to download report");
    }
  };
  const handleArchiveClick = (id: number) => {
    const fund = funds.find((f) => f.id === id);
    if (fund) {
      setFundToArchive(fund);
      setShowArchiveModal(true);
    }
  };

  const handleSaveFund = async (payload: CreateFundPayload | UpdateFundPayload) => {
    if (editingFund) {
      const updated = await updateFund(editingFund.id, payload);
      setFunds((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } else {
      const created = await createFund(payload as CreateFundPayload);
      setFunds((prev) => [created, ...prev]);
    }
    setShowCreateModal(false);
    setEditingFund(null);
    await fetchData();
  };

  const handleConfirmArchive = async () => {
    if (!fundToArchive) return;
    try {
      if (fundToArchive.is_archived) {
        await unarchiveFund(fundToArchive.id);
      } else {
        await archiveFund(fundToArchive.id);
      }
      setShowArchiveModal(false);
      setFundToArchive(null);
      await fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to archive/unarchive fund");
    }
  };

  const renderStats = () => {
    if (!dashboard) return null;
    const items = [
      { label: "Total Funds", value: dashboard.total_funds },
      { label: "Live", value: (dashboard.active_funds || 0) + (dashboard.completed_funds || 0) },
      { label: "Archived", value: dashboard.archived_funds || 0 },
      { label: "Collected", value: `₹${dashboard.total_collected.toLocaleString("en-IN")}` },
      { label: "Balance", value: `₹${dashboard.overall_balance.toLocaleString("en-IN")}` },
    ];
    return (
      <div style={getStatsStyle(statsCols)}>
        {items.map((item, i) => (
          <div key={i} style={styles.statCard}>
            <div style={styles.statNumber}>{item.value}</div>
            <div style={styles.statLabel}>{item.label}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <h1 style={styles.title}>Funds</h1>
            <p style={styles.subtitle}>Loading financial campaigns...</p>
          </div>
        </div>
        <div style={getStatsStyle(statsCols)}>
          {Array.from({ length: statsCols }).map((_, i) => (
            <div key={i} style={{ ...styles.statCard, ...styles.loadingSkeleton, minHeight: "80px" }} />
          ))}
        </div>
        <div style={styles.toolbar}>
          <div style={{ ...styles.loadingSkeleton, height: "42px", flex: "1 1 200px" }} />
          <div style={{ ...styles.loadingSkeleton, height: "42px", width: "130px" }} />
        </div>
        <div style={getGridStyle(isMobile)}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={styles.loadingSkeleton} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Funds</h1>
          <p style={styles.subtitle}>Manage financial campaigns and collection purposes.</p>
        </div>
        <button
          style={styles.addButton}
          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.primary)}
          onClick={handleCreate}
        >
          New Fund
        </button>
      </div>

      {fromCache && (
        <div style={styles.offlineIndicator}>
          <span>●</span> You are viewing cached data. Please check your connection.
        </div>
      )}
      {error && (
        <div style={styles.errorBanner}>
          <span style={{ fontWeight: 600, marginRight: 4 }}>Error:</span> {error}
        </div>
      )}

      {renderStats()}

      <div style={styles.toolbar}>
        <input
          style={styles.searchInput}
          type="text"
          placeholder="Search funds..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | FundStatus)}
        >
          <option value="all">All Funds</option>
          <option value="active">Live</option>
          <option value="archived">Archived</option>
        </select>
        <button style={styles.refreshButton} onClick={fetchData}>
          <span style={{ fontSize: "16px", lineHeight: 1 }}>↻</span> Refresh
        </button>
      </div>

      {filteredFunds.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyTitle}>No funds found</div>
          <p style={{ color: COLORS.textSecondary, marginBottom: "16px" }}>
            {search || statusFilter !== "all"
              ? "Try adjusting your filters"
              : "Create your first fund to get started"}
          </p>
          <button style={styles.addButton} onClick={handleCreate}>
            New Fund
          </button>
        </div>
      ) : (
        <div style={getGridStyle(isMobile)}>
          {filteredFunds.map((fund) => (
            <FundCard
              key={fund.id}
              fund={fund}
              onView={handleView}
              onEdit={handleEdit}
              onReport={handleReport}
              onArchive={handleArchiveClick}
              fromCache={fromCache}
            />
          ))}
        </div>
      )}

      <FundFormModal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setEditingFund(null);
        }}
        onSave={handleSaveFund}
        initialData={editingFund}
        isEditing={!!editingFund}
      />
      {fundToArchive && (
        <ArchiveFundModal
          open={showArchiveModal}
          onClose={() => {
            setShowArchiveModal(false);
            setFundToArchive(null);
          }}
          onConfirm={handleConfirmArchive}
          fundName={fundToArchive.name}
          fundId={fundToArchive.id}
        />
      )}
    </div>
  );
};

export default FundManagementPage;