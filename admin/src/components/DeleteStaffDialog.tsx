import React, { useState } from "react";
import { COLORS } from "../theme/colors";

interface DeleteStaffDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  staffName: string;
  staffRole: string;
  title?: string;
}

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
    padding: "24px",
    boxShadow: COLORS.shadowLg,
    animation: "slideUp 0.25s ease",
  },
  icon: {
    fontSize: "48px",
    textAlign: "center",
    marginBottom: "12px",
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
    marginBottom: "20px",
    lineHeight: 1.6,
  },
  highlight: {
    fontWeight: 600,
    color: COLORS.text,
  },
  bulletList: {
    textAlign: "left",
    margin: "16px 0 24px",
    paddingLeft: "20px",
    color: COLORS.textSecondary,
    fontSize: "14px",
    lineHeight: 1.8,
  },
  bulletItem: {
    listStyleType: "disc",
  },
  actions: {
    display: "flex",
    gap: "12px",
    justifyContent: "center",
    marginTop: "8px",
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
    gap: "8px",
    flex: 1,
    justifyContent: "center",
  },
  btnCancel: {
    background: "transparent",
    color: COLORS.textSecondary,
    border: `1px solid ${COLORS.border}`,
  },
  btnDanger: {
    background: COLORS.danger,
    color: "#fff",
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
};

// Reuse animations (already injected in AddEditStaffDialog, but safe to re-inject)
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

const DeleteStaffDialog: React.FC<DeleteStaffDialogProps> = ({
  open,
  onClose,
  onConfirm,
  staffName,
  staffRole,
  title = "Delete Staff Account",
}) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } catch (err) {
      // Error handled in parent
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const roleDisplay = staffRole.charAt(0).toUpperCase() + staffRole.slice(1);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.icon}>⚠️</div>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.description}>
          You are about to delete <span style={styles.highlight}>{staffName}</span>{" "}
          ({roleDisplay}). This action is <strong>permanent</strong> and cannot be undone.
        </p>
        <ul style={styles.bulletList}>
          <li style={styles.bulletItem}>The account will be permanently removed.</li>
          <li style={styles.bulletItem}>All active sessions will be revoked.</li>
          <li style={styles.bulletItem}>Any associated data will be retained for audit.</li>
        </ul>
        <div style={styles.actions}>
          <button
            style={{ ...styles.btn, ...styles.btnCancel }}
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            style={{
              ...styles.btn,
              ...styles.btnDanger,
              ...(loading ? styles.btnDisabled : {}),
            }}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteStaffDialog;