import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet, HandCoins, Receipt, TrendingUp, Users,
  AlertTriangle, CheckCircle2,
  Clock, RefreshCw, ArrowRight, X, Image as ImageIcon,
  WifiOff,
} from "lucide-react";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import { getDashboard, type FinanceDashboard } from "../../api/chanda";
import { getAccessToken } from "../../api/auth";
import { cachedFetch, formatCacheAge } from "../../utils/offlineCache";

// ─── helpers ─────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined) =>
  `₹${(n ?? 0).toLocaleString("en-IN")}`;

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const str = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(str);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function useViewport() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

// ─── Stat card ────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, accent, icon: Icon, onClick,
}: {
  label: string; value: string; sub?: string;
  accent: string; icon: typeof Wallet; onClick?: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{
        background: COLORS.surface, borderRadius: 16, padding: "20px 22px",
        border: `1px solid ${hov ? accent + "55" : COLORS.cardBorder}`,
        boxShadow: hov ? `0 6px 18px ${accent}22` : COLORS.shadowXs,
        transform: hov ? "translateY(-2px)" : "none",
        transition: "all 0.2s ease", cursor: onClick ? "pointer" : "default",
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: accent + "18", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={18} color={accent} strokeWidth={2.2} />
        </div>
        {onClick && <ArrowRight size={14} color={COLORS.textMuted} />}
      </div>
      <div>
        <div style={{
          fontFamily: TYPOGRAPHY.fontDisplay, fontSize: 30, fontWeight: 400,
          color: COLORS.text, letterSpacing: "0em", lineHeight: 1.1,
        }}>{value}</div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: COLORS.textSecondary, marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── Method breakdown bar ─────────────────────────────────────────────
function MethodBar({ cash, upi, other, total }: { cash: number; upi: number; other: number; total: number }) {
  if (!total) return null;
  const cashPct = (cash / total) * 100;
  const upiPct  = (upi / total) * 100;
  const otherPct = (other / total) * 100;
  return (
    <div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1, marginBottom: 10 }}>
        {cashPct > 0 && <div style={{ width: `${cashPct}%`, background: "#0F5C4C", borderRadius: "4px 0 0 4px" }} />}
        {upiPct  > 0 && <div style={{ width: `${upiPct}%`,  background: "#A9812E" }} />}
        {otherPct> 0 && <div style={{ width: `${otherPct}%`,background: "#5B8DB8", borderRadius: "0 4px 4px 0" }} />}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {[
          { label: "Cash", val: cash, color: "#0F5C4C" },
          { label: "GPay / UPI", val: upi, color: "#A9812E" },
          { label: "Other", val: other, color: "#5B8DB8" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 11, color: COLORS.textSecondary }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.text, fontFamily: TYPOGRAPHY.fontMono }}>{fmt(val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Progress ring ────────────────────────────────────────────────────
function ProgressRing({ pct, color }: { pct: number; color: string }) {
  const r = 30; const circ = 2 * Math.PI * r;
  const dash = ((Math.min(pct, 100) / 100) * circ).toFixed(1);
  return (
    <svg width={76} height={76} viewBox="0 0 76 76">
      <circle cx={38} cy={38} r={r} fill="none" stroke={color + "22"} strokeWidth={7} />
      <circle cx={38} cy={38} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 38 38)" />
      <text x={38} y={43} textAnchor="middle" fill={color}
        style={{ fontSize: 14, fontWeight: 700, fontFamily: TYPOGRAPHY.fontMono }}>
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

// ─── Payment detail modal ─────────────────────────────────────────────
function buildImgUrl(proof_image: string | null | undefined, backend: string): string | null {
  if (!proof_image) return null;
  if (proof_image.startsWith("http")) return proof_image;
  const base = backend.replace(/\/api\/?$/, "");
  if (proof_image.startsWith("/")) return `${base}${proof_image}`;
  return `${base}/${proof_image}`;
}

function PaymentModal({ p, onClose }: { p: any; onClose: () => void }) {
  const BACKEND = (import.meta as any).env?.VITE_API_URL || "";
  const imgUrl = buildImgUrl(p.proof_image, BACKEND);
  const isCollector = p.created_by !== "user";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.45)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: COLORS.surface, borderRadius: 20, width: "100%", maxWidth: 500,
          maxHeight: "90vh", overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 22px", borderBottom: `1px solid ${COLORS.divider}`,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>{p.head_name ?? "Payment"}</div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
              {p.receipt_id || `Payment #${p.id}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={20} color={COLORS.textMuted} />
          </button>
        </div>

        {/* Amount + method */}
        <div style={{ padding: "20px 22px", borderBottom: `1px solid ${COLORS.divider}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
            <span style={{ fontFamily: TYPOGRAPHY.fontDisplay, fontSize: 36, fontWeight: 700, color: COLORS.text }}>
              {fmt(p.amount)}
            </span>
            <span style={{
              background: COLORS.primaryLight, color: COLORS.primary,
              borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700,
              textTransform: "uppercase",
            }}>
              {(p.method || "cash").toUpperCase()}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: COLORS.success }} />
            <span style={{ fontSize: 12, color: COLORS.success, fontWeight: 600 }}>Verified</span>
          </div>
        </div>

        {/* Details */}
        <div style={{ padding: "16px 22px" }}>
          {[
            { label: "Collected by",    value: isCollector ? (p.collected_by || "Collector") : "Self (app)" },
            { label: "Date",            value: fmtDateTime(p.created_at) },
            { label: "Transaction Ref", value: p.transaction_ref || "—" },
            { label: "Notes",           value: p.notes || "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              padding: "9px 0", borderBottom: `1px solid ${COLORS.divider}`, gap: 16,
            }}>
              <span style={{ fontSize: 12, color: COLORS.textMuted, minWidth: 110 }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, textAlign: "right" }}>{value}</span>
            </div>
          ))}

          {/* Covered months */}
          {p.covered_months?.length > 0 && (
            <div style={{ padding: "9px 0", borderBottom: `1px solid ${COLORS.divider}` }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>Months Covered</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {p.covered_months.map((ym: string) => {
                  const [y, m] = ym.split("-");
                  const label = new Date(Number(y), Number(m) - 1, 1)
                    .toLocaleDateString("en-IN", { month: "short", year: "numeric" });
                  return (
                    <span key={ym} style={{
                      background: COLORS.primaryLight, color: COLORS.primary,
                      borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 600,
                    }}>{label}</span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Proof image */}
          {imgUrl ? (
            <div style={{ paddingTop: 14 }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>Payment Proof</div>
              <img
                src={imgUrl}
                alt="Proof"
                style={{ width: "100%", borderRadius: 10, border: `1px solid ${COLORS.border}`, objectFit: "contain", maxHeight: 320 }}
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          ) : isCollector && (
            <div style={{
              marginTop: 14, padding: "12px 14px", background: COLORS.warningLight,
              borderRadius: 10, display: "flex", alignItems: "center", gap: 8,
            }}>
              <ImageIcon size={14} color={COLORS.warning} />
              <span style={{ fontSize: 12, color: COLORS.warning }}>No proof image uploaded</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────
export default function DashboardPage() {
  const vw = useViewport();
  const mob = vw < 768;
  const navigate = useNavigate();

  const [dash, setDash] = useState<FinanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [cacheTime, setCacheTime] = useState<number | null>(null);
  const loadDataRef = useRef<() => void>(() => {});

  async function loadData() {
    try {
      const result = await cachedFetch("finance_dashboard", () => getDashboard());
      setDash(result.data);
      setIsOffline(result.fromCache);
      setCacheTime(result.cacheTime);
      setLastRefreshed(new Date());
    } catch (_) {} finally { setLoading(false); }
  }

  useEffect(() => {
    loadDataRef.current = loadData;
  });

  useEffect(() => { loadData(); }, []);

  // WebSocket live updates — use /ws/events (unified channel) so we don't
  // open a second /ws/finance connection alongside NotificationContext.
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const token = getAccessToken() || "";
    const wsUrl = `${proto}://${host}/ws/events${token ? `?token=${token}` : ""}`;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (["dashboard_updated","monthly_amount_updated","payment_verified","payment_collected"].includes(msg.type)) {
              loadDataRef.current();
            }
          } catch (_) {}
        };
        ws.onerror = () => {};
        ws.onclose = () => { retry = setTimeout(connect, 20_000); };
      } catch (_) {}
    };
    connect();
    return () => { ws?.close(); if (retry) clearTimeout(retry); };
  }, []);

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  const chanda = dash?.chanda;
  const month = dash?.collection_periods?.this_month as any;
  const totalFamilies = dash?.families?.total ?? 0;
  const paidCount = chanda?.paid ?? 0;
  const pendingCount = chanda?.pending ?? 0;
  const partialCount = chanda?.partial ?? 0;
  const collectionPct = chanda?.collection_pct ?? 0;
  const income = month?.total ?? 0;
  const cash  = month?.cash ?? 0;
  const upi   = month?.upi ?? 0;
  const other = income - cash - upi;
  const balance = dash?.balance ?? 0;
  const pendingVerification = dash?.pending_verification ?? 0;

  // Responsive breakpoints
  const cols3 = mob ? "1fr" : vw < 1024 ? "1fr 1fr" : "repeat(3, 1fr)";
  const cols2 = mob ? "1fr" : "1fr 1fr";
  const GAP   = mob ? 10 : 14;
  const MB    = mob ? 12 : 16;

  return (
    <div style={{ maxWidth: 1200, paddingBottom: 24 }}>
      {selectedPayment && <PaymentModal p={selectedPayment} onClose={() => setSelectedPayment(null)} />}

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: TYPOGRAPHY.fontDisplay, fontSize: mob ? 24 : 32,
            fontWeight: 400, letterSpacing: "0em", color: COLORS.text }}>
            Dashboard
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: COLORS.textSecondary }}>{today}</p>
        </div>
        <button onClick={() => { setLoading(true); loadData(); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px",
            border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surface,
            cursor: "pointer", fontSize: 12, color: COLORS.textSecondary }}>
          <RefreshCw size={12} />
          {lastRefreshed ? lastRefreshed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "Refresh"}
        </button>
      </div>

      {/* ── Offline indicator ── */}
      {isOffline && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
          background: "#FEF3D7", border: "1px solid #E8C84A55", borderRadius: 10, marginBottom: MB,
        }}>
          <WifiOff size={13} color="#B07A1E" />
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "#B07A1E" }}>Showing cached data</span>
          {cacheTime && (
            <span style={{ fontSize: 11, color: "#93998F", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={10} /> {formatCacheAge(cacheTime)}
            </span>
          )}
          <button onClick={() => { setLoading(true); loadData(); }}
            style={{ fontSize: 11, fontWeight: 700, color: "#B07A1E", background: "none", border: "1px solid #E8C84A88", borderRadius: 6, padding: "3px 9px", cursor: "pointer" }}>
            Refresh
          </button>
        </div>
      )}

      {/* ── Pending verification alert ── */}
      {pendingVerification > 0 && (
        <div onClick={() => navigate("/chanda")}
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
            background: "#FEF8E6", border: "1px solid #E8C84A44", borderRadius: 10,
            marginBottom: MB, cursor: "pointer",
          }}>
          <AlertTriangle size={15} color={COLORS.warning} />
          <span style={{ flex: 1, fontSize: 13, color: COLORS.warning, fontWeight: 600 }}>
            {pendingVerification} payment{pendingVerification > 1 ? "s" : ""} waiting for verification
          </span>
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>Go to Chanda →</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: COLORS.textMuted, fontSize: 14 }}>
          Loading dashboard…
        </div>
      ) : (
        <>
          {/* ── Top stat cards (3 col on desktop, 2 on tablet, 1 on mobile) ── */}
          <div style={{ display: "grid", gridTemplateColumns: cols3, gap: GAP, marginBottom: MB }}>
            <StatCard label="Balance (Donations − Expenses)" value={fmt(balance)}
              accent={balance >= 0 ? COLORS.primary : COLORS.danger}
              icon={TrendingUp}
              sub={`${fmt(dash?.donations?.total)} received · ${fmt(dash?.expenses?.total)} spent`} />
            <StatCard label="Income This Month" value={fmt(income)}
              accent={COLORS.accent} icon={Wallet}
              sub={`Cash ${fmt(cash)} · GPay/UPI ${fmt(upi)}`} />
            <StatCard label="Active Families" value={String(totalFamilies)}
              accent={COLORS.lapis} icon={Users}
              sub={`${paidCount} paid · ${pendingCount + partialCount} pending`}
              onClick={() => navigate("/chanda")} />
          </div>

          {/* ── Income method breakdown + chanda ring ── */}
          <div style={{ display: "grid", gridTemplateColumns: cols2, gap: GAP, marginBottom: MB }}>

            {/* Income by method */}
            <div style={{ background: COLORS.surface, borderRadius: 14, padding: "16px 18px", border: `1px solid ${COLORS.cardBorder}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 10 }}>
                Income this month — by method
              </div>
              <div style={{ fontFamily: TYPOGRAPHY.fontDisplay, fontSize: 30, fontWeight: 400, color: COLORS.text, marginBottom: 12 }}>
                {fmt(income)}
              </div>
              {income > 0 ? (
                <MethodBar cash={cash} upi={upi} other={Math.max(other, 0)} total={income} />
              ) : (
                <div style={{ fontSize: 13, color: COLORS.textMuted }}>No income recorded this month yet.</div>
              )}
            </div>

            {/* Chanda collection progress */}
            <div style={{ background: COLORS.surface, borderRadius: 14, padding: "16px 18px", border: `1px solid ${COLORS.cardBorder}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 10 }}>
                Chanda collection — {dash?.month}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <ProgressRing pct={collectionPct} color={COLORS.primary} />
                <div style={{ flex: 1 }}>
                  {[
                    { label: "Paid",     count: paidCount,    color: COLORS.primary },
                    { label: "Partial",  count: partialCount, color: COLORS.warning },
                    { label: "Not paid", count: pendingCount, color: COLORS.danger },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: color }} />
                        <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{label}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: TYPOGRAPHY.fontMono }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.divider}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: COLORS.textMuted }}>Collected / Due</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, fontFamily: TYPOGRAPHY.fontMono }}>
                  {fmt(chanda?.collected)} / {fmt(chanda?.due)}
                </span>
              </div>
              <button onClick={() => navigate("/chanda")}
                style={{ marginTop: 10, width: "100%", padding: "8px 0", background: COLORS.primaryLight,
                  border: `1px solid ${COLORS.primaryBorder}`, borderRadius: 9,
                  color: COLORS.primary, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                Manage Chanda →
              </button>
            </div>
          </div>

          {/* ── Who hasn't paid ── */}
          {pendingCount + partialCount > 0 && (
            <div style={{ background: COLORS.surface, borderRadius: 14, padding: "14px 18px", border: `1px solid ${COLORS.cardBorder}`, marginBottom: MB }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: COLORS.textMuted, textTransform: "uppercase" }}>
                  Haven't paid this month
                </div>
                <button onClick={() => navigate("/chanda")}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
                    background: COLORS.dangerLight, border: `1px solid ${COLORS.danger}22`,
                    borderRadius: 7, color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  <AlertTriangle size={11} /> View all
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "1fr 1fr 1fr", gap: GAP }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: COLORS.dangerLight, borderRadius: 10 }}>
                  <AlertTriangle size={18} color={COLORS.danger} />
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.danger, fontFamily: TYPOGRAPHY.fontMono }}>{pendingCount}</div>
                    <div style={{ fontSize: 10, color: COLORS.danger, opacity: 0.8 }}>Not paid at all</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: COLORS.warningLight, borderRadius: 10 }}>
                  <Clock size={18} color={COLORS.warning} />
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.warning, fontFamily: TYPOGRAPHY.fontMono }}>{partialCount}</div>
                    <div style={{ fontSize: 10, color: COLORS.warning, opacity: 0.8 }}>Partial payment</div>
                  </div>
                </div>
                {totalFamilies > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    background: COLORS.successLight, borderRadius: 10, ...(mob ? { gridColumn: "1 / -1" } : {}) }}>
                    <CheckCircle2 size={18} color={COLORS.success} />
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.success, fontFamily: TYPOGRAPHY.fontMono }}>{paidCount}</div>
                      <div style={{ fontSize: 10, color: COLORS.success, opacity: 0.8 }}>Fully paid</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Donation + Expense cards ── */}
          <div style={{ display: "grid", gridTemplateColumns: cols2, gap: GAP }}>
            <StatCard label="Total Donations" value={fmt(dash?.donations?.total)}
              accent={COLORS.accent} icon={HandCoins}
              sub={`${dash?.donations?.count ?? 0} donation${(dash?.donations?.count ?? 0) !== 1 ? "s" : ""}`}
              onClick={() => navigate("/donations")} />
            <StatCard label="Total Expenses" value={fmt(dash?.expenses?.total)}
              accent={COLORS.danger} icon={Receipt}
              sub={`${dash?.expenses?.count ?? 0} expense${(dash?.expenses?.count ?? 0) !== 1 ? "s" : ""}`}
              onClick={() => navigate("/expenses")} />
          </div>
        </>
      )}
    </div>
  );
}
