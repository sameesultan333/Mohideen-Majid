import React from "react";
import { COLORS } from "../theme/colors";
import type { Fund } from "../types/fund";

interface FundCardProps {
  fund: Fund;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onReport: (id: number) => void;
  onArchive: (id: number) => void;
  fromCache?: boolean;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "16px",
    padding: "20px 22px",
    boxShadow: COLORS.shadowSm,
    transition: "box-shadow 0.25s ease, transform 0.25s ease",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    minHeight: "300px",
  },
  cardHover: {
    boxShadow: COLORS.shadowLg,
    transform: "translateY(-4px)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
  },
  nameWrapper: { flex: 1, minWidth: 0 },
  name: {
    fontSize: "18px",
    fontWeight: 600,
    color: COLORS.text,
    margin: 0,
    lineHeight: 1.3,
    wordBreak: "break-word",
  },
  description: {
    fontSize: "14px",
    color: COLORS.textSecondary,
    margin: "4px 0 0",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    lineHeight: 1.4,
  },
  statusBadge: {
    flexShrink: 0,
    padding: "4px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  goalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    fontSize: "14px",
    color: COLORS.textSecondary,
    marginTop: "4px",
  },
  goalAmount: { fontWeight: 600, color: COLORS.text },
  progressWrapper: { display: "flex", flexDirection: "column", gap: "4px" },
  progressBarTrack: {
    width: "100%",
    height: "8px",
    background: COLORS.primaryLight,
    borderRadius: "999px",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: "999px",
    transition: "width 0.6s ease",
    background: COLORS.primary,
  },
  progressLabel: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "13px",
    color: COLORS.textSecondary,
  },
  progressPercent: { fontWeight: 600, color: COLORS.text },
  financialGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
    margin: "4px 0",
  },
  financialItem: {
    background: COLORS.backgroundAlt,
    borderRadius: "12px",
    padding: "12px 8px",
    textAlign: "center",
  },
  financialLabel: {
    fontSize: "12px",
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  financialValue: {
    fontSize: "20px",
    fontWeight: 600,
    color: COLORS.text,
    marginTop: "2px",
    fontFamily: "'Fraunces', Georgia, serif",
  },
  financialValueCollected: { color: COLORS.success },
  financialValueSpent: { color: COLORS.danger },
  financialValueBalance: { color: COLORS.lapis },
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "16px",
    fontSize: "13px",
    color: COLORS.textSecondary,
    borderTop: `1px solid ${COLORS.divider}`,
    paddingTop: "12px",
    marginTop: "4px",
  },
  metaItem: { display: "flex", alignItems: "center", gap: "4px" },
  metaValue: { fontWeight: 500, color: COLORS.text },
  actions: {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    borderTop: `1px solid ${COLORS.divider}`,
    paddingTop: "12px",
    marginTop: "auto",
  },
  actionButton: {
    padding: "6px 14px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    background: "transparent",
    color: COLORS.textSecondary,
    transition: "background 0.2s, color 0.2s, border-color 0.2s",
  },
  actionButtonPrimary: { background: COLORS.primary, color: "#fff" },
  actionButtonOutline: { border: `1px solid ${COLORS.border}` },
  actionButtonDanger: { color: COLORS.danger },
  cacheIndicator: {
    fontSize: "11px",
    color: COLORS.textMuted,
    background: COLORS.backgroundAlt,
    padding: "2px 10px",
    borderRadius: "999px",
    letterSpacing: "0.02em",
    display: "inline-block",
    marginTop: "6px",
  },
};

