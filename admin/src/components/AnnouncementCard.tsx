import React, { useState } from "react";

import { COLORS } from "../theme/colors";

import type { Announcement } from "../types/announcement";

const _BACKEND_ROOT = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/api\/?$/, "");

function buildMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${_BACKEND_ROOT}${url.startsWith("/") ? "" : "/"}${url}`;
}



interface AnnouncementCardProps {

  announcement: Announcement;

  onDelete: () => void;

  onImagePreview: (url: string) => void;

}



// Backend returns UTC datetimes without timezone suffix — append "Z" so the
// browser treats them as UTC and converts to local time (IST +5:30) correctly.
const parseUtc = (s: string): Date => {
  const clean = s.trim().replace(" ", "T").split(".")[0];
  return new Date(clean + "Z");
};

const fmtDate = (s: string) => {

  const d = parseUtc(s);

  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diff = Math.floor((today.getTime() - date.getTime()) / 86400000);

  if (diff === 0) return `Today at ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;

  if (diff === 1) return `Yesterday at ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;

  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

};



const S: Record<string, React.CSSProperties> = {

  card: {

    background: COLORS.surface,

    border: `1px solid ${COLORS.border}`,

    borderRadius: "16px",

    padding: "16px",

    boxShadow: COLORS.shadowSm,

    transition: "box-shadow 0.3s, transform 0.3s",

    animation: "fadeIn 0.3s ease",

    overflow: "visible",

    position: "relative" as const,

  },

  pinnedBadge: {

    background: COLORS.accentLight,

    color: COLORS.accent,

    padding: "2px 10px",

    borderRadius: "999px",

    fontSize: "11px",

    fontWeight: 600,

    display: "inline-block",

    marginBottom: "6px",

  },

  title: {

    fontSize: "clamp(16px, 2.5vw, 18px)",

    fontWeight: 600,

    color: COLORS.text,

    marginBottom: "4px",

    wordBreak: "break-word",

    overflowWrap: "break-word",

    overflow: "visible",

  },

  body: {

    fontSize: "clamp(13px, 2vw, 14px)",

    color: COLORS.textSecondary,

    lineHeight: 1.6,

    marginBottom: "10px",

    wordBreak: "break-word",

    overflowWrap: "break-word",

    overflow: "visible",

  },

  image: {

    width: "100%",

    maxHeight: "200px",

    objectFit: "cover" as const,

    borderRadius: "12px",

    marginBottom: "10px",

    cursor: "pointer",

    transition: "opacity 0.2s",

  },

  audio: {

    width: "100%",

    marginBottom: "10px",

    borderRadius: "8px",

  },

  footer: {

    display: "flex",

    justifyContent: "space-between",

    alignItems: "center",

    flexWrap: "wrap",

    gap: "8px",

    paddingTop: "10px",

    borderTop: `1px solid ${COLORS.divider}`,

    overflow: "visible",

  },

  meta: {

    fontSize: "13px",

    color: COLORS.textMuted,

  },

  postedBy: {

    fontWeight: 500,

    color: COLORS.textSecondary,

  },

  deleteBtn: {

    height: "32px",

    padding: "0 12px",

    borderRadius: "8px",

    border: "none",

    background: "transparent",

    color: COLORS.textMuted,

    fontSize: "13px",

    cursor: "pointer",

    transition: "color 0.2s, background 0.2s",

  },

};



const AnnouncementCard: React.FC<AnnouncementCardProps> = ({

  announcement,

  onDelete,

  onImagePreview,

}) => {

  const [imageLoaded, setImageLoaded] = useState(false);

  const imageAbsUrl = buildMediaUrl(announcement.image_url);
  const audioAbsUrl = buildMediaUrl(announcement.audio_url);

  return (

    <div

      style={S.card}

      onMouseEnter={(e) => {

        e.currentTarget.style.boxShadow = COLORS.shadow;

        e.currentTarget.style.transform = "translateY(-2px)";

      }}

      onMouseLeave={(e) => {

        e.currentTarget.style.boxShadow = COLORS.shadowSm;

        e.currentTarget.style.transform = "none";

      }}

    >

      {announcement.pinned && <div style={S.pinnedBadge}>Pinned</div>}

      <div style={S.title}>{announcement.title}</div>

      <div style={S.body}>{announcement.body}</div>



      {imageAbsUrl && (

        <img

          src={imageAbsUrl}

          alt=""

          style={{ ...S.image, opacity: imageLoaded ? 1 : 0.5 }}

          onLoad={() => setImageLoaded(true)}

          onClick={() => onImagePreview(imageAbsUrl)}

          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}

          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}

        />

      )}



      {audioAbsUrl && (

        <audio controls style={S.audio}>

          <source src={audioAbsUrl} />

        </audio>

      )}



      <div style={S.footer}>

        <div style={S.meta}>

          Posted by <span style={S.postedBy}>{announcement.posted_by}</span>

          <span style={{ marginLeft: "6px" }}>·</span>

          <span style={{ marginLeft: "6px" }}>{fmtDate(announcement.created_at)}</span>

        </div>

        <button

          style={S.deleteBtn}

          onMouseEnter={(e) => {

            e.currentTarget.style.color = COLORS.danger;

            e.currentTarget.style.background = COLORS.dangerLight;

          }}

          onMouseLeave={(e) => {

            e.currentTarget.style.color = COLORS.textMuted;

            e.currentTarget.style.background = "transparent";

          }}

          onClick={onDelete}

        >

          Delete

        </button>

      </div>

    </div>

  );

};



export default AnnouncementCard;