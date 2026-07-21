import React, { useState, useRef, useEffect } from "react";
import { COLORS } from "../theme/colors";
import { createAnnouncement } from "../api/announcement";
import type { CreateAnnouncementPayload } from "../types/announcement";
import api from "../api/axios";

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

// ─── Props ──────────────────────────────────────────────────────────────────

interface AnnouncementModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const _BACKEND_ROOT = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/api\/?$/, "");
const toAbsUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${_BACKEND_ROOT}${url.startsWith("/") ? "" : "/"}${url}`;
};

const uploadFile = async (file: File, type: "image" | "audio"): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);
  const endpoint = type === "image" ? "/upload/image" : "/upload/audio";
  const { data } = await api.post(endpoint, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.url;
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,17,21,0.5)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    animation: "fadeIn 0.2s ease",
  },
  // Modal is now height-capped and internally scrollable — this is the fix
  // for content pushing the dialog past the viewport.
  modal: {
    background: COLORS.surface,
    borderRadius: "18px",
    width: "100%",
    maxWidth: "560px",
    maxHeight: "88vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 20px 50px rgba(0,0,0,0.22)",
    animation: "slideUp 0.25s ease",
  },
  header: {
    flexShrink: 0,
    padding: "18px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: `1px solid ${COLORS.divider}`,
  },
  title: {
    fontSize: "17px",
    fontWeight: 700,
    color: COLORS.text,
    letterSpacing: "-0.01em",
  },
  closeBtn: {
    width: "30px",
    height: "30px",
    borderRadius: "8px",
    border: "none",
    background: COLORS.backgroundAlt,
    cursor: "pointer",
    fontSize: "15px",
    color: COLORS.textSecondary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s ease",
    flexShrink: 0,
  },
  body: {
    padding: "18px 20px",
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
  },
  formGroup: { marginBottom: "14px" },
  label: {
    display: "block",
    fontSize: "12.5px",
    fontWeight: 600,
    color: COLORS.textSecondary,
    marginBottom: "6px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  required: { color: COLORS.danger, marginLeft: "2px" },
  input: {
    width: "100%",
    height: "40px",
    padding: "0 12px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "9px",
    background: COLORS.backgroundAlt,
    fontSize: "14px",
    outline: "none",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    color: COLORS.text,
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "9px",
    background: COLORS.backgroundAlt,
    fontSize: "14px",
    outline: "none",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    color: COLORS.text,
    resize: "vertical",
    minHeight: "70px",
    boxSizing: "border-box",
    fontFamily: "inherit",
    lineHeight: 1.5,
  },
  row2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    marginBottom: "4px",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 0",
    marginBottom: "14px",
  },
  toggleLabel: {
    fontSize: "13.5px",
    fontWeight: 600,
    color: COLORS.text,
  },
  toggle: {
    position: "relative" as const,
    width: "38px",
    height: "21px",
    background: COLORS.border,
    borderRadius: "11px",
    cursor: "pointer",
    transition: "background 0.2s ease",
    flexShrink: 0,
  },
  toggleActive: {
    background: COLORS.primary,
  },
  toggleKnob: {
    position: "absolute" as const,
    top: "2px",
    left: "2px",
    width: "17px",
    height: "17px",
    borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.2s ease",
    boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
  },
  toggleKnobActive: {
    transform: "translateX(17px)",
  },
  uploadArea: {
    border: `1.5px dashed ${COLORS.border}`,
    borderRadius: "9px",
    padding: "8px",
    textAlign: "center" as const,
    cursor: "pointer",
    color: COLORS.textMuted,
    fontSize: "12.5px",
    fontWeight: 500,
    background: COLORS.backgroundAlt,
    transition: "border-color 0.15s ease",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadPreview: {
    width: "100%",
    height: "90px",
    objectFit: "cover" as const,
    borderRadius: "8px",
  },
  audioPreview: {
    width: "100%",
    height: "34px",
  },
  previewSection: {
    marginTop: "18px",
    paddingTop: "14px",
    borderTop: `1px solid ${COLORS.divider}`,
  },
  previewLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: COLORS.textMuted,
    marginBottom: "8px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  previewCard: {
    background: COLORS.backgroundAlt,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    overflow: "hidden",
    padding: "12px",
  },
  previewTitle: {
    fontSize: "14.5px",
    fontWeight: 600,
    color: COLORS.text,
    marginBottom: "3px",
  },
  previewBody: {
    fontSize: "13px",
    color: COLORS.textSecondary,
    lineHeight: 1.45,
  },
  previewImage: {
    width: "100%",
    height: "130px",
    objectFit: "cover" as const,
    borderRadius: "8px",
    marginTop: "8px",
  },
  previewMeta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "8px",
    fontSize: "11.5px",
    color: COLORS.textMuted,
  },
  previewPinned: {
    background: COLORS.accentLight,
    color: COLORS.accent,
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "10px",
    fontWeight: 700,
  },
  errorBanner: {
    background: COLORS.dangerLight,
    color: COLORS.danger,
    padding: "9px 12px",
    borderRadius: "9px",
    marginBottom: "14px",
    fontSize: "13px",
    fontWeight: 500,
  },
  submitRow: {
    flexShrink: 0,
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    padding: "14px 20px",
    borderTop: `1px solid ${COLORS.divider}`,
    background: COLORS.surface,
  },
  btnPrimary: {
    height: "38px",
    padding: "0 18px",
    borderRadius: "9px",
    background: COLORS.primary,
    color: "#fff",
    fontWeight: 600,
    fontSize: "13.5px",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    transition: "background 0.15s ease",
    boxShadow: COLORS.shadowPrimary,
  },
  btnOutline: {
    height: "38px",
    padding: "0 18px",
    borderRadius: "9px",
    border: `1px solid ${COLORS.border}`,
    background: "transparent",
    fontSize: "13.5px",
    fontWeight: 500,
    color: COLORS.textSecondary,
    cursor: "pointer",
    transition: "background 0.15s ease, border-color 0.15s ease",
  },
  removeBtn: {
    height: "24px",
    padding: "0 10px",
    borderRadius: "6px",
    border: "none",
    background: COLORS.dangerLight,
    color: COLORS.danger,
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.15s ease",
    marginTop: "6px",
  },
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
  `;
  document.head.appendChild(el);
};

