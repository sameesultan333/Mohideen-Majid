import React, { useState, useEffect, useRef, useCallback } from "react";
import type {
  Staff,
  CreateStaffPayload,
  UpdateStaffPayload,
  StaffRole,
  MemberSearchResult,
} from "../api/staff";
import { searchMember } from "../api/staff";
import { COLORS } from "../theme/colors";

interface AddEditStaffDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (payload: CreateStaffPayload | UpdateStaffPayload) => Promise<void>;
  initialData?: Staff | null;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: COLORS.overlay,
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: "16px", animation: "fadeIn 0.2s ease",
  },
  dialog: {
    background: COLORS.surface, borderRadius: "16px", maxWidth: "480px",
    width: "100%", padding: "28px", boxShadow: COLORS.shadowLg,
    maxHeight: "90vh", overflowY: "auto", animation: "slideUp 0.25s ease",
  },
  title: { fontSize: "22px", fontWeight: 600, color: COLORS.text, marginBottom: "4px" },
  subtitle: { fontSize: "14px", color: COLORS.textSecondary, marginBottom: "24px" },

  // Type picker (step 1)
  typeRow: { display: "flex", gap: "12px", marginBottom: "24px" },
  typeCard: {
    flex: 1, padding: "18px 12px", borderRadius: "14px", border: `2px solid ${COLORS.border}`,
    background: COLORS.backgroundAlt, cursor: "pointer", textAlign: "center" as const,
    transition: "border-color 0.2s, background 0.2s",
  },
  typeCardActive: { borderColor: COLORS.primary, background: COLORS.primaryLight },
  typeEmoji: { fontSize: "28px", display: "block", marginBottom: "6px" },
  typeLabel: { fontSize: "13px", fontWeight: 700, color: COLORS.text },
  typeSub: { fontSize: "11px", color: COLORS.textSecondary, marginTop: "3px" },

  // Search
  searchWrap: { position: "relative" as const, marginBottom: "12px" },
  searchInput: {
    width: "100%", height: "44px", padding: "0 14px",
    border: `1px solid ${COLORS.border}`, borderRadius: "12px",
    fontSize: "14px", background: COLORS.surface, outline: "none",
    transition: "border-color 0.2s", boxSizing: "border-box" as const,
  },
  resultsList: {
    border: `1px solid ${COLORS.border}`, borderRadius: "12px",
    background: COLORS.surface, overflow: "hidden",
    boxShadow: COLORS.shadowSm, marginBottom: "12px",
  },
  resultItem: {
    padding: "12px 14px", cursor: "pointer",
    borderBottom: `1px solid ${COLORS.divider}`,
    transition: "background 0.15s",
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  resultName: { fontSize: "14px", fontWeight: 600, color: COLORS.text },
  resultMeta: { fontSize: "12px", color: COLORS.textSecondary, marginTop: "2px" },
  resultBadge: {
    fontSize: "11px", fontWeight: 700, padding: "2px 8px",
    borderRadius: "8px", background: COLORS.warningLight, color: COLORS.warning,
  },

  // Selected member card
  memberCard: {
    background: COLORS.primaryLight, border: `1px solid ${COLORS.primary}`,
    borderRadius: "12px", padding: "14px 16px", marginBottom: "16px",
    display: "flex", alignItems: "center", gap: "12px",
  },
  memberAvatar: {
    width: "44px", height: "44px", borderRadius: "50%",
    background: COLORS.primary, color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: "16px", flexShrink: 0,
  },
  memberName: { fontSize: "15px", fontWeight: 700, color: COLORS.text },
  memberMeta: { fontSize: "12px", color: COLORS.textSecondary, marginTop: "2px" },
  memberClear: {
    marginLeft: "auto", border: "none", background: "none",
    cursor: "pointer", fontSize: "18px", color: COLORS.textMuted, padding: "4px",
  },

  // Form fields
  field: { marginBottom: "20px" },
  label: { display: "block", fontSize: "14px", fontWeight: 600, color: COLORS.text, marginBottom: "6px" },
  input: {
    width: "100%", height: "44px", padding: "0 14px",
    border: `1px solid ${COLORS.border}`, borderRadius: "12px",
    fontSize: "14px", background: COLORS.surface, outline: "none",
    transition: "border-color 0.2s", boxSizing: "border-box" as const,
  },
  inputError: { borderColor: COLORS.danger, boxShadow: `0 0 0 3px ${COLORS.dangerLight}` },
  errorText: { fontSize: "13px", color: COLORS.danger, marginTop: "4px" },
  select: {
    width: "100%", height: "44px", padding: "0 32px 0 14px",
    border: `1px solid ${COLORS.border}`, borderRadius: "12px",
    fontSize: "14px", background: COLORS.surface, outline: "none",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", cursor: "pointer",
    boxSizing: "border-box" as const,
  },
  toggleRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 0", borderTop: `1px solid ${COLORS.divider}`, marginTop: "8px",
  },
  toggleLabel: { fontWeight: 500, color: COLORS.text },
  toggle: {
    position: "relative" as const, width: "44px", height: "24px",
    background: COLORS.border, borderRadius: "12px", cursor: "pointer",
    transition: "background 0.2s", flexShrink: 0,
  },
  toggleActive: { background: COLORS.primary },
  toggleKnob: {
    position: "absolute" as const, top: "2px", left: "2px",
    width: "20px", height: "20px", borderRadius: "50%",
    background: "#fff", transition: "transform 0.2s",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
  },
  toggleKnobActive: { transform: "translateX(20px)" },
  actions: {
    display: "flex", gap: "12px", justifyContent: "flex-end",
    marginTop: "24px", paddingTop: "16px", borderTop: `1px solid ${COLORS.divider}`,
  },
  btn: {
    height: "44px", padding: "0 24px", borderRadius: "12px",
    fontWeight: 600, fontSize: "14px", border: "none",
    cursor: "pointer", transition: "background 0.2s",
    display: "inline-flex", alignItems: "center", gap: "8px",
  },
  btnCancel: { background: "transparent", color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` },
  btnBack:   { background: "transparent", color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` },
  btnSave:   { background: COLORS.primary, color: "#fff" },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed" },
};

