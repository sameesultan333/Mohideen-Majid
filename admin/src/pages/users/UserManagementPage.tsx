import React, { useEffect, useState, useMemo, useCallback } from "react";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import { getUsers, assignFamily, resetUserPassword } from "../../api/users";
import api from "../../api/axios";
import { getFamilies, getFamilyMembers } from "../../api/families";
import type { User, UserRole } from "../../types/users";
import type { Family, FamilyMember } from "../../types/family";

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { padding: "16px", maxWidth: "1400px", margin: "0 auto" },
  header: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", gap: "12px" },
  title: { fontFamily: TYPOGRAPHY.fontDisplay, fontSize: "32px", fontWeight: 400, letterSpacing: "0", color: COLORS.text, marginBottom: "4px" },
  subtitle: { fontSize: "15px", color: COLORS.textSecondary },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "12px", marginBottom: "24px" },
  statCard: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "16px", padding: "16px 12px", boxShadow: COLORS.shadowSm, transition: "all 0.25s ease" },
  statNumber: { fontSize: "28px", fontWeight: 600, fontFamily: "'Fraunces', Georgia, serif", color: COLORS.text, lineHeight: 1.2 },
  statLabel: { fontSize: "12px", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "4px" },
  statDot: { display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", marginBottom: "6px" },
  toolbar: { display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "20px", alignItems: "center" },
  searchInput: { flex: "1 1 180px", minWidth: "140px", height: "42px", padding: "0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.surface, fontSize: "14px", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s", color: COLORS.text },
  filterSelect: { height: "42px", padding: "0 32px 0 14px", border: `1px solid ${COLORS.border}`, borderRadius: "12px", background: COLORS.surface, fontSize: "14px", outline: "none", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", minWidth: "120px", cursor: "pointer", color: COLORS.text },
  refreshBtn: { height: "42px", padding: "0 16px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, background: COLORS.surface, cursor: "pointer", fontSize: "14px", fontWeight: 500, color: COLORS.textSecondary, transition: "background 0.2s" },
  tableWrapper: { overflowX: "auto", borderRadius: "16px", border: `1px solid ${COLORS.border}`, background: COLORS.surface, boxShadow: COLORS.shadowSm },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "14px" },
  th: { textAlign: "left" as const, padding: "14px 16px", background: COLORS.backgroundAlt, color: COLORS.textSecondary, fontWeight: 600, fontSize: "12px", textTransform: "uppercase" as const, letterSpacing: "0.04em", borderBottom: `1px solid ${COLORS.border}`, whiteSpace: "nowrap" as const },
  td: { padding: "12px 16px", borderBottom: `1px solid ${COLORS.divider}`, verticalAlign: "middle" },
  headRow: { cursor: "pointer", transition: "background 0.2s" },
  headRowOpen: { background: COLORS.primaryLight },
  memberRow: { background: COLORS.backgroundAlt, cursor: "pointer" },
  memberIndent: { paddingLeft: "48px" },
  roleChip: { display: "inline-block", padding: "3px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 },
  statusChip: { display: "inline-block", padding: "3px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 },
  chandaChip: { display: "inline-block", padding: "2px 10px", borderRadius: "6px", fontSize: "12px", background: COLORS.primaryLight, color: COLORS.primary, fontFamily: "monospace" },
  avatar: { width: "34px", height: "34px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: "13px", flexShrink: 0 },
  expandBtn: { width: "26px", height: "26px", borderRadius: "8px", border: `1px solid ${COLORS.border}`, background: COLORS.surface, cursor: "pointer", fontSize: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", marginRight: "8px", flexShrink: 0, transition: "background 0.2s, transform 0.25s" },
  expandBtnOpen: { transform: "rotate(45deg)" },
  emptyState: { textAlign: "center", padding: "60px 20px", color: COLORS.textSecondary },
  errorBanner: { background: COLORS.dangerLight, color: COLORS.danger, padding: "12px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.danger}`, animation: "fadeIn 0.3s ease" },
  offlineBanner: { background: COLORS.warningLight, color: COLORS.warning, padding: "8px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px", border: `1px solid ${COLORS.warning}`, display: "flex", alignItems: "center", gap: "8px", animation: "fadeIn 0.3s ease" },
  memberCountBadge: { display: "inline-block", padding: "1px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, background: COLORS.backgroundAlt, color: COLORS.textMuted, marginLeft: "8px" },

  // ── Mobile Card Styles ────────────────────────────────────────────────────
  cardList: { display: "flex", flexDirection: "column", gap: "12px" },
  card: { background: COLORS.surface, borderRadius: "16px", border: `1px solid ${COLORS.border}`, boxShadow: COLORS.shadowSm, overflow: "hidden", transition: "box-shadow 0.3s, transform 0.3s" },
  cardHeader: { padding: "16px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" },
  cardAvatar: { width: "44px", height: "44px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: "16px", flexShrink: 0 },
  cardInfo: { flex: 1, minWidth: 0 },
  cardName: { fontSize: "16px", fontWeight: 600, color: COLORS.text, wordBreak: "break-word" },
  cardMeta: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginTop: "4px" },
  cardSub: { fontSize: "13px", color: COLORS.textSecondary },
  cardExpand: { fontSize: "18px", color: COLORS.textMuted, padding: "4px 8px", border: "none", background: "transparent", cursor: "pointer", transition: "transform 0.25s" },
  cardBody: { padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: "10px" },
  cardRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${COLORS.divider}`, fontSize: "13px" },
  cardRowLabel: { color: COLORS.textSecondary },
  cardRowValue: { fontWeight: 500, color: COLORS.text, textAlign: "right" as const },
  cardMemberList: { marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" },
  cardMember: { display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: COLORS.backgroundAlt, borderRadius: "10px", cursor: "pointer", transition: "background 0.2s" },
  cardMemberAvatar: { width: "30px", height: "30px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: "11px", flexShrink: 0 },

  // ─── Detail Panel ────────────────────────────────────────────────────────
  overlay: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "flex-end", animation: "fadeIn 0.25s ease" },
  panel: { background: COLORS.surface, width: "440px", maxWidth: "100vw", height: "100vh", overflowY: "auto" as const, boxShadow: "-8px 0 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column" as const, animation: "slideInRight 0.3s ease" },
  panelMobile: { width: "100%", height: "85vh", borderRadius: "20px 20px 0 0", marginTop: "auto", animation: "slideUp 0.3s ease" },
  panelHeader: { padding: "20px 24px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 },
  panelTitle: { fontSize: "18px", fontWeight: 700, color: COLORS.text },
  panelClose: { width: "36px", height: "36px", borderRadius: "50%", border: "none", background: COLORS.backgroundAlt, cursor: "pointer", fontSize: "20px", color: COLORS.textSecondary, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" },
  panelBody: { padding: "24px", flex: 1 },
  panelAvatarRow: { display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" },
  panelBigAvatar: { width: "64px", height: "64px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "24px", flexShrink: 0, background: COLORS.primaryLight, color: COLORS.primary },
  section: { marginBottom: "24px" },
  sectionTitle: { fontSize: "11px", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: COLORS.textMuted, marginBottom: "12px" },
  infoRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${COLORS.divider}`, fontSize: "14px" },
  infoLabel: { color: COLORS.textSecondary },
  infoValue: { fontWeight: 500, color: COLORS.text, textAlign: "right" as const, maxWidth: "220px", wordBreak: "break-word" as const },
  memberCard: { background: COLORS.backgroundAlt, borderRadius: "10px", padding: "12px 14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", transition: "background 0.2s" },
  loadingSpinner: { textAlign: "center", padding: "20px", color: COLORS.textMuted, fontSize: "13px" },

  // ─── Loading Skeleton ────────────────────────────────────────────────────
  skeleton: { background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", borderRadius: "12px" },
  skeletonCard: { background: COLORS.surface, borderRadius: "16px", border: `1px solid ${COLORS.border}`, padding: "16px", boxShadow: COLORS.shadowSm, minHeight: "80px" },
};

// ─── Inject keyframes ──────────────────────────────────────────────────────

const keyframes = document.createElement("style");
keyframes.innerHTML = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
document.head.appendChild(keyframes);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const initials = (name?: string | null) => {
  if (!name) return "?";
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
};

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const fmtDateTime = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

// ─── Role Chip ────────────────────────────────────────────────────────────────

function RoleChip({ role }: { role: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    superadmin: { bg: "#0C2E27", color: "#CFE3DC" },
    admin:      { bg: COLORS.lapisLight, color: COLORS.lapis },
    imam:       { bg: COLORS.iconGreen, color: COLORS.primary },
    collector:  { bg: COLORS.iconGold, color: COLORS.accent },
    head:       { bg: COLORS.iconOrange ?? COLORS.accentLight, color: COLORS.warning },
    member:     { bg: COLORS.iconLapis ?? COLORS.lapisLight, color: COLORS.lapis },
  };
  const c = map[role] ?? { bg: COLORS.backgroundAlt, color: COLORS.textMuted };
  const label = role === "superadmin" ? "Super Admin" : role.charAt(0).toUpperCase() + role.slice(1);
  return <span style={{ ...S.roleChip, background: c.bg, color: c.color }}>{label}</span>;
}

// ─── Edit Family Dialog ────────────────────────────────────────────────────────

interface EditFamilyDialogProps {
  family: Family;
  onClose: () => void;
  onSaved: (updated: Family) => void;
}

const EditFamilyDialog: React.FC<EditFamilyDialogProps> = ({ family, onClose, onSaved }) => {
  const [form, setForm] = useState({
    chanda_no:    family.chanda_no ?? "",
    name:         family.name ?? "",
    phone:        family.phone ?? "",
    address:      family.address ?? "",
    zone:         family.zone ?? "",
    monthly_amount: String(family.monthly_amount ?? ""),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zones, setZones] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getZones } = await import("../../api/families");
        const z = await getZones();
        if (!cancelled) setZones(z);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    setError("");
    const amount = parseFloat(form.monthly_amount);
    if (!form.chanda_no.trim()) return setError("Chanda number is required.");
    if (!form.name.trim())      return setError("Name is required.");
    if (isNaN(amount) || amount <= 0) return setError("Monthly amount must be a positive number.");

    const payload: any = {
      chanda_no:      form.chanda_no.trim(),
      name:           form.name.trim(),
      monthly_amount: amount,
    };
    if (form.phone.trim())   payload.phone   = form.phone.trim();
    if (form.address.trim()) payload.address = form.address.trim();
    if (form.zone.trim())    payload.zone    = form.zone.trim();

    try {
      setBusy(true);
      const { updateFamily } = await import("../../api/families");
      const updated = await updateFamily(family.id, payload);
      onSaved(updated);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Save failed — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, k: keyof typeof form, placeholder = "") => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 4 }}>
        {label}
      </label>
      <input
        value={form[k]}
        onChange={set(k)}
        placeholder={placeholder}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "9px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
          fontSize: 14, color: COLORS.text, background: COLORS.background,
          outline: "none",
        }}
      />
    </div>
  );

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.panel, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={S.panelHeader}>
          <div style={S.panelTitle}>Edit Family</div>
          <button style={S.panelClose} onClick={onClose}>✕</button>
        </div>
        <div style={S.panelBody}>
          {field("Chanda Number *", "chanda_no", "e.g. CH-001")}
          {field("Family Name *",   "name",      "Full name")}
          {field("Phone",           "phone",     "10-digit number")}
          {field("Monthly Amount (₹) *", "monthly_amount", "e.g. 500")}
          {field("Address",         "address",   "Street, area")}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 4 }}>
              Zone
            </label>
            <input
              value={form.zone}
              onChange={set("zone")}
              placeholder="Select or type a zone"
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "9px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
                fontSize: 14, color: COLORS.text, background: COLORS.background,
                outline: "none",
              }}
            />
            {zones.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {zones
                  .filter(z => !form.zone || z.toLowerCase().includes(form.zone.toLowerCase()))
                  .map(z => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, zone: z }))}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 14,
                        border: `1px solid ${form.zone === z ? COLORS.primary : COLORS.border}`,
                        background: form.zone === z ? COLORS.primary : COLORS.backgroundAlt,
                        color: form.zone === z ? "#fff" : COLORS.textSecondary,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {z}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {error && (
            <div style={{ padding: "8px 12px", borderRadius: 8, background: COLORS.dangerLight,
                          color: COLORS.danger, fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={onClose} disabled={busy}
              style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${COLORS.border}`,
                       background: COLORS.backgroundAlt, color: COLORS.text,
                       fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={busy}
              style={{ flex: 2, padding: "10px", borderRadius: 10, border: "none",
                       background: busy ? COLORS.textMuted : COLORS.primary,
                       color: "#fff", fontWeight: 700, fontSize: 14, cursor: busy ? "default" : "pointer" }}>
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailEntry {
  type: "user" | "family";
  user?: User;
  family?: Family;
}

interface DetailPanelProps {
  entry: DetailEntry;
  familyMap: Map<number, Family>;
  onClose: () => void;
  onSelectMember: (u: User) => void;
  isMobile: boolean;
  onResetPassword?: (u: User) => void;
  onEditFamily?: (f: Family) => void;
}

const DetailPanel: React.FC<DetailPanelProps> = ({ entry, familyMap, onClose, onSelectMember, isMobile, onResetPassword, onEditFamily }) => {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const isFamily = entry.type === "family";
  const family = entry.family ?? (entry.user?.family_id ? familyMap.get(entry.user.family_id) : null);
  const user = entry.user;

  const displayName = isFamily ? entry.family!.name : user?.name ?? "Unknown";
  const displayPhone = isFamily ? entry.family!.phone : user?.phone ?? "—";

  const familyId = isFamily ? entry.family!.id : user?.family_id;

  useEffect(() => {
    if (!familyId) return;
    setMembersLoading(true);
    getFamilyMembers(familyId)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  }, [familyId]);

  const panelStyle = { ...S.panel, ...(isMobile ? S.panelMobile : {}) };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={S.panelHeader}>
          <div style={S.panelTitle}>
            {isFamily ? "Family Details" : "User Details"}
          </div>
          <button style={S.panelClose} onClick={onClose}>✕</button>
        </div>

        <div style={S.panelBody}>
          <div style={S.panelAvatarRow}>
            <div style={S.panelBigAvatar}>{initials(displayName)}</div>
            <div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: COLORS.text }}>{displayName}</div>
              <div style={{ fontSize: "14px", color: COLORS.textSecondary, marginTop: "2px" }}>{displayPhone}</div>
              <div style={{ marginTop: "6px" }}>
                <RoleChip role={isFamily ? "head" : (user?.role ?? "")} />
                {(isFamily ? entry.family!.is_active : user?.is_active) ? (
                  <span style={{ ...S.statusChip, background: COLORS.successLight, color: COLORS.success, marginLeft: "8px" }}>Active</span>
                ) : (
                  <span style={{ ...S.statusChip, background: COLORS.dangerLight, color: COLORS.danger, marginLeft: "8px" }}>Inactive</span>
                )}
              </div>
            </div>
          </div>

          {!isFamily && user && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Account</div>
              {[
                ["Role", <RoleChip key="r" role={user.role} />],
                ["Phone verified", user.phone_verified ? "Yes" : "No"],
                ["Last login", fmtDateTime(user.last_login)],
                ["Member since", fmtDate(user.created_at)],
              ].map(([label, val]) => (
                <div key={String(label)} style={S.infoRow}>
                  <span style={S.infoLabel}>{label}</span>
                  <span style={S.infoValue}>{val}</span>
                </div>
              ))}
              {onResetPassword && (
                <button
                  onClick={() => onResetPassword(user)}
                  style={{ marginTop: 14, width: "100%", padding: "10px", borderRadius: 10,
                            border: `1px solid ${COLORS.danger}`, background: COLORS.dangerLight,
                            color: COLORS.danger, fontWeight: 700, fontSize: 13, cursor: "pointer",
                            transition: "background 0.2s" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#FECACA"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = COLORS.dangerLight; }}
                >
                  🔑 Reset Password
                </button>
              )}
            </div>
          )}

          {isFamily && family?.user_id && onResetPassword && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Account</div>
              <button
                onClick={() => onResetPassword({ ...({} as User), id: family.user_id!, name: family.name })}
                style={{ marginTop: 4, width: "100%", padding: "10px", borderRadius: 10,
                          border: `1px solid ${COLORS.danger}`, background: COLORS.dangerLight,
                          color: COLORS.danger, fontWeight: 700, fontSize: 13, cursor: "pointer",
                          transition: "background 0.2s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#FECACA"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = COLORS.dangerLight; }}
              >
                🔑 Reset Head's Password
              </button>
            </div>
          )}

          {family && (
            <div style={S.section}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={S.sectionTitle}>Family / Chanda</div>
                {onEditFamily && (
                  <button
                    onClick={() => onEditFamily(family)}
                    style={{ padding: "4px 12px", borderRadius: 7, border: `1px solid ${COLORS.primary}`,
                             background: COLORS.primaryLight, color: COLORS.primary,
                             fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    ✏ Edit
                  </button>
                )}
              </div>
              {[
                ["Chanda No.", <span key="c" style={S.chandaChip}>{family.chanda_no}</span>],
                ["Family Name", family.name],
                ["Phone", family.phone ?? <span style={{ color: COLORS.textMuted, fontStyle: "italic" }}>Not set</span>],
                ["Address", family.address ?? "—"],
                ["Zone", family.zone ?? "—"],
                ["Monthly Amount", `₹${family.monthly_amount.toLocaleString("en-IN")}`],
                ["Registered", fmtDate(family.registration_date ?? family.created_at)],
                ["Status", family.is_active ? "Active" : "Inactive"],
              ].map(([label, val]) => (
                <div key={String(label)} style={S.infoRow}>
                  <span style={S.infoLabel}>{label}</span>
                  <span style={S.infoValue}>{val}</span>
                </div>
              ))}
            </div>
          )}

          {familyId && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                Family Members
                {!membersLoading && <span style={S.memberCountBadge}>{members.length}</span>}
              </div>
              {membersLoading ? (
                <div style={S.loadingSpinner}>Loading members…</div>
              ) : members.length === 0 ? (
                <div style={{ fontSize: "13px", color: COLORS.textMuted }}>No linked member accounts</div>
              ) : (
                members.map((m) => (
                  <div
                    key={m.id}
                    style={S.memberCard}
                    onClick={() => onSelectMember(m)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.backgroundAlt)}
                  >
                    <div style={{ ...S.avatar, background: COLORS.primaryLight, color: COLORS.primary, width: "36px", height: "36px", fontSize: "13px" }}>
                      {initials(m.name)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: COLORS.text }}>{m.name}</div>
                      <div style={{ fontSize: "12px", color: COLORS.textSecondary }}>{m.phone}</div>
                    </div>
                    <RoleChip role={m.role} />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const UserManagementPage: React.FC = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [users, setUsers] = useState<User[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole | "no_family">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<{ type: "user" | "family"; user?: User; family?: Family } | null>(null);
  const [fixingMember, setFixingMember] = useState<User | null>(null);
  const [fixHeadId, setFixHeadId] = useState<string>("");
  const [fixName, setFixName] = useState<string>("");
  const [fixBusy, setFixBusy] = useState(false);

  const [editingFamily, setEditingFamily] = useState<Family | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("12345678");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // ── Excel import ─────────────────────────────────────────────────────────────
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<{
    message: string;
    inserted: number;
    updated: number;
    skipped: number;
    total_rows: number;
    errors: string[];
    phone_stats?: {
      unique_phones_imported: number;
      duplicate_phone_entries: number;
      families_imported_no_phone: number;
      families_without_phone_na: number;
    };
    skipped_breakdown?: { duplicate_chanda_numbers: number; invalid_rows: number };
    chanda_duplicates?: {
      chanda_no: string;
      first_row: number;
      first_name: string;
      first_address: string | null;
      duplicate_row: number;
      duplicate_name: string;
      duplicate_address: string | null;
      reason: string;
      action: string;
    }[];
    phone_duplicates?: {
      phone: string;
      row: number;
      duplicate_chanda_no: string;
      duplicate_name: string;
      kept_chanda_no: string;
      kept_name: string;
      reason: string;
      action: string;
    }[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = React.useRef<HTMLInputElement>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFromCache(false);
    try {
      const [usersData, familiesData] = await Promise.all([
        getUsers(),
        getFamilies({ active_only: false }),
      ]);
      setUsers(usersData);
      setFamilies(familiesData);
      try {
        localStorage.setItem("users_cache", JSON.stringify(usersData));
        localStorage.setItem("families_cache", JSON.stringify(familiesData));
      } catch {}
    } catch (err: any) {
      try {
        const cu = localStorage.getItem("users_cache");
        const cf = localStorage.getItem("families_cache");
        if (cu) { setUsers(JSON.parse(cu)); setFromCache(true); }
        if (cf) { setFamilies(JSON.parse(cf)); }
      } catch {}
      setError(err.message ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportBusy(true);
    setImportResult(null);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      // Use the shared `api` axios instance instead of a raw relative
      // fetch(): admin is deployed on a different origin from the backend
      // (e.g. admindashboard-*.onrender.com vs mohideen-majid.onrender.com),
      // so a relative "/admin/upload-heads" URL was resolving against the
      // admin's own static site, not the API — hence the confusing
      // "Failed to execute 'json' on 'Response': Unexpected end of JSON
      // input" (an empty/unexpected response from the wrong host). `api`
      // already carries the correct base URL, auth header, and 401-refresh
      // retry used everywhere else in this app.
      const { data } = await api.post("/admin/upload-heads", form);
      setImportResult(data);
      fetchData();
    } catch (err: any) {
      setImportError(err?.response?.data?.detail ?? err.message ?? "Upload failed");
    } finally {
      setImportBusy(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }, [fetchData]);

  // ── Derived maps ─────────────────────────────────────────────────────────────

  const familyMap = useMemo(() => {
    const m = new Map<number, Family>();
    families.forEach((f) => m.set(f.id, f));
    return m;
  }, [families]);

  const membersByFamily = useMemo(() => {
    const m = new Map<number, User[]>();
    users.forEach((u) => {
      if (u.family_id) {
        const arr = m.get(u.family_id) ?? [];
        arr.push(u);
        m.set(u.family_id, arr);
      }
    });
    return m;
  }, [users]);

  const staffUsers = useMemo(
    () => users.filter((u) => !u.family_id),
    [users]
  );

  // ── Filter ───────────────────────────────────────────────────────────────────

  const q = search.trim().toLowerCase();

  const familyMatches = (f: Family) => {
    if (!q) return true;
    return f.name.toLowerCase().includes(q) || (f.phone ?? "").includes(q) || f.chanda_no.toLowerCase().includes(q);
  };

  const userMatches = (u: User) => {
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || (u.phone ?? "").includes(q);
  };

  const filteredFamilies = useMemo(
    () =>
      families.filter((f) => {
        if (roleFilter === "no_family") return false;
        if (roleFilter !== "all" && roleFilter !== "head" && roleFilter !== "member") return false;
        if (statusFilter === "active" && !f.is_active) return false;
        if (statusFilter === "inactive" && f.is_active) return false;
        if (q) {
          const members = membersByFamily.get(f.id) ?? [];
          return familyMatches(f) || members.some(userMatches);
        }
        return true;
      }),
    [families, roleFilter, statusFilter, q, membersByFamily]
  );

  const filteredStaff = useMemo(
    () =>
      staffUsers.filter((u) => {
        if (roleFilter !== "all" && roleFilter !== "no_family" && u.role !== roleFilter) return false;
        if (roleFilter === "no_family" && u.family_id) return false;
        if (statusFilter === "active" && !u.is_active) return false;
        if (statusFilter === "inactive" && u.is_active) return false;
        return userMatches(u);
      }),
    [staffUsers, roleFilter, statusFilter, q]
  );

  // ── Stats ────────────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    families: families.length,
    users: users.length,
    active: users.filter((u) => u.is_active).length + families.filter((f) => f.is_active).length,
    members: users.filter((u) => u.role === "member").length,
    heads: users.filter((u) => u.role === "head").length,
    staff: users.filter((u) => !["head", "member"].includes(u.role)).length,
  }), [users, families]);

  // ── Toggle expand ─────────────────────────────────────────────────────────────

  const toggleExpand = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Stats dot colors ──────────────────────────────────────────────────────

  const statColors: Record<string, string> = {
    families: COLORS.primary,
    users: COLORS.lapis,
    active: COLORS.success,
    heads: COLORS.warning,
    members: COLORS.accent,
    staff: COLORS.textMuted,
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={S.page}>
        <div style={S.title}>Users & Families</div>
        <div style={{ marginTop: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "12px" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={S.skeletonCard}>
              <div style={{ ...S.skeleton, height: "28px", width: "60%", marginBottom: "8px" }} />
              <div style={{ ...S.skeleton, height: "14px", width: "40%" }} />
            </div>
          ))}
        </div>
        <div style={{ ...S.skeleton, height: "42px", marginBottom: "16px" }} />
        <div style={{ ...S.skeleton, height: "400px", borderRadius: "16px" }} />
      </div>
    );
  }

  // ── Mobile Card Render ──────────────────────────────────────────────────────

  const renderMobileCard = () => {
    const items = [
      ...filteredStaff.map((u) => ({ type: "staff" as const, user: u })),
      ...filteredFamilies.map((f) => ({ type: "family" as const, family: f, members: membersByFamily.get(f.id) ?? [] })),
    ];

    if (items.length === 0) {
      return <div style={S.emptyState}>No results found</div>;
    }

    return (
      <div style={S.cardList}>
        {items.map((item) => {
          if (item.type === "staff") {
            const u = item.user;
            return (
              <div
                key={`staff-${u.id}`}
                style={S.card}
                onClick={() => setDetail({ type: "user", user: u })}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = COLORS.shadow)}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = COLORS.shadowSm)}
              >
                <div style={S.cardHeader}>
                  <div style={{ ...S.cardAvatar, background: COLORS.lapisLight, color: COLORS.lapis }}>
                    {initials(u.name)}
                  </div>
                  <div style={S.cardInfo}>
                    <div style={S.cardName}>{u.name}</div>
                    <div style={S.cardMeta}>
                      <RoleChip role={u.role} />
                      <span style={{ ...S.statusChip, background: u.is_active ? COLORS.successLight : COLORS.dangerLight, color: u.is_active ? COLORS.success : COLORS.danger }}>
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                  <span style={{ color: COLORS.textMuted, fontSize: "20px" }}>›</span>
                </div>
                <div style={S.cardBody}>
                  <div style={S.cardRow}>
                    <span style={S.cardRowLabel}>Phone</span>
                    <span style={S.cardRowValue}>{u.phone}</span>
                  </div>
                  <div style={S.cardRow}>
                    <span style={S.cardRowLabel}>Last Login</span>
                    <span style={S.cardRowValue}>{fmtDate(u.last_login)}</span>
                  </div>
                </div>
              </div>
            );
          } else {
            const f = item.family;
            const members = item.members;
            const isOpen = expanded.has(f.id);
            const headUser = members.find((u) => u.role === "head") ?? members[0];
            const memberUsers = members.filter((u) => u !== headUser);

            return (
              <div
                key={`fam-${f.id}`}
                style={S.card}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = COLORS.shadow)}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = COLORS.shadowSm)}
              >
                <div style={S.cardHeader} onClick={() => setDetail({ type: "family", family: f })}>
                  <div style={{ ...S.cardAvatar, background: COLORS.iconOrange ?? COLORS.accentLight, color: COLORS.warning }}>
                    {initials(f.name)}
                  </div>
                  <div style={S.cardInfo}>
                    <div style={S.cardName}>
                      {f.name}
                      {memberUsers.length > 0 && <span style={S.memberCountBadge}>{memberUsers.length}</span>}
                    </div>
                    <div style={S.cardMeta}>
                      <RoleChip role={headUser?.role ?? "head"} />
                      <span style={{ ...S.statusChip, background: f.is_active ? COLORS.successLight : COLORS.dangerLight, color: f.is_active ? COLORS.success : COLORS.danger }}>
                        {f.is_active ? "Active" : "Inactive"}
                      </span>
                      <span style={S.chandaChip}>{f.chanda_no}</span>
                    </div>
                  </div>
                  {memberUsers.length > 0 && (
                    <button
                      style={{ ...S.cardExpand, transform: isOpen ? "rotate(45deg)" : "none" }}
                      onClick={(e) => toggleExpand(f.id, e)}
                    >
                      +
                    </button>
                  )}
                </div>

                <div style={S.cardBody}>
                  <div style={S.cardRow}>
                    <span style={S.cardRowLabel}>Phone</span>
                    <span style={S.cardRowValue}>{f.phone}</span>
                  </div>
                  <div style={S.cardRow}>
                    <span style={S.cardRowLabel}>Monthly</span>
                    <span style={S.cardRowValue}>₹{f.monthly_amount.toLocaleString("en-IN")}</span>
                  </div>
                  {f.address && (
                    <div style={S.cardRow}>
                      <span style={S.cardRowLabel}>Address</span>
                      <span style={S.cardRowValue}>{f.address}</span>
                    </div>
                  )}

                  {isOpen && memberUsers.length > 0 && (
                    <div style={S.cardMemberList}>
                      {memberUsers.map((u) => (
                        <div
                          key={u.id}
                          style={S.cardMember}
                          onClick={() => setDetail({ type: "user", user: u, family: f })}
                          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
                          onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.backgroundAlt)}
                        >
                          <div style={{ ...S.cardMemberAvatar, background: COLORS.primaryLight, color: COLORS.primary }}>
                            {initials(u.name)}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500, fontSize: "14px", color: COLORS.text }}>{u.name}</div>
                            <div style={{ fontSize: "12px", color: COLORS.textSecondary }}>{u.phone}</div>
                          </div>
                          <RoleChip role={u.role} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }
        })}
      </div>
    );
  };

  // ── Desktop Table Render ──────────────────────────────────────────────────

  const renderDesktopTable = () => {
    return (
      <div style={S.tableWrapper}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Name</th>
              <th style={S.th}>Phone</th>
              <th style={S.th}>Role</th>
              <th style={S.th}>Chanda No.</th>
              <th style={S.th}>Monthly</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Last Login</th>
            </tr>
          </thead>
          <tbody>
            {filteredStaff.map((u) => (
              <tr
                key={`staff-${u.id}`}
                style={S.headRow}
                onClick={() => setDetail({ type: "user", user: u })}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.tableHover ?? COLORS.primaryLight)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={S.td}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ ...S.avatar, background: COLORS.lapisLight, color: COLORS.lapis }}>
                      {initials(u.name)}
                    </div>
                    <span style={{ fontWeight: 500 }}>{u.name}</span>
                  </div>
                </td>
                <td style={S.td}>{u.phone}</td>
                <td style={S.td}><RoleChip role={u.role} /></td>
                <td style={S.td}><span style={{ color: COLORS.textMuted }}>—</span></td>
                <td style={S.td}><span style={{ color: COLORS.textMuted }}>—</span></td>
                <td style={S.td}>
                  <span style={{ ...S.statusChip, background: u.is_active ? COLORS.successLight : COLORS.dangerLight, color: u.is_active ? COLORS.success : COLORS.danger }}>
                    {u.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ ...S.td, color: COLORS.textSecondary, fontSize: "13px" }}>{fmtDate(u.last_login)}</td>
              </tr>
            ))}

            {filteredFamilies.map((family) => {
              const familyUsers = membersByFamily.get(family.id) ?? [];
              const headUser = familyUsers.find((u) => u.role === "head") ?? familyUsers[0];
              const memberUsers = familyUsers.filter((u) => u !== headUser);
              const isOpen = expanded.has(family.id);

              return (
                <React.Fragment key={`fam-${family.id}`}>
                  <tr
                    style={{ ...S.headRow, ...(isOpen ? S.headRowOpen : {}) }}
                    onClick={() => setDetail({ type: "family", family })}
                    onMouseEnter={(e) => !isOpen && (e.currentTarget.style.background = COLORS.tableHover ?? COLORS.primaryLight)}
                    onMouseLeave={(e) => !isOpen && (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {memberUsers.length > 0 && (
                          <button
                            style={{ ...S.expandBtn, ...(isOpen ? S.expandBtnOpen : {}) }}
                            onClick={(e) => toggleExpand(family.id, e)}
                            title={isOpen ? "Collapse members" : "Show members"}
                          >
                            {isOpen ? "−" : "+"}
                          </button>
                        )}
                        <div style={{ ...S.avatar, background: COLORS.iconOrange ?? COLORS.accentLight, color: COLORS.warning }}>
                          {initials(family.name)}
                        </div>
                        <div>
                          <span style={{ fontWeight: 600 }}>{family.name}</span>
                          {memberUsers.length > 0 && (
                            <span style={S.memberCountBadge}>{memberUsers.length} member{memberUsers.length > 1 ? "s" : ""}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={S.td}>{family.phone}</td>
                    <td style={S.td}><RoleChip role={headUser?.role ?? "head"} /></td>
                    <td style={S.td}><span style={S.chandaChip}>{family.chanda_no}</span></td>
                    <td style={{ ...S.td, fontWeight: 600, color: COLORS.text }}>
                      ₹{family.monthly_amount.toLocaleString("en-IN")}
                    </td>
                    <td style={S.td}>
                      <span style={{ ...S.statusChip, background: family.is_active ? COLORS.successLight : COLORS.dangerLight, color: family.is_active ? COLORS.success : COLORS.danger }}>
                        {family.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: COLORS.textSecondary, fontSize: "13px" }}>
                      {fmtDate(headUser?.last_login)}
                    </td>
                  </tr>

                  {isOpen && memberUsers.map((u) => (
                    <tr
                      key={`mem-${u.id}`}
                      style={S.memberRow}
                      onClick={() => setDetail({ type: "user", user: u, family })}
                      onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.backgroundAlt)}
                    >
                      <td style={{ ...S.td, ...S.memberIndent }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div style={{ ...S.avatar, width: "28px", height: "28px", fontSize: "11px", background: COLORS.primaryLight, color: COLORS.primary }}>
                            {initials(u.name)}
                          </div>
                          <span style={{ fontWeight: 500, fontSize: "13px" }}>{u.name}</span>
                        </div>
                      </td>
                      <td style={{ ...S.td, fontSize: "13px" }}>{u.phone}</td>
                      <td style={S.td}><RoleChip role={u.role} /></td>
                      <td style={S.td}><span style={{ color: COLORS.textMuted }}>—</span></td>
                      <td style={S.td}><span style={{ color: COLORS.textMuted }}>—</span></td>
                      <td style={S.td}>
                        <span style={{ ...S.statusChip, background: u.is_active ? COLORS.successLight : COLORS.dangerLight, color: u.is_active ? COLORS.success : COLORS.danger }}>
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td style={{ ...S.td, color: COLORS.textSecondary, fontSize: "13px" }}>{fmtDate(u.last_login)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}

            {filteredFamilies.length === 0 && filteredStaff.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...S.td, textAlign: "center", padding: "60px 20px", color: COLORS.textMuted }}>
                  No results found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  // ─── Main Render ───────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Users & Families</h1>
          <p style={S.subtitle}>
            {stats.families} families · {stats.users} user accounts · {stats.staff} staff
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: "none" }}
            onChange={handleImport}
          />
          <button
            style={{
              height: "40px", padding: "0 18px", borderRadius: "12px",
              border: `1px solid ${COLORS.border}`, background: COLORS.surface,
              cursor: importBusy ? "not-allowed" : "pointer", fontSize: "14px",
              fontWeight: 600, color: COLORS.primary,
              display: "flex", alignItems: "center", gap: "8px",
              opacity: importBusy ? 0.7 : 1,
            }}
            onClick={() => importFileRef.current?.click()}
            disabled={importBusy}
          >
            {importBusy ? "⏳ Importing…" : "📥 Import Members"}
          </button>
        </div>
      </div>

      {importResult && (
        <div style={{ background: "#E8F5E9", border: "1px solid #4CAF50", borderRadius: 12, padding: "14px 16px", marginBottom: 16, fontSize: 13, color: "#1B5E20" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <strong>✅ {importResult.message}</strong>
              <span style={{ marginLeft: 8 }}>
                {importResult.inserted} inserted · {importResult.updated} updated · {importResult.skipped} skipped · {importResult.total_rows} total rows
              </span>
            </div>
            <button onClick={() => setImportResult(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#388E3C", fontWeight: 700, fontSize: 15, lineHeight: 1 }}>✕</button>
          </div>

          {importResult.skipped_breakdown && (
            <div style={{ marginTop: 8, fontSize: 12, color: "inherit", opacity: 0.85 }}>
              Skipped breakdown: <b>{importResult.skipped_breakdown.duplicate_chanda_numbers}</b> duplicate Chanda Numbers
              {" · "}<b>{importResult.skipped_breakdown.invalid_rows}</b> invalid rows
            </div>
          )}

          {importResult.chanda_duplicates && importResult.chanda_duplicates.length > 0 && (
            <details style={{ marginTop: 10 }} open>
              <summary style={{ cursor: "pointer", color: "#B45309", fontWeight: 700 }}>
                ⚠ {importResult.chanda_duplicates.length} duplicate Chanda Number(s) skipped — correct and re-import
              </summary>
              <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto" }}>
                {importResult.chanda_duplicates.map((d, i) => (
                  <div key={i} style={{
                    marginBottom: 10, padding: "8px 10px", borderRadius: 6,
                    background: "rgba(180,83,9,0.07)", border: "1px solid rgba(180,83,9,0.2)",
                    fontSize: 12, lineHeight: 1.6,
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>Duplicate Chanda Number: {d.chanda_no}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                      <div>
                        <span style={{ opacity: 0.6 }}>First occurrence</span><br />
                        Row: <b>{d.first_row}</b> · {d.first_name}{d.first_address ? ` · ${d.first_address}` : ""}<br />
                        <span style={{ color: "#388E3C" }}>✓ Imported</span>
                      </div>
                      <div>
                        <span style={{ opacity: 0.6 }}>Duplicate occurrence</span><br />
                        Row: <b>{d.duplicate_row}</b> · {d.duplicate_name}{d.duplicate_address ? ` · ${d.duplicate_address}` : ""}<br />
                        <span style={{ color: "#C62828" }}>✖ Skipped</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {importResult.phone_stats && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(0,0,0,0.04)", borderRadius: 8, lineHeight: 1.7 }}>
              <strong style={{ display: "block", marginBottom: 2 }}>Phone Statistics</strong>
              <span>Unique phones imported: <b>{importResult.phone_stats.unique_phones_imported}</b></span>{" · "}
              <span>Duplicates stripped: <b>{importResult.phone_stats.duplicate_phone_entries}</b></span>{" · "}
              <span>Imported without phone: <b>{importResult.phone_stats.families_imported_no_phone}</b></span>{" · "}
              <span>No phone (N/A): <b>{importResult.phone_stats.families_without_phone_na}</b></span>
            </div>
          )}

          {importResult.phone_duplicates && importResult.phone_duplicates.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", color: "#B45309", fontWeight: 600 }}>
                ⚠ {importResult.phone_duplicates.length} duplicate phone number(s) — families imported without phone
              </summary>
              <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,0.06)", textAlign: "left" }}>
                      <th style={{ padding: "4px 8px" }}>Phone</th>
                      <th style={{ padding: "4px 8px" }}>Kept (Chanda · Name)</th>
                      <th style={{ padding: "4px 8px" }}>Duplicate Row</th>
                      <th style={{ padding: "4px 8px" }}>Duplicate (Chanda · Name)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.phone_duplicates.map((d, i) => (
                      <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                        <td style={{ padding: "3px 8px", fontFamily: "monospace" }}>{d.phone}</td>
                        <td style={{ padding: "3px 8px" }}>{d.kept_chanda_no} · {d.kept_name}</td>
                        <td style={{ padding: "3px 8px", textAlign: "center" }}>{d.row}</td>
                        <td style={{ padding: "3px 8px" }}>{d.duplicate_chanda_no} · {d.duplicate_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {importResult.errors.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "#B45309" }}>⚠ {importResult.errors.length} row warning(s)</summary>
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
      {importError && (
        <div style={S.errorBanner}>
          ⚠ Import failed: {importError}
          <button onClick={() => setImportError(null)} style={{ marginLeft: 12, border: "none", background: "none", cursor: "pointer", color: "inherit", fontWeight: 700 }}>✕</button>
        </div>
      )}

      {fromCache && (
        <div style={S.offlineBanner}>
          <span>●</span> Viewing cached data
        </div>
      )}
      {error && <div style={S.errorBanner}>⚠ {error}</div>}

      {/* ── Broken member registrations banner ── */}
      {(() => {
        const broken = users.filter(u =>
          u.role === "member" && !u.family_id && u.head_phone === u.phone
        );
        if (broken.length === 0) return null;
        return (
          <div style={{
            background: "#FFF8E6", border: "1px solid #E8C97A", borderRadius: 12,
            padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A5C00",
          }}>
            <strong>⚠ {broken.length} member account{broken.length > 1 ? "s" : ""} not linked to a family</strong>
            <span style={{ color: "#9A7000", marginLeft: 8 }}>
              (registered before a bug fix — click to assign them to the correct family head)
            </span>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {broken.map(u => (
                <button key={u.id}
                  onClick={() => { setFixingMember(u); setFixHeadId(""); setFixName(u.name === u.phone ? "" : u.name); }}
                  style={{
                    background: "#FFF0CC", border: "1px solid #E8C97A", borderRadius: 8,
                    padding: "4px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, color: "#7A5C00",
                  }}>
                  {u.name === u.phone ? u.phone : `${u.name} (${u.phone})`} → Fix
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Assign-family modal ── */}
      {fixingMember && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000,
        }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: 28, width: 380,
            maxWidth: "calc(100vw - 32px)", boxShadow: COLORS.shadowLg,
          }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Assign to Family Head</div>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>
              Member: {fixingMember.phone}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>
                Member Name
              </label>
              <input value={fixName} onChange={e => setFixName(e.target.value)}
                placeholder="Full name"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
                  fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>
                Family Head
              </label>
              <select value={fixHeadId} onChange={e => setFixHeadId(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
                  fontSize: 13, background: "#fff" }}>
                <option value="">— Select head —</option>
                {families.map(f => (
                  <option key={f.id} value={String(f.id)}>{f.name} ({f.phone})</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={fixBusy || !fixHeadId}
                onClick={async () => {
                  if (!fixHeadId || !fixingMember) return;
                  setFixBusy(true);
                  try {
                    await assignFamily(fixingMember.id, parseInt(fixHeadId), fixName || undefined);
                    setFixingMember(null);
                    fetchData();
                  } catch (e: any) {
                    alert(e?.response?.data?.detail || "Failed to assign");
                  } finally { setFixBusy(false); }
                }}
                style={{
                  flex: 1, padding: "9px 0", background: COLORS.primaryLight,
                  border: `1px solid ${COLORS.primaryBorder}`, borderRadius: 10,
                  fontWeight: 700, fontSize: 13, color: COLORS.primary, cursor: "pointer",
                  opacity: fixBusy || !fixHeadId ? 0.5 : 1,
                }}>
                {fixBusy ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setFixingMember(null)}
                style={{
                  flex: 1, padding: "9px 0", background: COLORS.tableHeader,
                  border: `1px solid ${COLORS.border}`, borderRadius: 10,
                  fontWeight: 600, fontSize: 13, color: COLORS.textMuted, cursor: "pointer",
                }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={S.stats}>
        {[
          { key: "families", label: "Families", value: stats.families, color: statColors.families },
          { key: "users", label: "User Accounts", value: stats.users, color: statColors.users },
          { key: "active", label: "Active", value: stats.active, color: statColors.active },
          { key: "heads", label: "Heads", value: stats.heads, color: statColors.heads },
          { key: "members", label: "Members", value: stats.members, color: statColors.members },
          { key: "staff", label: "Staff", value: stats.staff, color: statColors.staff },
        ].map((s, i) => (
          <div key={i} style={S.statCard}>
            <div style={{ ...S.statDot, background: s.color }} />
            <div style={S.statNumber}>{s.value}</div>
            <div style={S.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={S.toolbar}>
        <input
          style={S.searchInput}
          placeholder="Search name, phone, chanda…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={(e) => e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`}
          onBlur={(e) => e.currentTarget.style.boxShadow = "none"}
        />
        <select style={S.filterSelect} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}>
          <option value="all">All Roles</option>
          <option value="superadmin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="imam">Imam</option>
          <option value="collector">Collector</option>
          <option value="head">Head</option>
          <option value="member">Member</option>
          <option value="no_family">Staff (No Family)</option>
        </select>
        <select style={S.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          style={S.refreshBtn}
          onClick={fetchData}
          onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryLight)}
          onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.surface)}
        >
          Refresh
        </button>
      </div>

      {isMobile ? renderMobileCard() : renderDesktopTable()}

      {detail && (
        <DetailPanel
          entry={detail}
          familyMap={familyMap}
          onClose={() => setDetail(null)}
          onSelectMember={(u) => setDetail({ type: "user", user: u, family: u.family_id ? familyMap.get(u.family_id) : undefined })}
          isMobile={isMobile}
          onResetPassword={detail?.user?.role !== "superadmin" ? (u) => { setResetTarget(u); setResetPassword("12345678"); setResetMsg(null); } : undefined}
          onEditFamily={(f) => setEditingFamily(f)}
        />
      )}

      {editingFamily && (
        <EditFamilyDialog
          family={editingFamily}
          onClose={() => setEditingFamily(null)}
          onSaved={(updated) => {
            // Update familyMap and the open detail panel in-place
            setFamilies(prev => prev.map(f => f.id === updated.id ? updated : f));
            if (detail?.family?.id === updated.id) {
              setDetail(d => d ? { ...d, family: updated } : d);
            }
            setEditingFamily(null);
          }}
        />
      )}

      {/* ── Reset Password Modal ── */}
      {resetTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
                      alignItems: "center", justifyContent: "center", zIndex: 9100, padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 28, width: 380,
                        maxWidth: "calc(100vw - 32px)", boxShadow: COLORS.shadowLg }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Reset Password</div>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>
              User: <strong style={{ color: COLORS.text }}>{resetTarget.name}</strong>
            </div>

            {resetMsg ? (
              <>
                <div style={{ background: COLORS.successLight ?? "#EEF9EE", border: `1px solid ${COLORS.success}`,
                              borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: COLORS.success }}>
                  ✓ {resetMsg}
                </div>
                <div style={{ background: COLORS.warningLight ?? "#FFF8E6", border: `1px solid ${COLORS.warning ?? "#A97300"}`,
                              borderRadius: 10, padding: "12px 14px", marginBottom: 20, fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: COLORS.warning ?? "#A97300", marginBottom: 4 }}>Temporary Password</div>
                  <code style={{ fontSize: 20, fontWeight: 800, color: COLORS.text, letterSpacing: 2 }}>{resetPassword}</code>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 6 }}>
                    The user must change this on next login.
                  </div>
                </div>
                <button onClick={() => setResetTarget(null)}
                  style={{ width: "100%", padding: "10px", borderRadius: 12, border: "none",
                            background: COLORS.primary, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                  Done
                </button>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: COLORS.textSecondary,
                                  textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 5 }}>
                    Temporary Password
                  </label>
                  <input
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${COLORS.border}`,
                              fontSize: 14, boxSizing: "border-box", fontFamily: "monospace", letterSpacing: 1 }}
                  />
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 5 }}>
                    User will be forced to change this on next login.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setResetTarget(null)} disabled={resetBusy}
                    style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${COLORS.border}`,
                              background: COLORS.backgroundAlt, fontWeight: 600, fontSize: 13,
                              color: COLORS.textMuted, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button
                    disabled={resetBusy || resetPassword.length < 8}
                    onClick={async () => {
                      setResetBusy(true);
                      try {
                        const res = await resetUserPassword(resetTarget.id, resetPassword);
                        setResetMsg(res.message);
                      } catch (e: any) {
                        alert(e?.response?.data?.detail ?? "Failed to reset password");
                      } finally {
                        setResetBusy(false);
                      }
                    }}
                    style={{ flex: 1, padding: "10px", borderRadius: 12, border: "none",
                              background: COLORS.danger, color: "#fff", fontWeight: 700, fontSize: 13,
                              cursor: "pointer", opacity: resetBusy || resetPassword.length < 8 ? 0.5 : 1 }}>
                    {resetBusy ? "Resetting…" : "Reset Password"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagementPage;