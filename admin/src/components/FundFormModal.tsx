import React, { useState, useEffect } from "react";
import { COLORS } from "../theme/colors";
import type { Fund, CreateFundPayload, UpdateFundPayload, FundStatus } from "../types/fund";

// ─── Local payload type to avoid TS errors ───────────────────────────
interface FormPayload {
  name: string;
  description?: string;
  goal_amount?: number;
  start_date?: string;
  end_date?: string;
  status?: FundStatus;
}

interface FundFormModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (payload: CreateFundPayload | UpdateFundPayload) => Promise<void>;
  initialData?: Fund | null;
  isEditing?: boolean;
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
    maxWidth: "520px",
    width: "100%",
    padding: "28px 24px 24px",
    boxShadow: COLORS.shadowLg,
    maxHeight: "90vh",
    overflowY: "auto",
    animation: "slideUp 0.25s ease",
  },
  title: { fontSize: "22px", fontWeight: 600, color: COLORS.text, marginBottom: "4px" },
  subtitle: { fontSize: "14px", color: COLORS.textSecondary, marginBottom: "24px" },
  field: { marginBottom: "20px" },
  label: { display: "block", fontSize: "14px", fontWeight: 600, color: COLORS.text, marginBottom: "6px" },
  labelOptional: { fontSize: "13px", fontWeight: 400, color: COLORS.textMuted, marginLeft: "4px" },
  input: {
    width: "100%",
    height: "44px",
    padding: "0 14px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    fontSize: "14px",
    background: COLORS.surface,
    outline: "none",
    color: COLORS.text,
    transition: "border-color 0.2s, box-shadow 0.2s",
  },
  inputError: { borderColor: COLORS.danger, boxShadow: `0 0 0 3px ${COLORS.dangerLight}` },
  textarea: {
    width: "100%",
    minHeight: "80px",
    padding: "10px 14px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    fontSize: "14px",
    background: COLORS.surface,
    outline: "none",
    color: COLORS.text,
    resize: "vertical",
    fontFamily: "inherit",
    transition: "border-color 0.2s, box-shadow 0.2s",
  },
  textareaError: { borderColor: COLORS.danger, boxShadow: `0 0 0 3px ${COLORS.dangerLight}` },
  errorText: { fontSize: "13px", color: COLORS.danger, marginTop: "4px" },
  select: {
    width: "100%",
    height: "44px",
    padding: "0 32px 0 14px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: "12px",
    fontSize: "14px",
    background: COLORS.surface,
    outline: "none",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center",
    cursor: "pointer",
    color: COLORS.text,
  },
  selectError: { borderColor: COLORS.danger, boxShadow: `0 0 0 3px ${COLORS.dangerLight}` },
  actions: {
    display: "flex",
    gap: "12px",
    justifyContent: "flex-end",
    marginTop: "24px",
    paddingTop: "16px",
    borderTop: `1px solid ${COLORS.divider}`,
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
  },
  btnCancel: { background: "transparent", color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` },
  btnSave: { background: COLORS.primary, color: "#fff" },
  btnSaveDisabled: { opacity: 0.6, cursor: "not-allowed" },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" },
  generalError: {
    background: COLORS.dangerLight,
    color: COLORS.danger,
    padding: "12px 16px",
    borderRadius: "12px",
    fontSize: "14px",
    marginBottom: "16px",
    border: `1px solid ${COLORS.danger}`,
  },
};

// Animations
const animationStyle = document.createElement("style");
animationStyle.innerHTML = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
`;
document.head.appendChild(animationStyle);

const FundFormModal: React.FC<FundFormModalProps> = ({ open, onClose, onSave, initialData, isEditing = false }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goalAmount, setGoalAmount] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<FundStatus>("active");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; goalAmount?: string; general?: string }>({});

  useEffect(() => {
    if (open && initialData) {
      setName(initialData.name || "");
      setDescription(initialData.description || "");
      setGoalAmount(initialData.goal_amount ?? "");
      setStartDate(initialData.start_date?.split("T")[0] || "");
      setEndDate(initialData.end_date?.split("T")[0] || "");
      setStatus("active");
    } else if (open && !initialData) {
      setName("");
      setDescription("");
      setGoalAmount("");
      setStartDate("");
      setEndDate("");
      setStatus("active");
    }
    setErrors({});
  }, [open, initialData]);

  const validate = () => {
    const newErrors: { name?: string; goalAmount?: string } = {};
    if (!name.trim()) newErrors.name = "Fund name is required";
    if (goalAmount !== "" && typeof goalAmount === "number" && goalAmount < 0) {
      newErrors.goalAmount = "Goal amount cannot be negative";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    try {
      const payload: FormPayload = {
        name: name.trim(),
        description: description.trim() || undefined,
        goal_amount: goalAmount === "" ? undefined : Number(goalAmount),
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      };
      if (isEditing) {
        payload.status = status;
      }
      // Cast to expected union type (safe because all properties are optional where needed)
      await onSave(payload as CreateFundPayload | UpdateFundPayload);
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || "Failed to save fund";
      setErrors({ general: message });
    } finally {
      setLoading(false);
    }
  };

  const handleGoalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "") {
      setGoalAmount("");
      return;
    }
    const num = Number(val);
    if (!isNaN(num)) setGoalAmount(num);
  };

  if (!open) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.title}>{isEditing ? "Edit Fund" : "Create Fund"}</h2>
        <p style={styles.subtitle}>
          {isEditing ? "Update the fund details below." : "Create a new financial campaign or collection purpose."}
        </p>

        {errors.general && (
          <div style={styles.generalError}>
            <span style={{ fontWeight: 600, marginRight: 4 }}>Error:</span> {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={styles.field}>
            <label style={styles.label}>
              Fund Name <span style={{ color: COLORS.danger }}>*</span>
            </label>
            <input
              style={{ ...styles.input, ...(errors.name ? styles.inputError : {}) }}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Construction Fund"
              disabled={loading}
              autoFocus
            />
            {errors.name && <div style={styles.errorText}>{errors.name}</div>}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>
              Description <span style={styles.labelOptional}>(optional)</span>
            </label>
            <textarea
              style={{ ...styles.textarea, ...(errors.name ? styles.textareaError : {}) }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this fund's purpose"
              disabled={loading}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>
              Goal Amount <span style={styles.labelOptional}>(optional)</span>
            </label>
            <input
              style={{ ...styles.input, ...(errors.goalAmount ? styles.inputError : {}) }}
              type="number"
              min="0"
              step="1000"
              value={goalAmount}
              onChange={handleGoalChange}
              placeholder="e.g. 1000000"
              disabled={loading}
            />
            {errors.goalAmount && <div style={styles.errorText}>{errors.goalAmount}</div>}
            <div style={{ fontSize: "13px", color: COLORS.textMuted, marginTop: "4px" }}>
              Leave empty for no goal (e.g., general operating funds)
            </div>
          </div>

          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}>
                Start Date <span style={styles.labelOptional}>(optional)</span>
              </label>
              <input
                style={styles.input}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>
                End Date <span style={styles.labelOptional}>(optional)</span>
              </label>
              <input
                style={styles.input}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={loading}
                min={startDate || undefined}
              />
            </div>
          </div>

          {isEditing && (
            <div style={styles.field}>
              <label style={styles.label}>Status</label>
              <select
                style={styles.select}
                value={status}
                onChange={(e) => setStatus(e.target.value as FundStatus)}
                disabled={loading}
              >
                <option value="active">Live</option>
              </select>
              <div style={{ fontSize: "13px", color: COLORS.textMuted, marginTop: "4px" }}>
                Archived funds cannot be edited here.
              </div>
            </div>
          )}

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
              type="submit"
              style={{ ...styles.btn, ...styles.btnSave, ...(loading ? styles.btnSaveDisabled : {}) }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = COLORS.primaryHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.primary; }}
              disabled={loading}
            >
              {loading ? "Saving..." : isEditing ? "Update Fund" : "Create Fund"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FundFormModal;