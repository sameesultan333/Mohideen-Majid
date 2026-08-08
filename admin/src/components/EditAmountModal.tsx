import { useEffect, useState } from "react";
import { X, IndianRupee, User, Phone } from "lucide-react";
import COLORS from "../theme/colors";

interface Props {
  open: boolean;
  familyName: string;
  chandaNo: string;
  currentAmount: number;
  currentPhone?: string;
  loading?: boolean;
  onClose(): void;
  onSave(fields: { name: string; phone: string; amount: number }): void;
}

export default function EditAmountModal({
  open,
  familyName,
  chandaNo,
  currentAmount,
  currentPhone = "",
  loading = false,
  onClose,
  onSave,
}: Props) {
  const [name, setName]   = useState(familyName);
  const [phone, setPhone] = useState(currentPhone);
  // Held as a string, not a number. A number-typed state renders 0 as "0" for a
  // family with no amount set, so typing "200" appended to it and the field read
  // "0200". Keeping the raw text lets the field be genuinely empty and lets us
  // strip leading zeros as they are typed.
  const [amount, setAmount] = useState(currentAmount ? String(currentAmount) : "");

  useEffect(() => {
    setName(familyName);
    setPhone(currentPhone);
    setAmount(currentAmount ? String(currentAmount) : "");
  }, [familyName, currentPhone, currentAmount, open]);

  // Digits only, and never a leading zero (so "0200" can't be produced at all).
  const onAmountChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
    setAmount(digits);
  };

  const amountValue = Number(amount || 0);
  const amountValid = amountValue > 0;

  if (!open) return null;

  const inp = (extra?: React.CSSProperties): React.CSSProperties => ({
    flex: 1, border: "none", outline: "none", marginLeft: 10,
    fontSize: 15, background: "transparent", color: COLORS.text,
    fontFamily: "inherit", ...extra,
  });

  const row = (): React.CSSProperties => ({
    display: "flex", alignItems: "center", border: `1.5px solid ${COLORS.border}`,
    borderRadius: 11, height: 48, padding: "0 14px", background: "#FAFAF8",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: COLORS.overlay,
      display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999,
    }}>
      <div style={{
        width: 480, background: COLORS.surface,
        borderRadius: 18, border: `1px solid ${COLORS.cardBorder}`,
        boxShadow: COLORS.shadowLg, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: `1px solid ${COLORS.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: COLORS.text }}>Edit Family</h2>
            <p style={{ marginTop: 4, color: COLORS.textSecondary, fontSize: 13 }}>
              {chandaNo} — update head name, phone, or monthly amount
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={22} color={COLORS.textMuted} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24 }}>
          {/* Head Name */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 700, color: COLORS.textSecondary, fontSize: 12,
              textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Approved Head Name
            </label>
            <div style={row()}>
              <User size={16} color={COLORS.primary} />
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Full name of family head"
                style={inp()}
              />
            </div>
          </div>

          {/* Phone */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 700, color: COLORS.textSecondary, fontSize: 12,
              textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Phone
            </label>
            <div style={row()}>
              <Phone size={16} color={COLORS.primary} />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="Phone number"
                style={inp({ fontFamily: "monospace" })}
              />
            </div>
          </div>

          {/* Monthly Amount */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontWeight: 700, color: COLORS.textSecondary, fontSize: 12,
              textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Monthly Chanda (₹)
            </label>
            <div style={row()}>
              <IndianRupee size={16} color={COLORS.primary} />
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                placeholder="0"
                onChange={e => onAmountChange(e.target.value)}
                style={inp({ fontFamily: "monospace", fontWeight: 700 })}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: 20, borderTop: `1px solid ${COLORS.border}`,
          display: "flex", justifyContent: "flex-end", gap: 12,
        }}>
          <button onClick={onClose} style={{
            height: 42, padding: "0 22px", borderRadius: 10,
            border: `1px solid ${COLORS.border}`, background: COLORS.surface,
            cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}>Cancel</button>
          <button
            disabled={loading || !name.trim() || !amountValid}
            onClick={() => onSave({ name: name.trim(), phone: phone.trim(), amount: amountValue })}
            style={{
              height: 42, padding: "0 26px", border: "none", borderRadius: 10,
              background: !name.trim() || !amountValid ? "#ccc" : COLORS.primary,
              color: "#fff", fontWeight: 700, fontSize: 14,
              cursor: !name.trim() || !amountValid ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