// ─── Component ─────────────────────────────────────────────────────────────

interface Member { id: number | null; name: string; phone: string; role?: string; can_push?: boolean; }

const AnnouncementModal: React.FC<AnnouncementModalProps> = ({ open, onClose, onSuccess }) => {
  const isMobile = useMediaQuery("(max-width: 600px)");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Target user
  const [searchResults, setSearchResults] = useState<Member[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [targetUserId, setTargetUserId] = useState<number | null>(null);
  const [targetName, setTargetName] = useState<string>("");
  const [showMemberDrop, setShowMemberDrop] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    injectKeyframes();
  }, []);

  // Live search users from backend
  const handleMemberSearch = (val: string) => {
    setMemberSearch(val);
    setShowMemberDrop(true);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!val.trim()) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(() => {
      api.get("/admin/search-users", { params: { q: val } })
        .then((res) => setSearchResults(res.data || []))
        .catch(() => setSearchResults([]));
    }, 250);
  };

  // Reset on open
  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setPinned(false);
      setImageFile(null);
      setImageUrl(null);
      setAudioFile(null);
      setAudioUrl(null);
      setError(null);
      setTargetUserId(null);
      setTargetName("");
      setMemberSearch("");
      setSearchResults([]);
      setShowMemberDrop(false);
    }
  }, [open]);

  const modalStyle = {
    ...S.modal,
    maxHeight: isMobile ? "92vh" : "88vh",
    maxWidth: isMobile ? "100%" : "560px",
  };
  const headerStyle = {
    ...S.header,
    padding: isMobile ? "16px 16px" : "18px 20px",
  };
  const bodyStyle = {
    ...S.body,
    padding: isMobile ? "16px" : "18px 20px",
  };
  const row2Style = {
    ...S.row2,
    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
  };
  const submitRowStyle = {
    ...S.submitRow,
    padding: isMobile ? "12px 16px" : "14px 20px",
  };

  // Upload handlers
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setUploading(true);
    try {
      const url = await uploadFile(file, "image");
      setImageUrl(url);
    } catch {
      setError("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleAudioChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    setUploading(true);
    try {
      const url = await uploadFile(file, "audio");
      setAudioUrl(url);
    } catch {
      setError("Failed to upload audio");
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImageUrl(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const removeAudio = () => {
    setAudioFile(null);
    setAudioUrl(null);
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  // Submit
  const handleSubmit = async () => {
    setError(null);
    if (!title.trim()) { setError("Title is required"); return; }
    if (!body.trim()) { setError("Body is required"); return; }

    const payload: CreateAnnouncementPayload = {
      title: title.trim(),
      body: body.trim(),
      pinned,
      image_url: imageUrl ?? undefined,
      audio_url: audioUrl ?? undefined,
      target_user_id: targetUserId ?? null,
    };

    setSubmitting(true);
    try {
      await createAnnouncement(payload);
      onSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err.message ?? "Failed to create announcement");
    } finally {
      setSubmitting(false);
    }
  };

  // Preview
  const renderPreview = () => {
    const hasContent = title.trim() || body.trim() || imageUrl || audioUrl;
    if (!hasContent) {
      return (
        <div style={{ fontSize: "12.5px", color: COLORS.textMuted, padding: "4px 0" }}>
          Preview will appear here once you add content.
        </div>
      );
    }
    return (
      <div style={S.previewCard}>
        {(pinned || targetUserId) && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginBottom: "2px" }}>
            {pinned && <span style={S.previewPinned}>Pinned</span>}
            {targetUserId && (
              <span style={{ ...S.previewPinned, background: COLORS.backgroundAlt, color: COLORS.textSecondary }}>
                Private · {targetName.split(" · ")[0]}
              </span>
            )}
          </div>
        )}
        {imageUrl && <img src={toAbsUrl(imageUrl)!} alt="Preview" style={S.previewImage} />}
        <div style={S.previewTitle}>{title || "Untitled"}</div>
        <div style={S.previewBody}>{body || "No description"}</div>
        {audioUrl && (
          <audio controls style={S.audioPreview}>
            <source src={audioUrl} />
          </audio>
        )}
        <div style={S.previewMeta}>
          <span>Posted by You</span>
          <span>{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
        </div>
      </div>
    );
  };

  if (!open) return null;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={S.title}>New Announcement</div>
          <button
            style={S.closeBtn}
            onClick={onClose}
            onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
            onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.backgroundAlt)}
          >
            ✕
          </button>
        </div>

        <div style={bodyStyle}>
          {error && <div style={S.errorBanner}>⚠ {error}</div>}

          <div style={S.formGroup}>
            <label style={S.label}>Title <span style={S.required}>*</span></label>
            <input
              style={S.input}
              placeholder="Announcement title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`)}
              onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
            />
          </div>

          <div style={S.formGroup}>
            <label style={S.label}>Body <span style={S.required}>*</span></label>
            <textarea
              style={S.textarea}
              placeholder="Full announcement text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`)}
              onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
            />
          </div>

          <div style={S.toggleRow}>
            <div
              style={{ ...S.toggle, ...(pinned ? S.toggleActive : {}) }}
              onClick={() => setPinned(!pinned)}
            >
              <div style={{ ...S.toggleKnob, ...(pinned ? S.toggleKnobActive : {}) }} />
            </div>
            <span style={S.toggleLabel}>Pin this announcement</span>
            <span style={{ fontSize: "12px", color: COLORS.textMuted, marginLeft: "auto" }}>
              {pinned ? "Stays at top" : "Normal order"}
            </span>
          </div>

          {/* ── Target user (optional) ─────────────────────────── */}
          <div style={S.formGroup}>
            <label style={S.label}>
              Send To
              <span style={{ ...S.required, color: COLORS.textMuted, fontWeight: 400, marginLeft: 6, textTransform: "none", fontSize: "11px" }}>
                (optional — leave empty to send to everyone)
              </span>
            </label>
            {targetUserId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  flex: 1, height: 40, padding: "0 12px", border: `1.5px solid ${COLORS.primary}`,
                  borderRadius: 9, background: COLORS.primaryLight, fontSize: 14, color: COLORS.text,
                  display: "flex", alignItems: "center", fontWeight: 600,
                }}>
                  {targetName}
                </div>
                <button
                  style={{ ...S.removeBtn, marginTop: 0, height: 38, padding: "0 14px", fontSize: 12 }}
                  onClick={() => { setTargetUserId(null); setTargetName(""); setMemberSearch(""); }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  style={S.input}
                  placeholder="Search by name or phone number…"
                  value={memberSearch}
                  onChange={(e) => handleMemberSearch(e.target.value)}
                  onFocus={() => memberSearch.trim() && setShowMemberDrop(true)}
                  onBlur={() => setTimeout(() => setShowMemberDrop(false), 200)}
                />
                {showMemberDrop && searchResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 9999,
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                    borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                    overflow: "hidden",
                  }}>
                    {searchResults.map((m, i) => {
                      const canSelect = m.id !== null;
                      return (
                        <div
                          key={m.id ?? `head-${i}`}
                          onMouseDown={() => {
                            if (!canSelect) return;
                            setTargetUserId(m.id as number);
                            setTargetName(`${m.name} · ${m.phone}`);
                            setMemberSearch("");
                            setSearchResults([]);
                            setShowMemberDrop(false);
                          }}
                          style={{
                            padding: "10px 14px", fontSize: 13,
                            borderBottom: `1px solid ${COLORS.divider}`,
                            color: canSelect ? COLORS.text : COLORS.textMuted,
                            cursor: canSelect ? "pointer" : "not-allowed",
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            opacity: canSelect ? 1 : 0.6,
                          }}
                          onMouseEnter={(e) => { if (canSelect) e.currentTarget.style.background = COLORS.primaryLight; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <span>
                            <span style={{ fontWeight: 600 }}>{m.name}</span>
                            <span style={{ color: COLORS.textMuted, marginLeft: 8, fontSize: 12 }}>{m.phone}</span>
                          </span>
                          <span style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "capitalize" }}>
                            {canSelect ? m.role : "App not installed"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={row2Style}>
            <div style={S.formGroup}>
              <label style={S.label}>Image</label>
              {imageUrl ? (
                <div>
                  <img src={toAbsUrl(imageUrl)!} alt="Uploaded" style={S.uploadPreview} />
                  <button style={S.removeBtn} onClick={removeImage}>Remove</button>
                </div>
              ) : (
                <label style={{ ...S.uploadArea, opacity: uploading ? 0.6 : 1 }}>
                  <input type="file" accept="image/*" style={{ display: "none" }} ref={imageInputRef} onChange={handleImageChange} disabled={uploading} />
                  {uploading ? "Uploading…" : "Choose Image"}
                </label>
              )}
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Audio</label>
              {audioUrl ? (
                <div>
                  <audio controls style={S.audioPreview}>
                    <source src={audioUrl} />
                  </audio>
                  <button style={S.removeBtn} onClick={removeAudio}>Remove</button>
                </div>
              ) : (
                <label style={{ ...S.uploadArea, opacity: uploading ? 0.6 : 1 }}>
                  <input type="file" accept="audio/*" style={{ display: "none" }} ref={audioInputRef} onChange={handleAudioChange} disabled={uploading} />
                  {uploading ? "Uploading…" : "Choose Audio"}
                </label>
              )}
            </div>
          </div>

          <div style={S.previewSection}>
            <div style={S.previewLabel}>Preview</div>
            {renderPreview()}
          </div>
        </div>

        <div style={submitRowStyle}>
          <button
            style={S.btnOutline}
            onClick={onClose}
            onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Cancel
          </button>
          <button
            style={{ ...S.btnPrimary, opacity: submitting ? 0.7 : 1 }}
            onClick={handleSubmit}
            disabled={submitting}
            onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.primary)}
          >
            {submitting ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementModal;