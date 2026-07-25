import React, { useState } from "react";
import { COLORS } from "../theme/colors";

// ─── Props ────────────────────────────────────────────────────────────────

interface ArchiveFundModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  fundName: string;
  fundId?: number; // optional, for logging
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: COLORS.overlay,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "16px",
    animation: "fadeIn 0.2s ease",
  },
  dialog: {
    background: COLORS.surface,
    borderRadius: "16px",
    maxWidth: "420px",
    width: "100%",
    padding: "28px 24px 24px",
    boxShadow: COLORS.shadowLg,
    animation: "slideUp 0.25s ease",
  },
  iconWrapper: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "12px",
  },
  icon: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: COLORS.warningLight || "#FAF0DD",
    color: COLORS.warning || "#B07A1E",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "28px",
    fontWeight: 700,
  },
  title: {
    fontSize: "20px",
    fontWeight: 600,
    color: COLORS.text,
    textAlign: "center",
    marginBottom: "8px",
  },
  description: {
    fontSize: "15px",
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 1.6,
    marginBottom: "20px",
  },
  highlight: {
    fontWeight: 600,
    color: COLORS.text,
  },
  warningBox: {
    background: COLORS.warningLight || "#FAF0DD",
    border: `1px solid ${COLORS.warning || "#B07A1E"}`,
    borderRadius: "12px",
    padding: "14px 16px",
    marginBottom: "24px",
    fontSize: "14px",
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  warningIcon: {
    marginRight: "8px",
  },
  actions: {
    display: "flex",
    gap: "12px",
    justifyContent: "center",
  },
  btn: {
    height: "44px",
    padding: "0 24px",
    borderRadius: "12px",
    fontWeight: 600,
    fontSize: "14px",
    border: "none",
    cursor: "pointer",
    transition: "background 0.2s, transform 0.1s",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  btnCancel: {
    background: "transparent",
    color: COLORS.textSecondary,
    border: `1px solid ${COLORS.border}`,
  },
  btnCancelHover: {
    borderColor: COLORS.textSecondary,
    color: COLORS.text,
  },
  btnDanger: {
    background: COLORS.danger,
    color: "#fff",
  },
  btnDangerHover: {
    background: COLORS.danger || "#B73434",
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
};

// ─── Animations (reuse from existing) ──────────────────────────────────

const animationStyle = document.createElement("style");
animationStyle.innerHTML = `
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(animationStyle);

// ─── Component ──────────────────────────────────────────────────────────

const ArchiveFundModal: React.FC<ArchiveFundModalProps> = ({
  open,
  onClose,
  onConfirm,
  fundName,
}) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      // onConfirm handles closing on success
    } catch {
      // Error handled in parent
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.iconWrapper}>
          <div style={styles.icon}>⚠</div>
        </div>
        <h2 style={styles.title}>Archive Fund</h2>
        <p style={styles.description}>
          You are about to archive <span style={styles.highlight}>{fundName}</span>.
        </p>

        <div style={styles.warningBox}>
          <span style={styles.warningIcon}>⛔</span>
          No new donations or expenses will be allowed for this fund.
        </div>

        <div style={styles.actions}>
          <button
            type="button"
            style={styles.btnCancel}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = COLORS.textSecondary;
              e.currentTarget.style.color = COLORS.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = COLORS.border;
              e.currentTarget.style.color = COLORS.textSecondary;
            }}
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...styles.btn,
              ...styles.btnDanger,
              ...(loading ? styles.btnDisabled : {}),
            }}
            onMouseEnter={(e) => {
              if (!loading) e.currentTarget.style.background = COLORS.danger || "#B73434";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.danger;
            }}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Archiving..." : "Archive Fund"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArchiveFundModal;