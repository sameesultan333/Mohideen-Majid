import { useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, Menu, Receipt, RefreshCw, X, CheckCircle, XCircle, Wallet, Clock, UserX } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { COLORS } from "../../theme/colors";
import { getCurrentUser } from "../../api/auth";
import { useNotifications, type NotifItem } from "../../context/NotificationContext";

import "../layout/layout.css";

const BASE_URL = (import.meta as any).env?.VITE_BACKEND_URL?.replace(/\/api$/, "")
  || (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/api$/, "")
  || "";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":     "Dashboard",
  "/families":      "Families",
  "/chanda":        "Chanda",
  "/donations":     "Donations",
  "/expenses":      "Expenses",
  "/reports":       "Reports",
  "/settings":      "Settings",
  "/prayer":        "Prayer Times",
  "/announcements": "Announcements",
  "/funds":         "Funds",
  "/staff":         "Staff Management",
  "/users":         "User Management",
  "/collections" : "Finance Timeline"
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const s = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function buildImageUrl(path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${BASE_URL}/${path.replace(/^\//, "")}`;
}

// ─── Media Query Hook ──────────────────────────────────────────────────────
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) setMatches(media.matches);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [matches, query]);
  return matches;
}

// ─── Kind label / badge colour ────────────────────────────────
const KIND_META: Record<NotifItem["kind"], { label: string; dot: string; icon: typeof Receipt }> = {
  pending_verification: { label: "Payment",   dot: "#D94A3A", icon: Receipt },
  expense_approval:     { label: "Expense",   dot: "#B07A1E", icon: Wallet },
  recent_collection:    { label: "Collected", dot: COLORS.primary, icon: CheckCircle },
  recent_donation:      { label: "Donation",  dot: "#6B3FA0", icon: Wallet },
  account_deletion:     { label: "Account Deleted", dot: "#5B6660", icon: UserX },
};

// ─── Single notification row ──────────────────────────────────
function NotifRow({
  item,
  isUnread,
  isLast,
  actioning,
  onVerify,
  onReject,
  onApprove,
  onLightbox,
}: {
  item: NotifItem;
  isUnread: boolean;
  isLast: boolean;
  actioning: string | null;
  onVerify: (id: number) => void;
  onReject: (id: number) => void;
  onApprove: (id: number) => void;
  onLightbox: (url: string) => void;
}) {
  const meta  = KIND_META[item.kind];
  const imgUrl = buildImageUrl(item.proof_image);
  const busy   = actioning === item.id;

  return (
    <div style={{
      padding: "13px 18px",
      borderBottom: isLast ? "none" : `1px solid ${COLORS.divider}`,
      background: isUnread ? "#FFFBF0" : "transparent",
      borderLeft: isUnread ? `3px solid ${meta.dot}` : "3px solid transparent",
    }}>
      {isUnread && (
        <div style={{ fontSize: 9, fontWeight: 800, color: meta.dot,
          letterSpacing: "0.08em", marginBottom: 5, textTransform: "uppercase" }}>
          {meta.label} · New
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {/* Thumbnail / icon */}
        {imgUrl ? (
          <img src={imgUrl} alt="proof"
            onClick={() => onLightbox(imgUrl)}
            onError={(e) => {
              const t = e.currentTarget;
              t.style.display = "none";
              const ph = t.nextElementSibling as HTMLElement | null;
              if (ph) ph.style.display = "flex";
            }}
            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8,
              border: `1px solid ${COLORS.border}`, cursor: "zoom-in", flexShrink: 0 }} />
        ) : null}
        <div style={{ width: 44, height: 44, borderRadius: 8, background: COLORS.tableHeader,
          border: `1px solid ${COLORS.border}`, display: imgUrl ? "none" : "flex",
          alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <meta.icon size={18} color={meta.dot} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row with kind pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.text }}>{item.title}</span>
            <span style={{ fontSize: 9, fontWeight: 800, background: meta.dot + "22",
              color: meta.dot, borderRadius: 6, padding: "1px 6px", flexShrink: 0 }}>
              {meta.label}
            </span>
          </div>
          <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
            {item.subtitle}
          </div>
          {/* Covered months */}
          {item.covered_months?.length > 0 && (
            <div style={{ fontSize: 10, color: COLORS.accent, marginTop: 2 }}>
              Covers: {item.covered_months.map((ym: string) => {
                const [y, m] = ym.split("-").map(Number);
                return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
              }).join(" · ")}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4,
            fontSize: 10, color: COLORS.textMuted, marginTop: 3 }}>
            <Clock size={9} />
            {fmtDateTime(item.created_at)}
            {item.receipt_id && <span>· {item.receipt_id}</span>}
          </div>

          {/* Action buttons */}
          {item.actionable && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {item.kind === "pending_verification" && (
                <>
                  <button disabled={busy} onClick={() => onVerify(item.ref_id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      background: COLORS.primaryLight, color: COLORS.primary,
                      border: `1px solid ${COLORS.primaryBorder}`, borderRadius: 7,
                      padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.5 : 1,
                    }}>
                    <CheckCircle size={11} /> {busy ? "…" : "Verify"}
                  </button>
                  <button disabled={busy} onClick={() => onReject(item.ref_id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      background: COLORS.dangerLight, color: COLORS.danger,
                      border: `1px solid ${COLORS.danger}44`, borderRadius: 7,
                      padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.5 : 1,
                    }}>
                    <XCircle size={11} /> Reject
                  </button>
                </>
              )}
              {item.kind === "expense_approval" && item.can_act && (
                <button disabled={busy} onClick={() => onApprove(item.ref_id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    background: "#FFF8E6", color: "#B07A1E",
                    border: "1px solid #E8C97A", borderRadius: 7,
                    padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.5 : 1,
                  }}>
                  <CheckCircle size={11} /> {busy ? "…" : "Approve"}
                </button>
              )}
              {item.kind === "expense_approval" && !item.can_act && (
                <span style={{ fontSize: 11, color: COLORS.textMuted, fontStyle: "italic" }}>
                  Another admin must approve
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Notification panel ───────────────────────────────────────
// Mobile-first: a true full-screen sheet on phones (position: fixed, inset: 0) so
// nothing can be positioned relative to the small bell icon and overflow the
// viewport. Desktop keeps the original anchored dropdown under the bell.
function NotificationPanel({ onClose }: { onClose(): void }) {
  const { items, unreadIds, loading, actioning, markAllRead, refresh,
          verifyPay, rejectPay, approveExpense } = useNotifications();
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | NotifItem["kind"]>("all");

  useEffect(() => { markAllRead(); }, [markAllRead]);

  // Lock background scroll while the full-screen mobile sheet is open.
  useEffect(() => {
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isMobile]);

  const filtered = filter === "all" ? items : items.filter(n => n.kind === filter);
  const pendingCount  = items.filter(n => n.kind === "pending_verification").length;
  const expenseCount  = items.filter(n => n.kind === "expense_approval").length;
  const recentCount   = items.filter(n => n.kind === "recent_collection").length;
  const donationCount = items.filter(n => n.kind === "recent_donation").length;

  const TAB_STYLE = (active: boolean, dot?: string) => ({
    padding: "5px 11px", borderRadius: 7, fontSize: 11.5, fontWeight: active ? 800 : 600,
    cursor: "pointer", border: "none", flexShrink: 0, whiteSpace: "nowrap" as const,
    background: active ? (dot ? dot + "22" : COLORS.primaryLight) : "transparent",
    color: active ? (dot || COLORS.primary) : COLORS.textMuted,
  });

  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed", inset: 0, width: "100vw", maxWidth: "100vw",
        height: "100dvh", background: "#fff", borderRadius: 0, boxShadow: "none",
        zIndex: 9000, display: "flex", flexDirection: "column", overflow: "hidden",
      }
    : {
        position: "absolute", top: "calc(100% + 8px)", right: 0,
        width: 400, maxWidth: "calc(100vw - 32px)",
        background: "#fff", borderRadius: 16,
        border: `1px solid ${COLORS.cardBorder}`,
        boxShadow: COLORS.shadowLg, zIndex: 9000,
        display: "flex", flexDirection: "column", overflow: "hidden",
      };

  return (
    <>
      {isMobile && (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 8999 }} />
      )}
      <div style={panelStyle}>
        {/* Header */}
        <div style={{
          flexShrink: 0,
          padding: isMobile ? "16px 16px 10px" : "14px 18px 10px",
          borderBottom: `1px solid ${COLORS.divider}`,
          background: COLORS.tableHeader,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Bell size={isMobile ? 16 : 14} color={COLORS.accent} />
              <span style={{ fontWeight: 700, fontSize: isMobile ? 16 : 14, color: COLORS.text }}>Notifications</span>
              {items.length > 0 && (
                <span style={{ background: "#D94A3A", color: "#fff", borderRadius: 999,
                  padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>
                  {items.length}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <button onClick={() => refresh()} title="Refresh"
                style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 7,
                  width: isMobile ? 32 : 26, height: isMobile ? 32 : 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <RefreshCw size={isMobile ? 13 : 11} color={COLORS.textMuted}
                  style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
              </button>
              <button onClick={onClose}
                style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 7,
                  width: isMobile ? 32 : 26, height: isMobile ? 32 : 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <X size={isMobile ? 14 : 11} color={COLORS.textMuted} />
              </button>
            </div>
          </div>
          {/* Filter tabs — horizontally scrollable so they never clip off-screen */}
          <div style={{ display: "flex", gap: 5, overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 2 }}>
            <button style={TAB_STYLE(filter === "all")} onClick={() => setFilter("all")}>
              All ({items.length})
            </button>
            {pendingCount > 0 && (
              <button style={TAB_STYLE(filter === "pending_verification", "#D94A3A")}
                onClick={() => setFilter("pending_verification")}>
                Payments ({pendingCount})
              </button>
            )}
            {expenseCount > 0 && (
              <button style={TAB_STYLE(filter === "expense_approval", "#B07A1E")}
                onClick={() => setFilter("expense_approval")}>
                Expenses ({expenseCount})
              </button>
            )}
            {recentCount > 0 && (
              <button style={TAB_STYLE(filter === "recent_collection", COLORS.primary)}
                onClick={() => setFilter("recent_collection")}>
                Recent ({recentCount})
              </button>
            )}
            {donationCount > 0 && (
              <button style={TAB_STYLE(filter === "recent_donation", "#6B3FA0")}
                onClick={() => setFilter("recent_donation")}>
                Donations ({donationCount})
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, maxHeight: isMobile ? "none" : 500 }}>
          {loading && filtered.length === 0 ? (
            <div style={{ padding: "28px 18px", textAlign: "center", color: COLORS.textMuted, fontSize: 13 }}>
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "36px 18px", textAlign: "center" }}>
              <CheckCircle size={30} color={COLORS.primary} style={{ opacity: 0.35, marginBottom: 10 }} />
              <div style={{ fontSize: 13, color: COLORS.textSecondary, fontWeight: 600 }}>All caught up</div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
                {filter === "pending_verification" ? "No payments awaiting verification"
                  : filter === "expense_approval" ? "No expenses awaiting approval"
                  : "No recent collections"}
              </div>
            </div>
          ) : filtered.map((item, i) => (
            <NotifRow
              key={item.id}
              item={item}
              isUnread={unreadIds.has(item.id)}
              isLast={i === filtered.length - 1}
              actioning={actioning}
              onVerify={() => verifyPay(item.ref_id)}
              onReject={() => rejectPay(item.ref_id)}
              onApprove={() => approveExpense(item.ref_id)}
              onLightbox={setLightbox}
            />
          ))}
        </div>

        {/* Footer */}
        {(pendingCount > 0 || expenseCount > 0) && (
          <div style={{
            flexShrink: 0, padding: isMobile ? "12px 16px" : "10px 18px",
            borderTop: `1px solid ${COLORS.divider}`,
            background: COLORS.tableHeader, display: "flex", gap: 8,
            paddingBottom: isMobile ? "calc(12px + env(safe-area-inset-bottom))" : "10px",
          }}>
            {pendingCount > 0 && (
              <button onClick={() => { onClose(); navigate("/chanda"); }}
                style={{ flex: 1, padding: "9px 0", background: COLORS.primaryLight,
                  border: `1px solid ${COLORS.primaryBorder}`, borderRadius: 9,
                  color: COLORS.primary, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                Chanda →
              </button>
            )}
            {expenseCount > 0 && (
              <button onClick={() => { onClose(); navigate("/expenses"); }}
                style={{ flex: 1, padding: "9px 0", background: "#FFF8E6",
                  border: "1px solid #E8C97A", borderRadius: 9,
                  color: "#B07A1E", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                Expenses →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, cursor: "zoom-out" }}>
          <img src={lightbox} alt="proof"
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }} />
        </div>
      )}
    </>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
interface HeaderProps { onMenuClick: () => void; }

export default function Header({ onMenuClick }: HeaderProps) {
  const user = getCurrentUser();
  const location = useLocation();
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const pageTitle = PAGE_TITLES[location.pathname] ?? "Dashboard";
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const initials = (user?.name ?? "Admin")
    .split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-menu-btn" onClick={onMenuClick} aria-label="Open menu">
          <Menu size={22} />
        </button>
        <div className="header-titles">
          <h1>{pageTitle}</h1>
          <p>{today}</p>
        </div>
      </div>

      <div className="header-right">
        <button className="header-icon-btn" aria-label="Calendar">
          <CalendarDays size={19} />
        </button>

        {/* ── Bell button with unread badge ── */}
        <div ref={bellRef} style={{ position: "relative" }}>
          <button className="header-icon-btn" aria-label="Notifications"
            onClick={() => setOpen(v => !v)} style={{ position: "relative" }}>
            <Bell size={19} />
            {unreadCount > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#D94A3A", color: "#fff",
                borderRadius: 999, fontSize: 9, fontWeight: 800,
                minWidth: 16, height: 16, display: "flex",
                alignItems: "center", justifyContent: "center",
                padding: "0 3px", lineHeight: 1, border: "2px solid #fff",
              }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          {open && <NotificationPanel onClose={() => setOpen(false)} />}
        </div>

        <div className="user-box">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <h3>{user?.name ?? "Administrator"}</h3>
            <p>{user?.role ?? "Admin"}</p>
          </div>
        </div>
      </div>
    </header>
  );
}