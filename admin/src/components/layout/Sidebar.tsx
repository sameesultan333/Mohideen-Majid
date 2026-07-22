import {
  LayoutDashboard,
  Users,
  Wallet,
  HandCoins,
  Receipt,
  LogOut,
  Landmark,
  Clock3,
  X,
  ShieldCheck,
  PiggyBank,
  Megaphone,
  History,
  Lock,
  UserCheck,
  Banknote,
} from "lucide-react";

import { NavLink, useNavigate } from "react-router-dom";

import "../layout/layout.css";

import { logout, getCurrentUser } from "../../api/auth";
import { useNotifications } from "../../context/NotificationContext";

// Each notification kind is only actionable from one specific page — a
// generic total on the Chanda link meant an unread expense/donation/account
// -deletion item (nothing to do with Chanda) left a badge that never
// cleared no matter how many times you opened Chanda. Route each kind's
// unread count to its own nav item instead.
function useUnreadByKind() {
  const { items, unreadIds } = useNotifications();
  const count = (kind: string) =>
    items.filter(n => n.kind === kind && unreadIds.has(n.id)).length;
  return {
    chanda: count("pending_verification"),
    expenses: count("expense_approval"),
  };
}

const NAV_ITEMS = [
  { to: "/dashboard",   label: "Dashboard",        icon: LayoutDashboard },
  { to: "/prayer",      label: "Prayer Timings",   icon: Clock3          },
  { to: "/users",       label: "Users",             icon: Users           },
  { to: "/staff",       label: "Staff Management", icon: ShieldCheck     },
  { to: "/chanda",      label: "Chanda",            icon: Wallet          },
  { to: "/funds",       label: "Funds",             icon: PiggyBank       },
  { to: "/donations",   label: "Donations",         icon: HandCoins       },
  { to: "/expenses",    label: "Expenses",          icon: Receipt         },
  { to: "/announcements", label: "Announcements",  icon: Megaphone       },
  { to: "/collections", label: "Finance Timeline", icon: History         },
  { to: "/pending-registrations", label: "Pending Registrations", icon: UserCheck },
  { to: "/cash-submissions",      label: "Cash Submissions",      icon: Banknote  },
];
interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const { pendingRegCount, cashSubCount } = useNotifications();
  const unreadByKind = useUnreadByKind();
  const isSuperAdmin = getCurrentUser()?.role === "superadmin";

  async function handleLogout() {
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <>
      {/* Backdrop (mobile only, shown when drawer open) */}
      <div
        className={`sidebar-backdrop ${isOpen ? "visible" : ""}`}
        onClick={onClose}
      />

      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <Landmark size={22} />
          </div>

          <div className="sidebar-title">
            <h2>Mohideen Masjid</h2>
            <p>Administration</p>
          </div>

          <button
            className="sidebar-close-btn"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-menu">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            let badge = 0;
            if (to === "/chanda") badge = unreadByKind.chanda;
            if (to === "/expenses") badge = unreadByKind.expenses;
            if (to === "/pending-registrations" && pendingRegCount > 0) badge = pendingRegCount;
            if (to === "/cash-submissions" && cashSubCount > 0) badge = cashSubCount;
            return (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <Icon size={20} strokeWidth={2} />
                <span style={{ flex: 1 }}>{label}</span>
                {badge > 0 && (
                  <span style={{
                    background: "#D94A3A", color: "#fff",
                    borderRadius: 10, fontSize: 10, fontWeight: 800,
                    minWidth: 18, height: 18, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    padding: "0 5px", lineHeight: 1,
                  }}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </NavLink>
            );
          })}

          {/* Audit — Super Admin only */}
          {isSuperAdmin && (
            <NavLink
              to="/audit"
              onClick={onClose}
              className={({ isActive }) => (isActive ? "active" : "")}
              style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 6, paddingTop: 10 }}
            >
              <Lock size={20} strokeWidth={2} />
              <span style={{ flex: 1 }}>Audit</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}