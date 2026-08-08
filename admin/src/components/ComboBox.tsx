/**
 * Text field with a real, visible dropdown of existing values.
 *
 * Replaces `<input list=...>` + `<datalist>`. A datalist renders as a plain
 * text box: there is no arrow, nothing opens on click, and suggestions only
 * appear once you start typing something that matches — so a list of streets
 * that already exist is invisible to anyone who does not already know what is
 * in it, which reads as "the dropdown isn't working".
 *
 * This keeps free text — a genuinely new street still has to be typeable — but
 * shows what already exists, which is what stops "Bazaar St" and "Bazaar
 * Street" becoming two streets.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { COLORS } from "../theme/colors";

export default function ComboBox({
  value,
  options,
  onChange,
  placeholder,
  emptyHint,
  style,
}: {
  value: string;
  options: string[];
  onChange(next: string): void;
  placeholder?: string;
  /** Shown in place of the list when there is nothing to offer yet. */
  emptyHint?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close when focus or a click leaves the control.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // Typing narrows the list; an exact match still shows everything so the field
  // can be reopened to pick a different value.
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q || options.some(o => o.toLowerCase() === q)) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, value]);

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <input
        style={{
          width: "100%", height: 44, padding: "0 34px 0 12px", boxSizing: "border-box",
          border: `1.5px solid ${COLORS.border}`, borderRadius: 10,
          fontSize: 14, color: COLORS.text, background: "#fff", outline: "none",
        }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show options"
        onClick={() => setOpen(o => !o)}
        style={{
          position: "absolute", right: 6, top: 0, height: 44, width: 28,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", border: "none", cursor: "pointer", padding: 0,
        }}
      >
        <ChevronDown
          size={15}
          color={COLORS.textMuted}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
        />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 46, left: 0, right: 0, zIndex: 30,
          background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 10,
          boxShadow: "0 8px 24px rgba(12,46,39,.12)", maxHeight: 208, overflowY: "auto",
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12.5, color: COLORS.textMuted }}>
              {options.length === 0
                ? (emptyHint ?? "Nothing to choose from yet — type to add one.")
                : "No match — type to add a new one."}
            </div>
          ) : filtered.map(opt => {
            const selected = opt.toLowerCase() === value.trim().toLowerCase();
            return (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "9px 12px", fontSize: 13.5, cursor: "pointer",
                  border: "none", background: selected ? COLORS.primaryLight : "transparent",
                  color: selected ? COLORS.primary : COLORS.text,
                  fontWeight: selected ? 700 : 500,
                }}
                onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "#F7F9F8"; }}
                onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
