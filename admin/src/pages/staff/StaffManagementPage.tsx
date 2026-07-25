import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Plus, Search, RefreshCw, MoreVertical, Pencil, Ban, CheckCircle2,
  Trash2, AlertTriangle, Users, X,
} from "lucide-react";
import type { Staff, CreateStaffPayload, UpdateStaffPayload } from "../../api/staff";
import {
  getStaff,
  createStaff,
  updateStaff,
  toggleStaffStatus,
  deleteStaff,
} from "../../api/staff";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import AddEditStaffDialog from "../../components/AddEditStaffDialog";
import DeleteStaffDialog from "../../components/DeleteStaffDialog";

// ─── Helpers ────────────────────────────────────────────────────────────────

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) setMatches(media.matches);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [matches, query]);
  return matches;
};

// SAFE: handle undefined/null names
const getInitials = (name: string | undefined | null) => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const formatDate = (dateString: string) => {
  if (!dateString) return "—";
  const d = new Date(dateString);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const ROLE_ORDER: Record<string, number> = {
  superadmin: 0,
  admin: 1,
  imam: 2,
  collector: 3,
  modhin: 4,
  watchman: 5,
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "20px 16px 90px",
    maxWidth: "1400px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "20px",
    gap: "12px",
  },
  headerLeft: {
    flex: "1 1 auto",
  },
  title: {
    fontFamily: TYPOGRAPHY.fontDisplay,
    fontSize: "32px",
    fontWeight: 400,
    letterSpacing: "0",
    color: COLORS.text,
    marginBottom: "3px",
  },
  subtitle: {
    fontSize: "13.5px",
    color: COLORS.textSecondary,
  },
  addButton: {
    flexShrink: 0,
    height: "42px",
    padding: "0 20px",
    borderRadius: "11px",
    background: COLORS.primary,
    color: "#fff",
    fontWeight: 600,
    fontSize: "14px",
    border: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    transition: "background 0.2s, transform 0.1s",
    cursor: "pointer",
    boxShadow: COLORS.shadowPrimary,
  },
  addButtonMobile: {
    position: "fixed",
    bottom: "24px",
    right: "16px",
    zIndex: 100,
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: COLORS.primary,
    color: "#fff",
    border: "none",
    boxShadow: COLORS.shadowPrimary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "background 0.2s, transform 0.1s",
  },
  stats: {
    display: "grid",
    gap: "10px",
    marginBottom: "18px",
  },
  statCard: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    padding: "14px",
    boxShadow: COLORS.shadowSm,
    transition: "box-shadow 0.2s, transform 0.2s",
    cursor: "default",
    minWidth: 0,
  },
  statNumber: {
    fontSize: "22px",
    fontWeight: 700,
    fontFamily: "'Fraunces', Georgia, serif",
    color: COLORS.text,
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: "12px",
    color: COLORS.textSecondary,
    marginTop: "3px",
  },
  toolbar: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    marginBottom: "16px",
  },
  toolbarRow: {
    display: "flex",
    gap: "8px",
  },
  searchInput: {
    flex: "1 1 auto",
    minWidth: 0,
    height: "40px",
    padding: "0 14px 0 36px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "10px",
    background: COLORS.surface,
    fontSize: "14px",
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
    boxSizing: "border-box",
    width: "100%",
  },
  filterSelect: {
    height: "40px",
    padding: "0 30px 0 12px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "10px",
    background: COLORS.surface,
    fontSize: "13.5px",
    outline: "none",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    cursor: "pointer",
    width: "100%",
    boxSizing: "border-box",
  },
  refreshButton: {
    height: "40px",
    width: "40px",
    flexShrink: 0,
    borderRadius: "10px",
    border: `1px solid ${COLORS.border}`,
    background: COLORS.surface,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: COLORS.textSecondary,
    transition: "background 0.2s",
  },
  tableWrapper: {
    overflowX: "auto",
    overflowY: "visible",
    borderRadius: "12px",
    border: `1px solid ${COLORS.border}`,
    background: COLORS.surface,
    boxShadow: COLORS.shadowSm,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "14px",
  },
  th: {
    textAlign: "left" as const,
    padding: "14px 16px",
    background: COLORS.tableHeader,
    color: COLORS.tableHeaderText,
    fontWeight: 600,
    fontSize: "13px",
    letterSpacing: "0.02em",
    borderBottom: `1px solid ${COLORS.tableBorder}`,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "14px 16px",
    borderBottom: `1px solid ${COLORS.tableBorder}`,
    verticalAlign: "middle",
  },
  avatar: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    background: COLORS.primaryLight,
    color: COLORS.primary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: "14px",
    flexShrink: 0,
  },
  roleChip: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "capitalize",
  },
  statusChip: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
  },
  actionsMenu: {
    position: "relative",
    display: "inline-block",
  },
  actionsButton: {
    background: "none",
    border: "none",
    padding: "6px",
    borderRadius: "8px",
    cursor: "pointer",
    color: COLORS.textMuted,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
  },
  actionsDropdown: {
    position: "fixed",
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    boxShadow: COLORS.shadowLg,
    minWidth: "170px",
    padding: "4px 0",
    zIndex: 1000,
  },
  actionItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 16px",
    width: "100%",
    border: "none",
    background: "transparent",
    fontSize: "14px",
    fontWeight: 500,
    color: COLORS.text,
    cursor: "pointer",
    transition: "background 0.15s",
    textAlign: "left",
  },
  actionItemDanger: {
    color: COLORS.danger,
  },
  mobileCardList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  mobileCard: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "14px",
    padding: "14px",
    boxShadow: COLORS.shadowSm,
  },
  mobileCardHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    marginBottom: "10px",
  },
  mobileCardInfo: {
    flex: 1,
    minWidth: 0,
  },
  mobileCardName: {
    fontWeight: 600,
    fontSize: "14.5px",
    color: COLORS.text,
    wordBreak: "break-word",
    marginBottom: "3px",
  },
  mobileCardPhone: {
    fontSize: "12.5px",
    color: COLORS.textSecondary,
  },
  mobileCardMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
    paddingTop: "10px",
    borderTop: `1px solid ${COLORS.divider}`,
  },
  mobileCardActions: {
    flexShrink: 0,
  },
  emptyState: {
    textAlign: "center",
    padding: "56px 20px",
    color: COLORS.textSecondary,
    background: COLORS.surface,
    borderRadius: "14px",
    border: `1px solid ${COLORS.border}`,
  },
  emptyIconWrap: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: COLORS.primaryLight,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 16px",
  },
  emptyTitle: {
    fontSize: "17px",
    fontWeight: 600,
    color: COLORS.text,
    marginBottom: "6px",
  },
  skeleton: {
    background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
    borderRadius: "8px",
  },
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: COLORS.dangerLight,
    color: COLORS.danger,
    padding: "11px 14px",
    borderRadius: "11px",
    marginBottom: "14px",
    fontSize: "13.5px",
    fontWeight: 500,
  },
  // Mobile action sheet
  sheetBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,17,21,0.4)",
    zIndex: 1000,
  },
  sheet: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1001,
    background: COLORS.surface,
    borderTopLeftRadius: "20px",
    borderTopRightRadius: "20px",
    padding: "8px 0 calc(8px + env(safe-area-inset-bottom))",
    boxShadow: "0 -8px 30px rgba(0,0,0,0.15)",
  },
  sheetHandle: {
    width: "36px",
    height: "4px",
    borderRadius: "999px",
    background: COLORS.border,
    margin: "8px auto 6px",
  },
  sheetItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "14px 20px",
    width: "100%",
    border: "none",
    background: "transparent",
    fontSize: "15px",
    fontWeight: 500,
    color: COLORS.text,
    cursor: "pointer",
    textAlign: "left",
  },
};

// Add global keyframes for skeleton shimmer — this module only evaluates
// once per page load, so no run-once guard is needed here.
{
  const shimmerStyle = document.createElement("style");
  shimmerStyle.innerHTML = `
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;
  document.head.appendChild(shimmerStyle);
}

// ─── Component ─────────────────────────────────────────────────────────────

const StaffManagementPage: React.FC = () => {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const isNarrow = useMediaQuery("(max-width: 420px)");

  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAddEdit, setShowAddEdit] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deletingStaff, setDeletingStaff] = useState<Staff | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchStaff = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getStaff();
      setStaff(data);
    } catch (err: any) {
      setError(err.message || "Failed to load staff");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const stats = useMemo(() => {
    const total = staff.length;
    const admins = staff.filter((s) => s.role === "admin").length;
    const imams = staff.filter((s) => s.role === "imam").length;
    const collectors = staff.filter((s) => s.role === "collector").length;
    const modhins = staff.filter((s) => s.role === "modhin").length;
    const watchmen = staff.filter((s) => s.role === "watchman").length;
    const inactive = staff.filter((s) => !s.is_active).length;
    return { total, admins, imams, collectors, modhins, watchmen, inactive };
  }, [staff]);

  const filteredStaff = useMemo(() => {
    let result = staff;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) => (s.name || "").toLowerCase().includes(q) || (s.phone || "").includes(q)
      );
    }
    if (roleFilter !== "all") {
      result = result.filter((s) => s.role === roleFilter);
    }
    if (statusFilter !== "all") {
      const active = statusFilter === "active";
      result = result.filter((s) => s.is_active === active);
    }
    result.sort((a, b) => {
      const orderA = ROLE_ORDER[a.role] ?? 99;
      const orderB = ROLE_ORDER[b.role] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || "").localeCompare(b.name || "");
    });
    return result;
  }, [staff, search, roleFilter, statusFilter]);

  const handleAdd = () => {
    setEditingStaff(null);
    setShowAddEdit(true);
  };

  const handleEdit = (staffMember: Staff) => {
    setEditingStaff(staffMember);
    setShowAddEdit(true);
    setOpenMenuId(null);
  };

  const handleDelete = (staffMember: Staff) => {
    setDeletingStaff(staffMember);
    setShowDelete(true);
    setOpenMenuId(null);
  };

  const handleToggleStatus = async (staffMember: Staff) => {
    if (staffMember.role === "superadmin") return;
    try {
      const updated = await toggleStaffStatus(staffMember.id);
      setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setOpenMenuId(null);
    } catch (err: any) {
      alert(err.message || "Failed to toggle status");
    }
  };

  const handleSaveStaff = async (payload: CreateStaffPayload | UpdateStaffPayload) => {
    if (editingStaff) {
      const result = await updateStaff(editingStaff.id, payload as UpdateStaffPayload);
      setStaff((prev) => prev.map((s) => (s.id === result.id ? result : s)));
    } else {
      await createStaff(payload as CreateStaffPayload);
      // Refetch staff to ensure we get complete data from backend
      await fetchStaff();
    }
    setShowAddEdit(false);
    setEditingStaff(null);
    // Clear any previous errors
    setError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingStaff) return;
    try {
      await deleteStaff(deletingStaff.id);
      setStaff((prev) => prev.filter((s) => s.id !== deletingStaff.id));
      setShowDelete(false);
      setDeletingStaff(null);
    } catch (err: any) {
      alert(err.message || "Failed to delete staff");
    }
  };

  const renderRoleChip = (role: string) => {
    let bg: string = COLORS.primaryLight;
    let color: string = COLORS.primary;
    if (role === "superadmin") {
      bg = COLORS.sidebar;
      color = COLORS.sidebarText;
    } else if (role === "admin") {
      bg = COLORS.lapisLight;
      color = COLORS.lapis;
    } else if (role === "imam") {
      bg = COLORS.iconGreen;
      color = COLORS.primary;
    } else if (role === "collector") {
      bg = COLORS.iconGold;
      color = COLORS.accent;
    }
    return (
      <span key={role} style={{ ...styles.roleChip, background: bg, color }}>
        {role === "superadmin" ? "Super Admin" : (role || "").charAt(0).toUpperCase() + (role || "").slice(1)}
      </span>
    );
  };

  const renderRoleChips = (staffMember: Staff) => {
    const allRoles = Array.isArray(staffMember.roles) && staffMember.roles.length > 0
      ? staffMember.roles
      : [staffMember.role];
    if (allRoles.length === 1) return renderRoleChip(allRoles[0]);
    return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{allRoles.map(renderRoleChip)}</div>;
  };

  const renderStatusChip = (active: boolean) => {
    return (
      <span
        style={{
          ...styles.statusChip,
          background: active ? COLORS.successLight : COLORS.dangerLight,
          color: active ? COLORS.success : COLORS.danger,
        }}
      >
        {active ? "Active" : "Inactive"}
      </span>
    );
  };

  // ─── Actions (viewport-safe dropdown on desktop, bottom sheet on mobile) ───

  const renderActions = (staffMember: Staff) => {
    const isSuperAdmin = staffMember.role === "superadmin";
    const canDelete = !isSuperAdmin;
    const canDisable = !isSuperAdmin && staffMember.is_active;
    const canEnable = !isSuperAdmin && !staffMember.is_active;
    const isOpen = openMenuId === staffMember.id;

    const handleButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const isOpening = openMenuId !== staffMember.id;

      if (isOpening) {
        if (isDesktop) {
          const rect = e.currentTarget.getBoundingClientRect();
          const menuWidth = 170;
          const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8);
          const top = Math.min(rect.bottom + 4, window.innerHeight - 8);
          setMenuPosition({ top, left });
        }
        setOpenMenuId(staffMember.id);
      } else {
        setOpenMenuId(null);
        setMenuPosition(null);
      }
    };

    const actionRows = (
      <>
        <button
          type="button"
          style={isDesktop ? styles.actionItem : styles.sheetItem}
          onClick={() => handleEdit(staffMember)}
        >
          <Pencil size={isDesktop ? 15 : 17} /> Edit
        </button>
        {canDisable && (
          <button
            type="button"
            style={{ ...(isDesktop ? styles.actionItem : styles.sheetItem), ...styles.actionItemDanger }}
            onClick={() => handleToggleStatus(staffMember)}
          >
            <Ban size={isDesktop ? 15 : 17} /> Disable
          </button>
        )}
        {canEnable && (
          <button
            type="button"
            style={isDesktop ? styles.actionItem : styles.sheetItem}
            onClick={() => handleToggleStatus(staffMember)}
          >
            <CheckCircle2 size={isDesktop ? 15 : 17} /> Enable
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            style={{ ...(isDesktop ? styles.actionItem : styles.sheetItem), ...styles.actionItemDanger }}
            onClick={() => handleDelete(staffMember)}
          >
            <Trash2 size={isDesktop ? 15 : 17} /> Delete
          </button>
        )}
      </>
    );

    return (
      <div style={styles.actionsMenu} ref={isOpen ? menuRef : null}>
        <button
          type="button"
          style={styles.actionsButton}
          onClick={handleButtonClick}
          aria-label="Actions"
        >
          <MoreVertical size={18} />
        </button>

        {isOpen && isDesktop && menuPosition && (
          <div
            style={{
              ...styles.actionsDropdown,
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
          >
            {actionRows}
          </div>
        )}

        {isOpen && !isDesktop && (
          <>
            <div style={styles.sheetBackdrop} onClick={() => setOpenMenuId(null)} />
            <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
              <div style={styles.sheetHandle} />
              <div style={{ padding: "0 20px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {staffMember.name || "Unnamed"}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenMenuId(null)}
                  style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: COLORS.textMuted }}
                >
                  <X size={18} />
                </button>
              </div>
              {actionRows}
            </div>
          </>
        )}
      </div>
    );
  };

  // ─── Stat items (no emojis) ──────────────────────────────────────────

  const statItems = [
    { label: "Total Staff", value: stats.total },
    { label: "Admins", value: stats.admins },
    { label: "Imams", value: stats.imams },
    { label: "Collectors", value: stats.collectors },
    { label: "Modhins", value: stats.modhins },
    { label: "Watchmen", value: stats.watchmen },
    { label: "Inactive", value: stats.inactive },
  ];

  const statsGridStyle: React.CSSProperties = {
    ...styles.stats,
    gridTemplateColumns: isDesktop ? "repeat(5, 1fr)" : "repeat(2, 1fr)",
  };

  // ─── Skeleton loading ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.title}>Staff Management</div>
            <div style={styles.subtitle}>Loading staff...</div>
          </div>
        </div>
        <div style={statsGridStyle}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={styles.statCard}>
              <div style={{ ...styles.skeleton, height: "24px", width: "60%", marginBottom: "8px" }} />
              <div style={{ ...styles.skeleton, height: "14px", width: "40%" }} />
            </div>
          ))}
        </div>
        <div style={styles.toolbar}>
          <div style={{ ...styles.skeleton, height: "40px", width: "100%" }} />
          <div style={{ ...styles.skeleton, height: "40px", width: "100%" }} />
        </div>
        {isDesktop ? (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Staff</th>
                  <th style={styles.th}>Phone</th>
                  <th style={styles.th}>Role</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Created</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td style={styles.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ ...styles.skeleton, width: "36px", height: "36px", borderRadius: "50%" }} />
                        <div style={{ ...styles.skeleton, width: "120px", height: "16px" }} />
                      </div>
                    </td>
                    <td style={styles.td}><div style={{ ...styles.skeleton, width: "100px", height: "16px" }} /></td>
                    <td style={styles.td}><div style={{ ...styles.skeleton, width: "80px", height: "24px", borderRadius: "999px" }} /></td>
                    <td style={styles.td}><div style={{ ...styles.skeleton, width: "70px", height: "24px", borderRadius: "999px" }} /></td>
                    <td style={styles.td}><div style={{ ...styles.skeleton, width: "90px", height: "16px" }} /></td>
                    <td style={styles.td}><div style={{ ...styles.skeleton, width: "30px", height: "30px", borderRadius: "8px" }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={styles.mobileCardList}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={styles.mobileCard}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ ...styles.skeleton, width: "36px", height: "36px", borderRadius: "50%" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ ...styles.skeleton, height: "16px", width: "60%", marginBottom: 6 }} />
                    <div style={{ ...styles.skeleton, height: "12px", width: "40%" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Staff Management</h1>
          <p style={styles.subtitle}>Manage administrators, imams and collectors for the mosque.</p>
        </div>
        {isDesktop && (
          <button style={styles.addButton} onClick={handleAdd}>
            <Plus size={16} /> Add Staff
          </button>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={styles.errorBanner}>
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* Stats */}
      <div style={statsGridStyle}>
        {statItems.map((stat) => (
          <div
            key={stat.label}
            style={styles.statCard}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = COLORS.shadow as string;
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = COLORS.shadowSm as string;
              e.currentTarget.style.transform = "none";
            }}
          >
            <div style={styles.statNumber}>{stat.value}</div>
            <div style={styles.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar — stacked on mobile, single row on desktop */}
      <div style={styles.toolbar}>
        <div style={{ position: "relative", width: "100%" }}>
          <Search size={14} color={COLORS.textMuted} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input
            style={styles.searchInput}
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ ...styles.toolbarRow, gridTemplateColumns: isNarrow ? "1fr" : undefined, display: isNarrow ? "grid" : "flex" }}>
          <select
            style={styles.filterSelect}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="imam">Imam</option>
            <option value="collector">Collector</option>
            <option value="modhin">Modhin</option>
            <option value="watchman">Watchman</option>
          </select>
          <select
            style={styles.filterSelect}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button style={styles.refreshButton} onClick={fetchStaff} title="Refresh" aria-label="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Content */}
      {filteredStaff.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIconWrap}>
            <Users size={26} color={COLORS.primary} />
          </div>
          <div style={styles.emptyTitle}>No staff found</div>
          <p style={{ color: COLORS.textSecondary, marginBottom: "18px", fontSize: "13.5px" }}>
            {search || roleFilter !== "all" || statusFilter !== "all"
              ? "Try adjusting your filters"
              : "Get started by creating your first staff account"}
          </p>
          <button
            style={{ ...styles.addButton, display: "inline-flex" }}
            onClick={handleAdd}
          >
            <Plus size={16} /> Create Staff
          </button>
        </div>
      ) : isDesktop ? (
        /* ─── Desktop Table ─── */
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Staff</th>
                <th style={styles.th}>Phone</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Created</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStaff.map((staffMember) => (
                <tr
                  key={staffMember.id}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = COLORS.tableHover;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <td style={styles.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={styles.avatar}>{getInitials(staffMember.name)}</div>
                      <div>
                        <div style={{ fontWeight: 500, color: COLORS.text }}>
                          {staffMember.name || "Unnamed"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={styles.td}>{staffMember.phone || "—"}</td>
                  <td style={styles.td}>{renderRoleChips(staffMember)}</td>
                  <td style={styles.td}>{renderStatusChip(staffMember.is_active)}</td>
                  <td style={styles.td}>{formatDate(staffMember.created_at)}</td>
                  <td style={styles.td}>{renderActions(staffMember)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ─── Mobile Cards ─── */
        <div style={styles.mobileCardList}>
          {filteredStaff.map((staffMember) => (
            <div key={staffMember.id} style={styles.mobileCard}>
              <div style={styles.mobileCardHeader}>
                <div style={styles.avatar}>{getInitials(staffMember.name)}</div>
                <div style={styles.mobileCardInfo}>
                  <div style={styles.mobileCardName}>
                    {staffMember.name || "Unnamed"}
                  </div>
                  <div style={styles.mobileCardPhone}>
                    {staffMember.phone || "—"}
                  </div>
                </div>
                <div style={styles.mobileCardActions}>
                  {renderActions(staffMember)}
                </div>
              </div>
              <div style={styles.mobileCardMeta}>
                {renderRoleChips(staffMember)}
                {renderStatusChip(staffMember.is_active)}
                <span style={{ fontSize: "11.5px", color: COLORS.textMuted, marginLeft: "auto" }}>
                  Joined {formatDate(staffMember.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Floating Add Button (mobile) */}
      {!isDesktop && (
        <button style={styles.addButtonMobile} onClick={handleAdd} aria-label="Add staff">
          <Plus size={26} />
        </button>
      )}

      {/* Dialogs */}
      {showAddEdit && (
        <AddEditStaffDialog
          open={showAddEdit}
          onClose={() => {
            setShowAddEdit(false);
            setEditingStaff(null);
          }}
          onSave={handleSaveStaff}
          initialData={editingStaff}
        />
      )}

      {showDelete && deletingStaff && (
        <DeleteStaffDialog
          open={showDelete}
          onClose={() => {
            setShowDelete(false);
            setDeletingStaff(null);
          }}
          onConfirm={handleConfirmDelete}
          staffName={deletingStaff.name || "Unnamed"}
          staffRole={deletingStaff.role}
        />
      )}
    </div>
  );
};

export { StaffManagementPage as StaffManagement };