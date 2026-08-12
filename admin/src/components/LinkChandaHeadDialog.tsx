import React, { useEffect, useState } from "react";
import { COLORS } from "../theme/colors";
import { getFamilies } from "../api/chanda";
import type { Family } from "../api/chanda";

interface LinkChandaHeadDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (headId: number) => Promise<void>;
  staffName: string;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: COLORS.overlay,
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: "16px",
  },
  dialog: {
    background: COLORS.surface, borderRadius: "16px", maxWidth: "460px",
    width: "100%", padding: "24px", boxShadow: COLORS.shadowLg,
    maxHeight: "80vh", display: "flex", flexDirection: "column",
  },
  title: { fontSize: "18px", fontWeight: 700, color: COLORS.text, marginBottom: "6px" },
  description: {
    fontSize: "13px", color: COLORS.textSecondary, marginBottom: "16px", lineHeight: 1.5,
  },
  input: {
    width: "100%", height: "42px", padding: "0 14px", borderRadius: "10px",
    border: `1.5px solid ${COLORS.border}`, fontSize: "14px", outline: "none",
    marginBottom: "12px", boxSizing: "border-box",
  },
  list: { overflowY: "auto", flex: 1, minHeight: "120px", marginBottom: "16px" },
  row: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 12px", borderRadius: "10px", cursor: "pointer",
    border: `1px solid ${COLORS.border}`, marginBottom: "6px",
  },
  rowSelected: { borderColor: COLORS.primary, background: COLORS.primaryLight },
  rowName: { fontSize: "14px", fontWeight: 600, color: COLORS.text },
  rowMeta: { fontSize: "12px", color: COLORS.textSecondary },
  claimedTag: {
    fontSize: "10px", fontWeight: 700, color: COLORS.danger,
    background: COLORS.dangerLight, borderRadius: "6px", padding: "2px 6px",
  },
  empty: { fontSize: "13px", color: COLORS.textMuted, textAlign: "center", padding: "24px 0" },
  actions: { display: "flex", gap: "12px", justifyContent: "flex-end" },
  btn: {
    height: "40px", padding: "0 20px", borderRadius: "10px", fontWeight: 600,
    fontSize: "14px", border: "none", cursor: "pointer",
  },
  btnCancel: { background: "transparent", color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` },
  btnPrimary: { background: COLORS.primary, color: "#fff" },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
};

/**
 * Links an existing staff/admin login to an existing (or newly imported)
 * ApprovedHead — the same person, not a new account. Deliberately shows
 * whether each result is already claimed by someone else rather than
 * silently allowing a pick that would collide: assign-family on the backend
 * refuses that case, but surfacing it here means the admin isn't guessing
 * why a selection failed.
 */
const LinkChandaHeadDialog: React.FC<LinkChandaHeadDialogProps> = ({
  open, onClose, onConfirm, staffName,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Family[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Family | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery(""); setResults([]); setSelected(null); setError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await getFamilies(q);
        if (!cancelled) setResults(data.slice(0, 20));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(selected.id);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || "Failed to link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Link {staffName} to a Chanda Head</div>
        <div style={styles.description}>
          Search by name, chanda number, or phone. This connects the existing
          login to that family record — it does not create a new account, and
          {staffName}'s current staff role is kept.
        </div>
        <input
          style={styles.input}
          placeholder="Search families…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div style={styles.list}>
          {loading && <div style={styles.empty}>Searching…</div>}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div style={styles.empty}>No matching families.</div>
          )}
          {!loading && query.trim().length < 2 && (
            <div style={styles.empty}>Type at least 2 characters to search.</div>
          )}
          {results.map((f) => {
            const claimed = f.is_registered;
            return (
              <div
                key={f.id}
                style={{ ...styles.row, ...(selected?.id === f.id ? styles.rowSelected : {}) }}
                onClick={() => setSelected(f)}
              >
                <div>
                  <div style={styles.rowName}>{f.name}</div>
                  <div style={styles.rowMeta}>{f.chanda_no} · {f.phone || "no phone"}</div>
                </div>
                {claimed && <span style={styles.claimedTag}>Already linked</span>}
              </div>
            );
          })}
        </div>
        {error && (
          <div style={{ ...styles.description, color: COLORS.danger, marginTop: -8 }}>{error}</div>
        )}
        <div style={styles.actions}>
          <button style={{ ...styles.btn, ...styles.btnCancel }} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            style={{
              ...styles.btn, ...styles.btnPrimary,
              ...((!selected || submitting) ? styles.btnDisabled : {}),
            }}
            onClick={handleConfirm}
            disabled={!selected || submitting}
          >
            {submitting ? "Linking…" : "Link"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LinkChandaHeadDialog;