const formatCurrency = (amount: number) =>
  `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const formatDate = (dateString: string) => {
  if (!dateString) return "—";
  const d = new Date(dateString);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const FundCard: React.FC<FundCardProps> = ({
  fund,
  onView,
  onEdit,
  onReport,
  onArchive,
  fromCache = false,
}) => {
  const isArchived = fund.is_archived;
  const status = fund.status;

  const getStatusStyle = () => {
    if (isArchived || status === "archived") return { bg: "#E5E7EB", color: "#6B7280" };
    return { bg: COLORS.iconGreen, color: COLORS.primary };
  };
  const statusStyle = getStatusStyle();

  const progress = Math.min(Math.max(fund.progress_percentage || 0, 0), 100);
  const showGoal = fund.goal_amount !== undefined && fund.goal_amount !== null && fund.goal_amount > 0;
  const remaining = showGoal ? Math.max(fund.goal_amount! - fund.collected_amount, 0) : 0;

  return (
    <div
      style={styles.card}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = styles.cardHover.boxShadow as string;
        e.currentTarget.style.transform = styles.cardHover.transform as string;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = styles.card.boxShadow as string;
        e.currentTarget.style.transform = "none";
      }}
    >
      <div style={styles.header}>
        <div style={styles.nameWrapper}>
          <h3 style={styles.name}>{fund.name}</h3>
          {fund.description && <p style={styles.description}>{fund.description}</p>}
          {fromCache && <span style={styles.cacheIndicator}>● Cached</span>}
        </div>
        <span
          style={{
            ...styles.statusBadge,
            background: statusStyle.bg,
            color: statusStyle.color,
          }}
        >
          {isArchived || status === "archived" ? "Archived" : "Live"}
        </span>
      </div>

      {showGoal && (
        <>
          <div style={styles.goalRow}>
            <span>Goal</span>
            <span style={styles.goalAmount}>{formatCurrency(fund.goal_amount!)}</span>
          </div>
          <div style={styles.progressWrapper}>
            <div style={styles.progressBarTrack}>
              <div style={{ ...styles.progressBarFill, width: `${progress}%` }} />
            </div>
            <div style={styles.progressLabel}>
              <span style={styles.progressPercent}>{progress}%</span>
              <span>Remaining: {formatCurrency(remaining)}</span>
            </div>
          </div>
        </>
      )}

      <div style={styles.financialGrid}>
        <div style={styles.financialItem}>
          <div style={styles.financialLabel}>Collected</div>
          <div style={{ ...styles.financialValue, ...styles.financialValueCollected }}>
            {formatCurrency(fund.collected_amount)}
          </div>
        </div>
        <div style={styles.financialItem}>
          <div style={styles.financialLabel}>Spent</div>
          <div style={{ ...styles.financialValue, ...styles.financialValueSpent }}>
            {formatCurrency(fund.spent_amount)}
          </div>
        </div>
        <div style={styles.financialItem}>
          <div style={styles.financialLabel}>Balance</div>
          <div style={{ ...styles.financialValue, ...styles.financialValueBalance }}>
            {formatCurrency(fund.balance)}
          </div>
        </div>
      </div>

      <div style={styles.metaRow}>
        <span style={styles.metaItem}>
          Donations <span style={styles.metaValue}>{fund.donation_count}</span>
        </span>
        <span style={styles.metaItem}>
          Expenses <span style={styles.metaValue}>{fund.expense_count}</span>
        </span>
        <span style={styles.metaItem}>
          Created <span style={styles.metaValue}>{formatDate(fund.created_at)}</span>
        </span>
      </div>

      <div style={styles.actions}>
        <button
          style={{ ...styles.actionButton, ...styles.actionButtonPrimary }}
          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.primary)}
          onClick={() => onView(fund.id)}
        >
          View
        </button>
        {!isArchived && (
          <button
            style={{ ...styles.actionButton, ...styles.actionButtonOutline }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = COLORS.primary;
              e.currentTarget.style.color = COLORS.primary;
              e.currentTarget.style.background = COLORS.primaryLight;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = COLORS.border;
              e.currentTarget.style.color = COLORS.textSecondary;
              e.currentTarget.style.background = "transparent";
            }}
            onClick={() => onEdit(fund.id)}
          >
            Edit
          </button>
        )}
        <button
          style={{ ...styles.actionButton, ...styles.actionButtonOutline }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = COLORS.primary;
            e.currentTarget.style.color = COLORS.primary;
            e.currentTarget.style.background = COLORS.primaryLight;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = COLORS.border;
            e.currentTarget.style.color = COLORS.textSecondary;
            e.currentTarget.style.background = "transparent";
          }}
          onClick={() => onReport(fund.id)}
        >
          Report
        </button>
        {!isArchived && (
          <button
            style={{ ...styles.actionButton, ...styles.actionButtonDanger }}
            onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.dangerLight)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => onArchive(fund.id)}
          >
            Archive
          </button>
        )}
      </div>
    </div>
  );
};

export default FundCard;