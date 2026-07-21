import React, { useEffect, useRef } from "react";
import { COLORS } from "../theme/colors";

// ─── Props ──────────────────────────────────────────────────────────────────

interface AnnouncementImagePreviewProps {
  src: string;
  onClose: () => void;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.85)",
    zIndex: 2000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    animation: "fadeIn 0.25s ease",
    cursor: "pointer",
  },
  image: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain" as const,
    borderRadius: "8px",
    boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
    animation: "zoomIn 0.3s ease",
    cursor: "default",
  },
  closeBtn: {
    position: "fixed" as const,
    top: "20px",
    right: "20px",
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    border: "none",
    background: "rgba(255,255,255,0.15)",
    backdropFilter: "blur(8px)",
    color: "#fff",
    fontSize: "24px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
    zIndex: 2001,
  },
};

// ─── Inject keyframes ──────────────────────────────────────────────────────

const keyframes = document.createElement("style");
keyframes.innerHTML = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes zoomIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
`;
document.head.appendChild(keyframes);

// ─── Component ─────────────────────────────────────────────────────────────

const AnnouncementImagePreview: React.FC<AnnouncementImagePreviewProps> = ({ src, onClose }) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div style={S.overlay} ref={overlayRef} onClick={handleOverlayClick}>
      <button
        style={S.closeBtn}
        onClick={onClose}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.25)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
      >
        ✕
      </button>
      <img src={src} alt="Announcement preview" style={S.image} />
    </div>
  );
};

export default AnnouncementImagePreview;