// Inject animations once
if (!document.getElementById("aes-anim")) {
  const el = document.createElement("style");
  el.id = "aes-anim";
  el.innerHTML = `
    @keyframes fadeIn  { from { opacity: 0 }              to { opacity: 1 } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0) } }
  `;
  document.head.appendChild(el);
}

const initials = (name: string) =>
  name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

type CreationMode = "pick" | "member" | "standalone";

// ─── Component ───────────────────────────────────────────────────────────────

const AddEditStaffDialog: React.FC<AddEditStaffDialogProps> = ({
  open, onClose, onSave, initialData,
}) => {
  const isEdit = !!initialData;

  // Creation mode (only used when isEdit=false)
  const [creationMode, setCreationMode] = useState<CreationMode>("pick");

  // Member search state
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<MemberSearchResult[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Standalone / edit form state
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [role, setRole]       = useState<StaffRole>("collector");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState<{ name?: string; phone?: string; member?: string; general?: string }>({});

  // Reset all state when the dialog opens or switches between add/edit
  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (initialData) {
      setName(initialData.name);
      setPhone(initialData.phone ?? "");
      setRole(initialData.role as StaffRole);
      setIsActive(initialData.is_active);
    } else {
      setCreationMode("pick");
      setMemberQuery("");
      setMemberResults([]);
      setSelectedMember(null);
      setName("");
      setPhone("");
      setRole("collector");
      setIsActive(true);
    }
  }, [open, initialData]);

  // Debounced member search
  const handleMemberQueryChange = useCallback((q: string) => {
    setMemberQuery(q);
    setSelectedMember(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setMemberResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setMemberSearching(true);
      try {
        const results = await searchMember(q);
        setMemberResults(results);
      } catch { setMemberResults([]); }
      finally { setMemberSearching(false); }
    }, 300);
  }, []);

  const selectMember = (m: MemberSearchResult) => {
    setSelectedMember(m);
    setMemberResults([]);
    setMemberQuery("");
    setErrors({});
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    try {
      // Edit mode — update existing staff
      if (isEdit) {
        const payload: UpdateStaffPayload = { name: name.trim(), phone: phone.trim(), role, is_active: isActive };
        await onSave(payload);
        return;
      }

      // Member flow — assign role to existing mosque member
      if (creationMode === "member") {
        if (!selectedMember) {
          setErrors({ member: "Please search for and select a mosque member." });
          return;
        }
        if (!selectedMember.user_id) {
          // Member exists in ApprovedHead but hasn't registered yet — create standalone by phone
          if (!selectedMember.phone) {
            setErrors({ member: "This member has no phone number and hasn't registered. Add a phone number to their family record first." });
            return;
          }
          const payload: CreateStaffPayload = { name: selectedMember.name, phone: selectedMember.phone, role };
          await onSave(payload);
        } else {
          const payload: CreateStaffPayload = { user_id: selectedMember.user_id, role };
          await onSave(payload);
        }
        return;
      }

      // Standalone flow
      const newErrors: typeof errors = {};
      if (!name.trim())  newErrors.name  = "Name is required";
      if (!phone.trim()) newErrors.phone = "Phone is required";
      else {
        const digits = phone.replace(/\D/g, "");
        if (digits.length !== 10) newErrors.phone = "Phone must be exactly 10 digits";
      }
      if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

      await onSave({ name: name.trim(), phone: phone.trim(), role });
    } catch (err: any) {
      setErrors({ general: err.response?.data?.detail || err.message || "Failed to save" });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  // ── Render: Step 1 — pick creation mode ──────────────────────────────────

  if (!isEdit && creationMode === "pick") {
    return (
      <div style={S.overlay} onClick={onClose}>
        <div style={S.dialog} onClick={e => e.stopPropagation()}>
          <h2 style={S.title}>Add Staff</h2>
          <p style={S.subtitle}>Is this person already a mosque member?</p>
          <div style={S.typeRow}>
            <div style={S.typeCard} onClick={() => setCreationMode("member")}>
              <span style={S.typeEmoji}>🕌</span>
              <div style={S.typeLabel}>Mosque Member</div>
              <div style={S.typeSub}>Already has chanda, donations, or family record</div>
            </div>
            <div style={S.typeCard} onClick={() => setCreationMode("standalone")}>
              <span style={S.typeEmoji}>👤</span>
              <div style={S.typeLabel}>New Staff Account</div>
              <div style={S.typeSub}>Security guard, cleaner, or someone not in the congregation</div>
            </div>
          </div>
          <div style={{ textAlign: "right" as const }}>
            <button style={{ ...S.btn, ...S.btnCancel }} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: form ─────────────────────────────────────────────────────────

  const showMemberSearch = !isEdit && creationMode === "member";

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.dialog} onClick={e => e.stopPropagation()}>
        <h2 style={S.title}>{isEdit ? "Edit Staff" : showMemberSearch ? "Assign Role to Member" : "New Staff Account"}</h2>
        <p style={S.subtitle}>
          {isEdit
            ? "Update staff details below."
            : showMemberSearch
            ? "Find the mosque member and assign their staff role."
            : "This person will register via the mobile app using their phone number."}
        </p>

        <form onSubmit={handleSubmit}>
          {/* ── Member search (creation, member mode) ── */}
          {showMemberSearch && (
            <>
              {selectedMember ? (
                <div style={S.memberCard}>
                  <div style={S.memberAvatar}>{initials(selectedMember.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.memberName}>{selectedMember.name}</div>
                    <div style={S.memberMeta}>
                      {selectedMember.chanda_no} · {selectedMember.phone || "No phone"}
                      {selectedMember.zone ? ` · ${selectedMember.zone}` : ""}
                    </div>
                    {selectedMember.user_role && (
                      <div style={{ fontSize: "12px", color: COLORS.warning, marginTop: "2px", fontWeight: 600 }}>
                        Current role: {selectedMember.user_role}
                      </div>
                    )}
                    {!selectedMember.user_id && (
                      <div style={{ fontSize: "12px", color: COLORS.textMuted, marginTop: "2px" }}>
                        ℹ Not yet registered on mobile — account will be created on first login
                      </div>
                    )}
                  </div>
                  <button style={S.memberClear} type="button" onClick={() => setSelectedMember(null)}>✕</button>
                </div>
              ) : (
                <div style={S.field}>
                  <label style={S.label}>Search by name, phone, or chanda no.</label>
                  <div style={S.searchWrap}>
                    <input
                      style={S.searchInput}
                      type="text"
                      value={memberQuery}
                      onChange={e => handleMemberQueryChange(e.target.value)}
                      placeholder="e.g. Ahmed, 9876543210, MM1001"
                      autoFocus
                    />
                  </div>
                  {memberSearching && (
                    <div style={{ fontSize: "13px", color: COLORS.textMuted, padding: "8px 4px" }}>Searching…</div>
                  )}
                  {memberResults.length > 0 && (
                    <div style={S.resultsList}>
                      {memberResults.map(m => (
                        <div
                          key={m.head_id}
                          style={S.resultItem}
                          onClick={() => selectMember(m)}
                          onMouseEnter={e => (e.currentTarget.style.background = COLORS.backgroundAlt)}
                          onMouseLeave={e => (e.currentTarget.style.background = "")}
                        >
                          <div>
                            <div style={S.resultName}>{m.name}</div>
                            <div style={S.resultMeta}>
                              {m.chanda_no} · {m.phone || "No phone"}
                              {m.zone ? ` · ${m.zone}` : ""}
                            </div>
                          </div>
                          {m.user_role && (
                            <span style={S.resultBadge}>{m.user_role}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {memberQuery.trim().length >= 2 && !memberSearching && memberResults.length === 0 && (
                    <div style={{ fontSize: "13px", color: COLORS.textMuted, padding: "8px 4px" }}>No members found.</div>
                  )}
                  {errors.member && <div style={S.errorText}>{errors.member}</div>}
                </div>
              )}
            </>
          )}

          {/* ── Standalone name / phone fields ── */}
          {(isEdit || creationMode === "standalone") && (
            <>
              <div style={S.field}>
                <label style={S.label}>Full Name *</label>
                <input
                  style={{ ...S.input, ...(errors.name ? S.inputError : {}) }}
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Enter full name"
                  disabled={loading}
                />
                {errors.name && <div style={S.errorText}>{errors.name}</div>}
              </div>

              <div style={S.field}>
                <label style={S.label}>Phone Number *</label>
                <input
                  style={{ ...S.input, ...(errors.phone ? S.inputError : {}) }}
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="10-digit phone number"
                  disabled={loading}
                />
                {errors.phone && <div style={S.errorText}>{errors.phone}</div>}
              </div>
            </>
          )}

          {/* ── Role (always shown once past step 1) ── */}
          <div style={S.field}>
            <label style={S.label}>Role *</label>
            <select
              style={S.select}
              value={role}
              onChange={e => setRole(e.target.value as StaffRole)}
              disabled={loading}
            >
              <option value="admin">Admin</option>
              <option value="imam">Imam</option>
              <option value="collector">Collector</option>
              <option value="modhin">Modhin</option>
              <option value="watchman">Watchman</option>
            </select>
          </div>

          {/* ── Active toggle (edit only) ── */}
          {isEdit && (
            <div style={S.toggleRow}>
              <span style={S.toggleLabel}>Active</span>
              <div
                style={{ ...S.toggle, ...(isActive ? S.toggleActive : {}) }}
                onClick={() => !loading && setIsActive(!isActive)}
              >
                <div style={{ ...S.toggleKnob, ...(isActive ? S.toggleKnobActive : {}) }} />
              </div>
            </div>
          )}

          {errors.general && (
            <div style={{ ...S.errorText, marginTop: "12px" }}>{errors.general}</div>
          )}

          <div style={S.actions}>
            {!isEdit && (
              <button
                type="button"
                style={{ ...S.btn, ...S.btnBack }}
                onClick={() => setCreationMode("pick")}
                disabled={loading}
              >
                ← Back
              </button>
            )}
            <button
              type="button"
              style={{ ...S.btn, ...S.btnCancel }}
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...S.btn, ...S.btnSave, ...(loading ? S.btnDisabled : {}) }}
              disabled={loading}
            >
              {loading ? "Saving…" : isEdit ? "Update" : "Assign Role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddEditStaffDialog;
