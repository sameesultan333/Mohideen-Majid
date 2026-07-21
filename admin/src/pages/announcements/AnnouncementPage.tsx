import React, { useEffect, useState, useCallback, useMemo } from "react";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import {
  getAnnouncements,
  deleteAnnouncement,
} from "../../api/announcement";
import type { Announcement } from "../../types/announcement";
import AnnouncementCard from "../../components/AnnouncementCard";
import AnnouncementModal from "../../components/AnnouncementModal";
import DeleteAnnouncementModal from "../../components/DeleteAnnouncementModal";
import AnnouncementImagePreview from "../../components/AnnouncementImagePreview";

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

const CACHE_ANNOUNCEMENTS_KEY = "announcements_cache";

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
  page: { padding: "16px", maxWidth: "900px", margin: "0 auto" },
  header: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", gap: "12px" },
  title: { fontFamily: TYPOGRAPHY.fontDisplay, fontSize: "32px", fontWeight: 400, letterSpacing: "0", color: COLORS.text, marginBottom: "4px" },
  subtitle: { fontSize: "15px", color: COLORS.textSecondary },
  btnPrimary: { height: "44px", padding: "0 24px", borderRadius: "12px", background: COLORS.primary, color: "#fff", fontWeight: 600, fontSize: "14px", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px", flexShrink: 0, boxShadow: COLORS.shadowPrimary, transition: "background 0.2s, transform 0.1s" },
  toolbar: { display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "20px", alignItems: "center" },
  searchInput: { flex: "1 1 200px", minWidth: "160px", height: "42px", padding: "0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.surface, fontSize: "14px", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s", color: COLORS.text },
  filterSelect: { height: "42px", padding: "0 32px 0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.surface, fontSize: "14px", outline: "none", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", minWidth: "120px", cursor: "pointer", color: COLORS.text },
  btnOutline: { height: "42px", padding: "0 16px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, background: COLORS.surface, cursor: "pointer", fontSize: "14px", fontWeight: 500, color: COLORS.textSecondary, transition: "background 0.2s" },
  feed: { display: "flex", flexDirection: "column", gap: "12px" },
  emptyState: { textAlign: "center", padding: "60px 20px", color: COLORS.textSecondary },
  emptyTitle: { fontSize: "20px", fontWeight: 600, color: COLORS.text, marginBottom: "8px" },
  errorBanner: { background: COLORS.dangerLight, color: COLORS.danger, padding: "12px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.danger}`, animation: "fadeIn 0.3s ease" },
  offlineBanner: { background: COLORS.warningLight, color: COLORS.warning, padding: "8px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.warning}`, display: "flex", alignItems: "center", gap: "8px", animation: "fadeIn 0.3s ease" },
  // Skeleton
  skeleton: { background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", borderRadius: "16px" },
  skeletonCard: { padding: "20px", border: `1px solid ${COLORS.border}`, background: COLORS.surface, borderRadius: "16px", minHeight: "120px" },
};

// ─── Inject keyframes ──────────────────────────────────────────────────────

const keyframes = document.createElement("style");
keyframes.innerHTML = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
document.head.appendChild(keyframes);

// ─── Component ─────────────────────────────────────────────────────────────

const AnnouncementPage: React.FC = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pinned" | "today" | "week">("all");

  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // ─── Fetch announcements ──────────────────────────────────────────────────

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFromCache(false);
    try {
      const data = await getAnnouncements();
      setAnnouncements(data);
      setCache(CACHE_ANNOUNCEMENTS_KEY, data);
    } catch (err: any) {
      const cached = getCache<Announcement[]>(CACHE_ANNOUNCEMENTS_KEY);
      if (cached && cached.length > 0) {
        setAnnouncements(cached);
        setFromCache(true);
        setError(null);
      } else {
        setError(err?.response?.data?.detail ?? err.message ?? "Failed to load announcements");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  // ─── Filter and group ─────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = announcements;

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.body.toLowerCase().includes(q) ||
          a.posted_by.toLowerCase().includes(q)
      );
    }

    // Filter
    if (filter === "pinned") {
      result = result.filter((a) => a.pinned);
    } else if (filter === "today") {
      const today = new Date().toDateString();
      result = result.filter((a) => new Date(a.created_at).toDateString() === today);
    } else if (filter === "week") {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      result = result.filter((a) => new Date(a.created_at) >= weekAgo);
    }

    return result;
  }, [announcements, search, filter]);

  // ─── Group by date ───────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const groups: { label: string; items: Announcement[] }[] = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    const pinned = filtered.filter((a) => a.pinned);
    const unpinned = filtered.filter((a) => !a.pinned);

    if (pinned.length > 0) {
      groups.push({ label: "Pinned", items: pinned });
    }

    const todayItems = unpinned.filter((a) => new Date(a.created_at).toDateString() === today);
    if (todayItems.length > 0) {
      groups.push({ label: "Today", items: todayItems });
    }

    const yesterdayItems = unpinned.filter((a) => new Date(a.created_at).toDateString() === yesterday);
    if (yesterdayItems.length > 0) {
      groups.push({ label: "Yesterday", items: yesterdayItems });
    }

    const older = unpinned.filter(
      (a) =>
        new Date(a.created_at).toDateString() !== today &&
        new Date(a.created_at).toDateString() !== yesterday
    );
    if (older.length > 0) {
      groups.push({ label: "Earlier", items: older });
    }

    return groups;
  }, [filtered]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAnnouncement(deleteTarget.id);
      setDeleteTarget(null);
      await fetchAnnouncements();
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? "Failed to delete announcement");
    }
  };

  // ─── Loading skeleton ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <div>
            <div style={S.title}>Announcements</div>
            <div style={S.subtitle}>Loading mosque notices…</div>
          </div>
        </div>
        <div style={S.toolbar}>
          <div style={{ ...S.skeleton, height: "42px", flex: "1 1 200px" }} />
          <div style={{ ...S.skeleton, height: "42px", width: "120px" }} />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} style={S.skeletonCard}>
            <div style={{ ...S.skeleton, height: "20px", width: "60%", marginBottom: "12px" }} />
            <div style={{ ...S.skeleton, height: "16px", width: "80%", marginBottom: "8px" }} />
            <div style={{ ...S.skeleton, height: "16px", width: "40%" }} />
          </div>
        ))}
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Announcements</h1>
          <p style={S.subtitle}>Latest mosque notices and updates.</p>
        </div>
        <button
          style={S.btnPrimary}
          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.primary)}
          onClick={() => setShowModal(true)}
        >
          <span>+</span> New Announcement
        </button>
      </div>

      {fromCache && (
        <div style={S.offlineBanner}>
          <span>●</span> Viewing cached data
        </div>
      )}
      {error && <div style={S.errorBanner}>⚠ {error}</div>}

      <div style={S.toolbar}>
        <input
          style={S.searchInput}
          placeholder="Search announcements…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`)}
          onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
        />
        <select
          style={S.filterSelect}
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">All</option>
          <option value="pinned">Pinned</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
        </select>
        <button
          style={S.btnOutline}
          onClick={fetchAnnouncements}
          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
          onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.surface)}
        >
          ⟳
        </button>
      </div>

      {filtered.length === 0 ? (
        <div style={S.emptyState}>
          <div style={S.emptyTitle}>No announcements yet</div>
          <p style={{ color: COLORS.textSecondary }}>
            {search || filter !== "all"
              ? "Try adjusting your search or filters."
              : "Create your first announcement to get started."}
          </p>
          {!search && filter === "all" && (
            <button
              style={{ ...S.btnPrimary, marginTop: "16px", display: "inline-flex" }}
              onClick={() => setShowModal(true)}
            >
              + Create Announcement
            </button>
          )}
        </div>
      ) : (
        <div style={S.feed}>
          {grouped.map((group) => (
            <div key={group.label}>
              {group.label !== "Pinned" && (
                <div style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px", marginTop: "4px" }}>
                  {group.label}
                </div>
              )}
              {group.items.map((announcement) => (
                <AnnouncementCard
                  key={announcement.id}
                  announcement={announcement}
                  onDelete={() => setDeleteTarget(announcement)}
                  onImagePreview={(url) => setPreviewImage(url)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <AnnouncementModal
          open={showModal}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            fetchAnnouncements();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteAnnouncementModal
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title={deleteTarget.title}
        />
      )}

      {previewImage && (
        <AnnouncementImagePreview
          src={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
};

export default AnnouncementPage;