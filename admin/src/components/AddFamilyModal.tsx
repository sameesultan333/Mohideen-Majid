import { useState, useEffect } from "react";
import { X, UserPlus } from "lucide-react";

import COLORS from "../theme/colors";
import { getZones, getStreets } from "../api/families";
import ComboBox from "./ComboBox";

interface AddFamilyData {
  chandaNo: string;
  name: string;
  phone: string;
  address: string;
  zone: string;
  street: string;
  monthlyAmount: number;
  startMonth: string;
  existingFamily: boolean;
}

interface Props {
  open: boolean;
  loading?: boolean;
  existingChandaNos?: string[];
  onClose(): void;
  onSave(data: AddFamilyData): void;
}

const LB: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: COLORS.textSecondary,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 6,
};

export default function AddFamilyModal({
  open,
  loading = false,
  existingChandaNos = [],
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<AddFamilyData>({
    chandaNo: "",
    name: "",
    phone: "",
    address: "",
    zone: "",
    street: "",
    monthlyAmount: 300,
    startMonth: "",
    existingFamily: false,
  });
  const [zones, setZones] = useState<string[]>([]);
  const [zonesError, setZonesError] = useState(false);
  const [streets, setStreets] = useState<string[]>([]);
  const [streetsError, setStreetsError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getZones()
      .then(z => { if (!cancelled) { setZones(z); setZonesError(false); } })
      .catch(() => { if (!cancelled) setZonesError(true); });
    return () => { cancelled = true; };
  }, [open]);

  // Streets are re-fetched for the chosen zone, so the list offers only streets
  // that actually occur there — and every street already in the data (they come
  // in with the Excel import) rather than asking anyone to retype one.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getStreets(form.zone?.trim() || undefined)
      .then(s => { if (!cancelled) { setStreets(s); setStreetsError(false); } })
      .catch(() => { if (!cancelled) setStreetsError(true); });
    return () => { cancelled = true; };
  }, [open, form.zone]);

  if (!open) return null;

  const update = (
    key: keyof AddFamilyData,
    value: any,
  ) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Chanda numbers must be unique across all families — catch a duplicate
  // locally before it round-trips to the server's own uniqueness check.
  const chandaTaken = form.chandaNo.trim() !== "" &&
    existingChandaNos.some(cn => cn.trim().toUpperCase() === form.chandaNo.trim().toUpperCase());

  // box-sizing: border-box is the fix that matters most here — without it,
  // width:100% + horizontal padding renders wider than the parent, which is
  // what was pushing every field (and the modal itself) past the viewport
  // edge on both mobile and laptop.
  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 46,
    boxSizing: "border-box",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: "0 14px",
    outline: "none",
    marginBottom: 16,
    fontSize: 14,
    color: COLORS.text,
    background: COLORS.surface,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: COLORS.overlay,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 16,
        boxSizing: "border-box",
        zIndex: 999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: COLORS.surface,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: COLORS.shadowLg,
          border: `1px solid ${COLORS.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — fixed, not part of the scroll area */}
        <div
          style={{
            flexShrink: 0,
            padding: "20px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: COLORS.primaryLight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <UserPlus size={18} color={COLORS.primary} />
            </div>

            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: COLORS.text }}>
                Add Family
              </h2>
              <p
                style={{
                  margin: "2px 0 0",
                  color: COLORS.textSecondary,
                  fontSize: 13,
                }}
              >
                Register a new or existing family.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={16} color={COLORS.textSecondary} />
          </button>
        </div>

        {/* Body — the only part that scrolls; minHeight:0 is required for a
            flex child to be allowed to shrink and actually scroll instead of
            forcing the whole modal taller than the viewport. */}
        <div style={{ padding: 24, overflowY: "auto", minHeight: 0, flex: 1 }}>
          <label style={LB}>Chanda Number</label>
          <input
            style={{ ...inputStyle, marginBottom: chandaTaken ? 6 : 16 }}
            placeholder="Leave blank to auto-generate"
            value={form.chandaNo}
            onChange={(e) => update("chandaNo", e.target.value)}
          />
          {chandaTaken && (
            <div style={{ fontSize: 12, color: COLORS.danger, marginBottom: 16 }}>
              This chanda number is already in use.
            </div>
          )}

          <label style={LB}>Head Name</label>
          <input
            style={inputStyle}
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />

          <label style={LB}>Phone Number</label>
          <input
            style={inputStyle}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
          />

          <label style={LB}>Address</label>
          <textarea
            rows={3}
            style={{
              ...inputStyle,
              height: 90,
              paddingTop: 12,
              paddingBottom: 12,
              resize: "none",
              fontFamily: "inherit",
            }}
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
          />

          <label style={LB}>Zone</label>
          <ComboBox
            value={form.zone}
            options={zones}
            onChange={(v) => update("zone", v)}
            placeholder="Select or type a zone"
            emptyHint="No zones recorded yet — type to add one."
            style={{ marginBottom: zonesError ? 6 : 16 }}
          />
          {zonesError && (
            <div style={{ fontSize: 11, color: COLORS.danger, marginBottom: 16 }}>
              Couldn't load the zone list — you can still type a zone manually.
            </div>
          )}

          <label style={LB}>Street</label>
          <ComboBox
            value={form.street}
            options={streets}
            onChange={(v) => update("street", v)}
            placeholder={form.zone ? `Streets in ${form.zone}` : "Select or type a street"}
            emptyHint="No streets recorded yet — type to add one."
            style={{ marginBottom: streetsError ? 6 : 16 }}
          />
          {streetsError && (
            <div style={{ fontSize: 11, color: COLORS.danger, marginBottom: 16 }}>
              Couldn't load the street list — you can still type a street manually.
            </div>
          )}

          <label style={LB}>Monthly Chanda Amount</label>
          <input
            type="number"
            style={inputStyle}
            value={form.monthlyAmount}
            onChange={(e) => update("monthlyAmount", Number(e.target.value))}
          />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: form.existingFamily ? 16 : 0,
              cursor: "pointer",
              fontSize: 13.5,
              color: COLORS.text,
            }}
          >
            <input
              type="checkbox"
              checked={form.existingFamily}
              onChange={(e) => update("existingFamily", e.target.checked)}
              style={{ width: 16, height: 16, flexShrink: 0 }}
            />
            Existing family (import previous months)
          </label>

          {form.existingFamily && (
            <>
              <label style={LB}>Existing From Month</label>
              <input
                type="month"
                style={{ ...inputStyle, marginBottom: 0 }}
                value={form.startMonth}
                onChange={(e) => update("startMonth", e.target.value)}
              />
            </>
          )}
        </div>

        {/* Footer — fixed, always visible regardless of body scroll position */}
        <div
          style={{
            flexShrink: 0,
            padding: 20,
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            borderTop: `1px solid ${COLORS.border}`,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: `1px solid ${COLORS.border}`,
              background: "none",
              color: COLORS.textSecondary,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>

          <button
            disabled={loading || chandaTaken}
            onClick={() => onSave(form)}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              background: COLORS.primary,
              color: COLORS.white,
              border: "none",
              fontWeight: 700,
              fontSize: 14,
              cursor: loading || chandaTaken ? "not-allowed" : "pointer",
              opacity: loading || chandaTaken ? 0.7 : 1,
            }}
          >
            {loading ? "Saving..." : "Create Family"}
          </button>
        </div>
      </div>
    </div>
  );
}