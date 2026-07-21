import React, { useState } from "react";
import { COLORS } from "../theme/colors";

// ─── Props ──────────────────────────────────────────────────────────────────

interface DeleteAnnouncementModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 2000, // ✅ Higher than everything
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    animation: "fadeIn 0.25s ease",
  },
  modal: {
    background: COLORS.surface,
    borderRadius: "20px",
    maxWidth: "420px",
    width: "100%",
    padding: "28px 24px 24px",
    boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
    animation: "slideUp 0.3s ease",
    position: "relative" as const,
    zIndex: 2001,
  },
  icon: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: COLORS.dangerLight,
    color: COLORS.danger,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 12px",
    fontSize: "24px",
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
    marginBottom: "24px",
  },
  highlight: {
    fontWeight: 600,
    color: COLORS.text,
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
  btnDanger: {
    background: COLORS.danger,
    color: "#fff",
  },
  btnDangerHover: {
    background: "#B73434", // ✅ Fallback – darker red
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
};

// ─── Inject keyframes ──────────────────────────────────────────────────────

const keyframes = document.createElement("style");
keyframes.innerHTML = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
`;
document.head.appendChild(keyframes);

// ─── Component ─────────────────────────────────────────────────────────────

const DeleteAnnouncementModal: React.FC<DeleteAnnouncementModalProps> = ({
  open,
  onClose,
  onConfirm,
  title,
}) => {
  const [loading, setLoading] = useState(false);
  const [hoverDanger, setHoverDanger] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.icon}>✕</div>
        <div style={S.title}>Delete Announcement</div>
        <p style={S.description}>
          Are you sure you want to delete "<span style={S.highlight}>{title}</span>"?
          <br />
          Members will no longer see this notice.
        </p>
        <div style={S.actions}>
          <button
            style={S.btnCancel}
            onClick={onClose}
            disabled={loading}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = COLORS.textSecondary;
              e.currentTarget.style.color = COLORS.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = COLORS.border;
              e.currentTarget.style.color = COLORS.textSecondary;
            }}
          >
            Cancel
          </button>
          <button
            style={{
              ...S.btn,
              ...S.btnDanger,
              ...(loading ? S.btnDisabled : {}),
              ...(hoverDanger && !loading ? S.btnDangerHover : {}),
            }}
            onMouseEnter={() => setHoverDanger(true)}
            onMouseLeave={() => setHoverDanger(false)}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteAnnouncementModal;