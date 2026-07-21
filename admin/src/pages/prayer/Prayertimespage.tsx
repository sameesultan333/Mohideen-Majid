import { useEffect, useMemo, useState } from "react";
import {
  Sunrise,
  Sun,
  Sunset,
  Moon,
  MoonStar,
  Clock,
  Pencil,
  X,
  Check,
  Star,
} from "lucide-react";

import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import {
  prayerService,
  type PrayerTimings,
  type PrayerUpdatePayload,
} from "../../api/prayer";

/* ------------------------------------------------------------------
   HELPERS
   ------------------------------------------------------------------ */

function useViewportWidth() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function formatTime(t?: string | null) {
  if (!t) return "--:--";
  const clean = t.replace(/\s+/g, " ").trim();
  const hasMeridiem = /(AM|PM)/i.test(clean);
  if (hasMeridiem) {
    const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (match) {
      return `${match[1]}:${match[2]} ${match[3].toUpperCase()}`;
    }
    return clean;
  }
  const [hStr, mStr] = clean.split(":");
  if (!hStr || !mStr) return clean;
  const h = parseInt(hStr, 10);
  const m = mStr.padStart(2, "0");
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

function toMinutes(t?: string | null) {
  if (!t) return null;
  const clean = t.replace(/\s+/g, " ").trim();
  let hour = 0,
    minute = 0;
  const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match) {
    hour = parseInt(match[1], 10);
    minute = parseInt(match[2], 10);
    if (match[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  } else {
    const [h, m] = clean.split(":").map(Number);
    hour = h || 0;
    minute = m || 0;
  }
  return hour * 60 + minute;
}

const DAILY_PRAYERS = [
  { key: "fajr", label: "Fajr", icon: MoonStar },
  { key: "dhuhr", label: "Dhuhr", icon: Sun },
  { key: "asr", label: "Asr", icon: Sun },
  { key: "maghrib", label: "Maghrib", icon: Sunset },
  { key: "isha", label: "Isha", icon: Moon },
] as const;

function getNowNext(prayer: PrayerTimings | null, nowMin: number) {
  if (!prayer) return null;
  // Use adhan times to determine which prayer period is currently active.
  // Adhan marks the START of a prayer — the current prayer is the last
  // adhan that has already passed.
  const slots = DAILY_PRAYERS.map((p) => ({
    key: p.key,
    label: p.label,
    // Prefer adhan time; fall back to iqamah time if adhan is missing
    minutes: toMinutes(prayer.adhan?.[p.key as keyof typeof prayer.adhan] ?? prayer.prayer?.[p.key]),
  })).filter((s) => s.minutes !== null) as { key: string; label: string; minutes: number }[];
  if (slots.length === 0) return null;

  // Default: before Fajr → Isha from previous night is "current"
  let current = slots[slots.length - 1];
  let next = slots[0];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].minutes <= nowMin) {
      current = slots[i];
      next = slots[i + 1] ?? slots[0];
    }
  }
  const nextMinutes =
    next.minutes > nowMin ? next.minutes - nowMin : 24 * 60 - nowMin + next.minutes;
  const hrs = Math.floor(nextMinutes / 60);
  const mins = nextMinutes % 60;
  const remaining = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  return { current: current.label, next: next.label, remaining };
}

const headerCellStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: COLORS.tableHeaderText,
};

/* ------------------------------------------------------------------
   PAGE
   ------------------------------------------------------------------ */

export default function PrayerTimesPage() {
  const width = useViewportWidth();
  const isMobile = width <= 720;

  const [prayer, setPrayer] = useState<PrayerTimings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<PrayerUpdatePayload | null>(null);
  const [saving, setSaving] = useState(false);
  // Live clock — updates every minute so the current-prayer banner stays accurate
  const [nowMin, setNowMin] = useState(
    () => new Date().getHours() * 60 + new Date().getMinutes()
  );

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const tick = () =>
      setNowMin(new Date().getHours() * 60 + new Date().getMinutes());
    // Align the first tick to the next whole minute
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
    const timeout = setTimeout(() => {
      tick();
      const interval = setInterval(tick, 60_000);
      return () => clearInterval(interval);
    }, msUntilNextMinute);
    return () => clearTimeout(timeout);
  }, []);

  async function load() {
    try {
      setLoading(true);
      setError("");
      const data = await prayerService.getPrayerTimes();
      setPrayer(data);
    } catch (err: any) {
      // 404 just means not configured yet — show the configure prompt, not an error
      if (err?.response?.status === 404) {
        setPrayer({ configured: false } as any);
      } else {
        setError(err?.response?.data?.detail || "Unable to load prayer timings");
      }
    } finally {
      setLoading(false);
    }
  }

  function startEdit() {
    // Allow editing even when prayer is the empty "not configured" response
    if (!prayer && prayer !== null) return;
    try {
      setForm({
        imsak: prayer?.early?.imsak ?? "",
        sunrise: prayer?.early?.sunrise ?? "",
        dhuha: prayer?.early?.dhuha ?? "",
        fajr_adhan: prayer?.adhan?.fajr ?? "",
        dhuhr_adhan: prayer?.adhan?.dhuhr ?? "",
        asr_adhan: prayer?.adhan?.asr ?? "",
        maghrib_adhan: prayer?.adhan?.maghrib ?? "",
        isha_adhan: prayer?.adhan?.isha ?? "",
        fajr: prayer?.prayer?.fajr ?? "",
        dhuhr: prayer?.prayer?.dhuhr ?? "",
        asr: prayer?.prayer?.asr ?? "",
        maghrib: prayer?.prayer?.maghrib ?? "",
        isha: prayer?.prayer?.isha ?? "",
        jummah: prayer?.prayer?.jummah ?? "",
        jummah_iqamah: prayer?.prayer?.jummah_iqamah ?? "",
        ishraq: prayer?.special?.ishraq ?? "",
        taraweeh: prayer?.special?.taraweeh ?? "",
        sunset: prayer?.special?.sunset ?? "",
        notes: prayer?.notes ?? "",
      });
      setError("");
      setIsEditing(true);
    } catch (err) {
      console.error("Failed to open edit form:", err);
      setError("Unable to open the edit form. Check the console for details.");
    }
  }

  async function handleSave() {
    if (!form) return;
    try {
      setSaving(true);
      setError("");
      await prayerService.updatePrayerTimes(form);
      await load();
      setIsEditing(false);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Unable to save prayer timings");
    } finally {
      setSaving(false);
    }
  }

  const nowNext = useMemo(() => getNowNext(prayer, nowMin), [prayer, nowMin]);
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: isMobile ? "0 6px" : 0 }}>
      {/* Heading */}
      <div
        style={{
          display: "flex",
          alignItems: isMobile ? "flex-start" : "center",
          justifyContent: "space-between",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 16 : 0,
          marginBottom: isMobile ? 24 : 32,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: TYPOGRAPHY.fontDisplay,
              fontSize: isMobile ? 24 : 32,
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: COLORS.text,
            }}
          >
            Prayer Times
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: isMobile ? 14 : 15,
              color: COLORS.textSecondary,
              fontWeight: 400,
              letterSpacing: "0.01em",
            }}
          >
            {dateStr}
          </p>
        </div>

        {!isEditing && prayer && prayer.configured !== false && (
          <button
            onClick={startEdit}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 48,
              padding: "0 22px",
              border: "none",
              borderRadius: 12,
              background: COLORS.primary,
              color: COLORS.white,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              width: isMobile ? "100%" : "auto",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              transition: "box-shadow 0.2s, transform 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.25)")}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)")}
          >
            <Pencil size={18} />
            Edit Timings
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: "14px 18px",
            background: COLORS.dangerLight,
            border: `1px solid rgba(161,58,58,0.25)`,
            borderRadius: 12,
            color: COLORS.danger,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      {loading && (
        <div style={{ color: COLORS.textMuted, fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Loading prayer timings...
        </div>
      )}

      {!loading && prayer?.configured === false && !isEditing && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
          padding: "48px 0", textAlign: "center",
        }}>
          <p style={{ color: COLORS.textMuted, fontSize: 15, margin: 0 }}>
            Prayer timings have not been configured yet.
          </p>
          <button
            onClick={startEdit}
            style={{
              padding: "10px 28px", border: "none", borderRadius: 10,
              background: COLORS.primary, color: "#fff", fontWeight: 600,
              fontSize: 14, cursor: "pointer",
            }}
          >
            Configure Prayer Times
          </button>
        </div>
      )}

      {!loading && prayer && !isEditing && (
        <>
          {/* Now / Next hero */}
          {nowNext && (
            <div
              style={{
                background: `linear-gradient(145deg, ${COLORS.sidebar} 0%, #0F3D33 60%, ${COLORS.primary} 130%)`,
                borderRadius: isMobile ? 18 : 24,
                padding: isMobile ? 24 : 36,
                marginBottom: isMobile ? 20 : 28,
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  width: 300,
                  height: 300,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, rgba(169,129,46,0.25) 0%, transparent 70%)`,
                  top: -100,
                  right: -80,
                }}
              />
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <Clock size={18} color={COLORS.accent} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: COLORS.accent,
                  }}
                >
                  Current Prayer
                </span>
              </div>
              <div
                style={{
                  position: "relative",
                  fontFamily: TYPOGRAPHY.fontDisplay,
                  fontSize: isMobile ? 34 : 48,
                  fontWeight: 700,
                  color: COLORS.textOnDark,
                  marginBottom: 8,
                  letterSpacing: "-0.02em",
                }}
              >
                {nowNext.current}
              </div>
              <div style={{ position: "relative", fontSize: isMobile ? 14 : 16, color: COLORS.sidebarText }}>
                {nowNext.next} begins in{" "}
                <span style={{ fontFamily: TYPOGRAPHY.fontMono, color: COLORS.textOnDark, fontWeight: 600 }}>
                  {nowNext.remaining}
                </span>
              </div>
            </div>
          )}

          {/* Daily prayers */}
          <SectionLabel>Daily Prayers</SectionLabel>
          <div
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: isMobile ? 18 : 20,
              overflow: "hidden",
              marginBottom: isMobile ? 24 : 32,
              boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
            }}
          >
            {!isMobile && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 1fr",
                  padding: "16px 24px",
                  background: COLORS.tableHeader,
                  borderBottom: `1px solid ${COLORS.tableBorder}`,
                }}
              >
                <span style={headerCellStyle}>Prayer</span>
                <span style={{ ...headerCellStyle, textAlign: "center" }}>Adhan</span>
                <span style={{ ...headerCellStyle, textAlign: "center" }}>Iqamah</span>
              </div>
            )}

            {DAILY_PRAYERS.map(({ key, label, icon: Icon }, i) => (
              <div
                key={key}
                style={
                  isMobile
                    ? {
                        padding: "16px 18px",
                        borderBottom: i < DAILY_PRAYERS.length - 1 ? `1px solid ${COLORS.divider}` : "none",
                      }
                    : {
                        display: "grid",
                        gridTemplateColumns: "1.4fr 1fr 1fr",
                        alignItems: "center",
                        padding: "16px 24px",
                        borderBottom: i < DAILY_PRAYERS.length - 1 ? `1px solid ${COLORS.divider}` : "none",
                        transition: "background 0.15s ease",
                      }
                }
                onMouseEnter={(e) => {
                  if (!isMobile) e.currentTarget.style.background = COLORS.tableHover;
                }}
                onMouseLeave={(e) => {
                  if (!isMobile) e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: isMobile ? 14 : 0 }}>
                  <div
                    style={{
                      width: isMobile ? 38 : 40,
                      height: isMobile ? 38 : 40,
                      borderRadius: 12,
                      background: COLORS.iconGreen,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={isMobile ? 18 : 20} color={COLORS.primary} />
                  </div>
                  <span style={{ fontSize: isMobile ? 15 : 15, fontWeight: 600, color: COLORS.text }}>
                    {label}
                  </span>
                </div>

                {isMobile ? (
                  <div style={{ display: "flex", gap: 10 }}>
                    <TimePill label="Adhan" value={formatTime(prayer.adhan?.[key])} tone="lapis" />
                    <TimePill label="Iqamah" value={formatTime(prayer.prayer?.[key])} tone="primary" />
                  </div>
                ) : (
                  <>
                    <div style={{ textAlign: "center" }}>
                      <span
                        style={{
                          fontFamily: TYPOGRAPHY.fontMono,
                          fontSize: 15,
                          fontWeight: 500,
                          color: COLORS.textSecondary,
                        }}
                      >
                        {formatTime(prayer.adhan?.[key])}
                      </span>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <span
                        style={{
                          fontFamily: TYPOGRAPHY.fontMono,
                          fontSize: 16,
                          fontWeight: 700,
                          color: COLORS.primary,
                          background: COLORS.primaryLight,
                          padding: "6px 16px",
                          borderRadius: 999,
                        }}
                      >
                        {formatTime(prayer.prayer?.[key])}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Jummah */}
            <div
              style={
                isMobile
                  ? {
                      padding: "16px 18px",
                      borderTop: `1px solid ${COLORS.divider}`,
                      background: COLORS.accentLighter,
                    }
                  : {
                      display: "grid",
                      gridTemplateColumns: "1.4fr 1fr 1fr",
                      alignItems: "center",
                      padding: "16px 24px",
                      borderTop: `1px solid ${COLORS.tableBorder}`,
                      background: COLORS.accentLighter,
                    }
              }
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: isMobile ? 14 : 0 }}>
                <div
                  style={{
                    width: isMobile ? 38 : 40,
                    height: isMobile ? 38 : 40,
                    borderRadius: 12,
                    background: COLORS.iconGold,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Star size={isMobile ? 18 : 20} color={COLORS.accent} />
                </div>
                <span style={{ fontSize: isMobile ? 15 : 15, fontWeight: 600, color: COLORS.text }}>
                  Jummah
                </span>
              </div>

              {isMobile ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <TimePill label="Adhan" value={formatTime(prayer.prayer?.jummah)} tone="lapis" />
                  <TimePill label="Iqamah" value={formatTime(prayer.prayer?.jummah_iqamah)} tone="gold" />
                </div>
              ) : (
                <>
                  <div style={{ textAlign: "center" }}>
                    <span
                      style={{
                        fontFamily: TYPOGRAPHY.fontMono,
                        fontSize: 15,
                        fontWeight: 500,
                        color: COLORS.textSecondary,
                      }}
                    >
                      {formatTime(prayer.prayer?.jummah)}
                    </span>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <span
                      style={{
                        fontFamily: TYPOGRAPHY.fontMono,
                        fontSize: 16,
                        fontWeight: 700,
                        color: COLORS.accent,
                        background: COLORS.accentLight,
                        padding: "6px 16px",
                        borderRadius: 999,
                      }}
                    >
                      {formatTime(prayer.prayer?.jummah_iqamah)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Early + Special */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: isMobile ? 16 : 20,
            }}
          >
            <div>
              <SectionLabel>Early Times</SectionLabel>
              <ChipRow isMobile={isMobile}>
                <Chip icon={Sunrise} label="Imsak" value={formatTime(prayer.early?.imsak)} color={COLORS.lapis} bg={COLORS.iconLapis} />
                <Chip icon={Sun} label="Sunrise" value={formatTime(prayer.early?.sunrise)} color={COLORS.accent} bg={COLORS.iconGold} />
                <Chip icon={Sun} label="Dhuha" value={formatTime(prayer.early?.dhuha)} color={COLORS.primary} bg={COLORS.iconGreen} />
              </ChipRow>
            </div>

            <div>
              <SectionLabel>Special Times</SectionLabel>
              <ChipRow isMobile={isMobile}>
                <Chip icon={Sun} label="Ishraq" value={formatTime(prayer.special?.ishraq)} color={COLORS.primary} bg={COLORS.iconGreen} />
                <Chip icon={MoonStar} label="Taraweeh" value={formatTime(prayer.special?.taraweeh)} color={COLORS.lapis} bg={COLORS.iconLapis} />
                <Chip icon={Sunset} label="Sunset" value={formatTime(prayer.special?.sunset)} color={COLORS.maroon} bg={COLORS.iconMaroon} />
              </ChipRow>
            </div>
          </div>

          {/* Notes + audit */}
          {(prayer.notes || prayer.updated_by) && (
            <div
              style={{
                marginTop: isMobile ? 24 : 30,
                paddingTop: 20,
                borderTop: `1px solid ${COLORS.divider}`,
              }}
            >
              {prayer.notes && (
                <p style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 8, lineHeight: 1.7 }}>
                  {prayer.notes}
                </p>
              )}
              {prayer.updated_by && (
                <p style={{ fontSize: 12.5, color: COLORS.textMuted }}>
                  Last updated by {prayer.updated_by}
                  {prayer.updated_at ? ` · ${new Date(prayer.updated_at).toLocaleString("en-IN")}` : ""}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Edit form */}
      {isEditing && form && (
        <div
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: isMobile ? 18 : 24,
            padding: isMobile ? 18 : 32,
            paddingBottom: isMobile ? 18 : 32,
            boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
            overflow: "hidden", // Prevents content from spilling out
          }}
        >
          <EditSection title="Early Times" isMobile={isMobile}>
            <TimeInput label="Imsak" value={form.imsak} onChange={(v) => setForm({ ...form, imsak: v })} isMobile={isMobile} period="AM" />
            <TimeInput label="Sunrise" value={form.sunrise} onChange={(v) => setForm({ ...form, sunrise: v })} isMobile={isMobile} period="AM" />
            <TimeInput label="Dhuha" value={form.dhuha} onChange={(v) => setForm({ ...form, dhuha: v })} isMobile={isMobile} period="AM" />
          </EditSection>

          <EditSection title="Adhan" isMobile={isMobile}>
            <TimeInput label="Fajr" value={form.fajr_adhan} onChange={(v) => setForm({ ...form, fajr_adhan: v })} isMobile={isMobile} period="AM" />
            <TimeInput label="Dhuhr" value={form.dhuhr_adhan} onChange={(v) => setForm({ ...form, dhuhr_adhan: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Asr" value={form.asr_adhan} onChange={(v) => setForm({ ...form, asr_adhan: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Maghrib" value={form.maghrib_adhan} onChange={(v) => setForm({ ...form, maghrib_adhan: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Isha" value={form.isha_adhan} onChange={(v) => setForm({ ...form, isha_adhan: v })} isMobile={isMobile} period="PM" />
          </EditSection>

          <EditSection title="Iqamah" isMobile={isMobile}>
            <TimeInput label="Fajr" value={form.fajr} onChange={(v) => setForm({ ...form, fajr: v })} isMobile={isMobile} period="AM" />
            <TimeInput label="Dhuhr" value={form.dhuhr} onChange={(v) => setForm({ ...form, dhuhr: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Asr" value={form.asr} onChange={(v) => setForm({ ...form, asr: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Maghrib" value={form.maghrib} onChange={(v) => setForm({ ...form, maghrib: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Isha" value={form.isha} onChange={(v) => setForm({ ...form, isha: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Jummah Adhan" value={form.jummah} onChange={(v) => setForm({ ...form, jummah: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Jummah Iqamah" value={form.jummah_iqamah} onChange={(v) => setForm({ ...form, jummah_iqamah: v })} isMobile={isMobile} period="PM" />
          </EditSection>

          <EditSection title="Special" isMobile={isMobile}>
            <TimeInput label="Ishraq" value={form.ishraq} onChange={(v) => setForm({ ...form, ishraq: v })} isMobile={isMobile} period="AM" />
            <TimeInput label="Taraweeh" value={form.taraweeh} onChange={(v) => setForm({ ...form, taraweeh: v })} isMobile={isMobile} period="PM" />
            <TimeInput label="Sunset" value={form.sunset} onChange={(v) => setForm({ ...form, sunset: v })} isMobile={isMobile} period="PM" />
          </EditSection>

          <div style={{ marginBottom: 28 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: COLORS.text,
                display: "block",
                marginBottom: 8,
                letterSpacing: "0.02em",
              }}
            >
              Notes
            </label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              style={{
                width: "100%",
                border: `1.5px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: "12px 16px",
                fontSize: 14,
                fontFamily: TYPOGRAPHY.fontBody,
                color: COLORS.text,
                outline: "none",
                resize: "vertical",
                transition: "border-color 0.2s, box-shadow 0.2s",
                background: COLORS.background,
                boxSizing: "border-box",
              }}
              placeholder="Any special announcement (Eid, Taraweeh schedule, etc.)"
              onFocus={(e) => {
                e.currentTarget.style.borderColor = COLORS.primary;
                e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = COLORS.border;
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          <div
            style={
              isMobile
                ? {
                    position: "sticky",
                    bottom: -18,
                    marginLeft: -18,
                    marginRight: -18,
                    marginBottom: -18,
                    padding: "14px 18px",
                    background: COLORS.surface,
                    borderTop: `1px solid ${COLORS.divider}`,
                    display: "flex",
                    gap: 12,
                    borderRadius: "0 0 18px 18px",
                    boxShadow: "0 -4px 16px rgba(0,0,0,0.05)",
                  }
                : { display: "flex", gap: 12, flexDirection: "row" }
            }
          >
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: isMobile ? 1 : "initial",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                height: 52,
                padding: "0 28px",
                border: "none",
                borderRadius: 12,
                background: COLORS.primary,
                color: COLORS.white,
                fontWeight: 700,
                fontSize: 15,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                transition: "box-shadow 0.2s, transform 0.1s",
              }}
              onMouseEnter={(e) => !saving && (e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.25)")}
              onMouseLeave={(e) => !saving && (e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)")}
            >
              <Check size={18} />
              {saving ? "Saving..." : "Save Timings"}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              disabled={saving}
              style={{
                flex: isMobile ? "0 0 auto" : "initial",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                height: 52,
                padding: "0 24px",
                border: `1.5px solid ${COLORS.border}`,
                borderRadius: 12,
                background: "transparent",
                color: COLORS.textSecondary,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                transition: "background 0.2s, border-color 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = COLORS.tableHover;
                e.currentTarget.style.borderColor = COLORS.textSecondary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = COLORS.border;
              }}
            >
              <X size={18} />
              {!isMobile && "Cancel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   SMALL PIECES
   ------------------------------------------------------------------ */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: COLORS.textMuted,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function TimePill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "lapis" | "primary" | "gold";
}) {
  const bg = tone === "lapis" ? COLORS.iconLapis : tone === "gold" ? COLORS.iconGold : COLORS.primaryLight;
  const color = tone === "lapis" ? COLORS.lapis : tone === "gold" ? COLORS.accent : COLORS.primary;

  return (
    <div
      style={{
        flex: 1,
        background: bg,
        borderRadius: 12,
        padding: "10px 14px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color, opacity: 0.7, marginBottom: 4, letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: TYPOGRAPHY.fontMono,
          fontSize: 15,
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ChipRow({ children, isMobile }: { children: React.ReactNode; isMobile: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 10 : 12 }}>{children}</div>
  );
}

function Chip({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: typeof Sun;
  label: string;
  value: string;
  color: string;
  bg: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: COLORS.surface,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 14,
        padding: "12px 16px",
        flex: "1 1 140px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        transition: "box-shadow 0.2s",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={16} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 2, letterSpacing: "0.04em" }}>
          {label}
        </div>
        <div
          style={{
            fontFamily: TYPOGRAPHY.fontMono,
            fontSize: 14,
            fontWeight: 600,
            color: COLORS.text,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function EditSection({ title, children, isMobile }: { title: string; children: React.ReactNode; isMobile: boolean }) {
  return (
    <div
      style={{
        marginBottom: 28,
        padding: isMobile ? 12 : 16,
        background: isMobile ? COLORS.background : "transparent",
        borderRadius: 16,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <SectionLabel>{title}</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: isMobile ? 14 : 16,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TimeInput({
  label,
  value,
  onChange,
  isMobile,
  period,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isMobile: boolean;
  period: "AM" | "PM";
}) {
  // On mobile – full‑width native time picker
  if (isMobile) {
    let val24 = value;
    if (value) {
      const clean = value.replace(/\s+/g, " ").trim();
      const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = match[2];
        if (match[3].toUpperCase() === "PM" && h !== 12) h += 12;
        if (match[3].toUpperCase() === "AM" && h === 12) h = 0;
        val24 = `${String(h).padStart(2, "0")}:${m}`;
      }
    }

    return (
      <div style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        <label
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: COLORS.textSecondary,
            display: "block",
            marginBottom: 6,
            letterSpacing: "0.03em",
          }}
        >
          {label}
        </label>
        <input
          type="time"
          value={val24 || ""}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            maxWidth: "100%",
            height: 50,
            border: `1.5px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: "0 14px",
            fontSize: 16,
            fontFamily: TYPOGRAPHY.fontMono,
            fontWeight: 600,
            color: COLORS.text,
            background: COLORS.surface,
            outline: "none",
            transition: "border-color 0.2s, box-shadow 0.2s",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = COLORS.primary;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = COLORS.border;
            e.currentTarget.style.boxShadow = "none";
          }}
        />
      </div>
    );
  }

  // Desktop – custom hour/minute selects with AM/PM badge
  // Value may be "HH:MM" (24h from a previous save) or "H:MM AM/PM" (12h from DB).
  let hour24: number | null = null;
  let mm = "";
  if (value) {
    const ampmMatch = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (ampmMatch) {
      let h = parseInt(ampmMatch[1], 10);
      if (ampmMatch[3].toUpperCase() === "PM" && h !== 12) h += 12;
      if (ampmMatch[3].toUpperCase() === "AM" && h === 12) h = 0;
      hour24 = h;
      mm = ampmMatch[2];
    } else {
      const parts = value.split(":");
      hour24 = parts[0] !== "" ? parseInt(parts[0], 10) : null;
      mm = parts[1] ?? "";
    }
  }
  const hour12 = hour24 !== null ? (hour24 % 12 === 0 ? 12 : hour24 % 12) : "";
  const hasValue = hour24 !== null;

  const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
  const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

  function commit(newHour12: number, newMinute: string) {
    let h = newHour12 % 12;
    if (period === "PM") h += 12;
    onChange(`${String(h).padStart(2, "0")}:${newMinute}`);
  }

  const selectStyle: React.CSSProperties = {
    flex: 1,
    height: 50,
    border: `1.5px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: "0 10px",
    fontSize: 16,
    fontFamily: TYPOGRAPHY.fontMono,
    fontWeight: 600,
    color: COLORS.text,
    background: COLORS.surface,
    outline: "none",
    textAlign: "center",
    appearance: "none",
    WebkitAppearance: "none",
    cursor: "pointer",
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  return (
    <div>
      <label
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: COLORS.textSecondary,
          display: "block",
          marginBottom: 8,
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: COLORS.background,
          border: `1px solid ${COLORS.divider}`,
          borderRadius: 14,
          padding: 8,
        }}
      >
        <select
          value={hour12}
          onChange={(e) => commit(parseInt(e.target.value, 10), mm || "00")}
          style={selectStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = COLORS.primary;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = COLORS.border;
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <option value="" disabled>
            --
          </option>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>

        <span style={{ color: COLORS.textMuted, fontWeight: 700, fontSize: 18 }}>:</span>

        <select
          value={mm || ""}
          onChange={(e) => commit(Number(hour12) || 12, e.target.value)}
          style={selectStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = COLORS.primary;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryLight}`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = COLORS.border;
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <option value="" disabled>
            --
          </option>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div
          style={{
            flexShrink: 0,
            height: 50,
            minWidth: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 12,
            background: hasValue
              ? period === "AM"
                ? COLORS.iconLapis
                : COLORS.iconGold
              : COLORS.divider,
            color: hasValue
              ? period === "AM"
                ? COLORS.lapis
                : COLORS.accent
              : COLORS.textMuted,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {period}
        </div>
      </div>
    </div>
  );
}