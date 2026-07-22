/**
 * NotificationContext — unified admin notification feed.
 * Sources: pending payment verifications, expense approvals, recent collections.
 * WebSocket keeps it live; persists unread IDs to localStorage.
 */
import {
  createContext, useContext, useEffect, useRef, useState,
  useCallback, type ReactNode,
} from "react";
import api from "../api/axios";
import { getAccessToken } from "../api/auth";
import { verifyPayment, rejectPayment } from "../api/chanda";

const UNREAD_KEY = "notif_unread_ids";
// Separate from UNREAD_KEY on purpose: "seen" tracks every item id this
// browser has ever encountered, "unread" tracks which of those are still
// unacknowledged. Seeding seenIdsRef from the unread set was the actual bug
// here — markAllRead() empties the unread set the instant the bell opens,
// so a page reload right after would re-seed "seen" as empty too, making
// every already-existing pending item look brand-new and re-mark itself
// unread on the very next refresh (the badge count randomly ballooning
// back up after being cleared).
const SEEN_KEY = "notif_seen_ids";

export interface NotifItem {
  id: string;                 // "pay_123" | "exp_45" | "col_67"
  kind: "pending_verification" | "expense_approval" | "recent_collection" | "recent_donation" | "account_deletion";
  ref_id: number;
  title: string;
  subtitle: string;
  amount: number;
  method: string | null;
  proof_image: string | null;
  payer_name: string | null;
  paid_by_name: string | null;
  head_id: number | null;
  covered_months: string[];
  receipt_id: string | null;
  created_at: string | null;
  actionable: boolean;
  can_act: boolean;
  transaction_ref?: string | null;
}

function getStoredUnread(): Set<string> {
  try {
    const raw = localStorage.getItem(UNREAD_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function saveUnread(ids: Set<string>) {
  localStorage.setItem(UNREAD_KEY, JSON.stringify([...ids]));
}
function getStoredSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function saveSeen(ids: Set<string>) {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
}

interface NotifCtx {
  items: NotifItem[];
  unreadIds: Set<string>;
  unreadCount: number;
  loading: boolean;
  actioning: string | null;
  markAllRead: () => void;
  refresh: () => Promise<void>;
  verifyPay: (paymentId: number) => Promise<void>;
  rejectPay: (paymentId: number) => Promise<void>;
  approveExpense: (expenseId: number) => Promise<void>;
  // legacy compat — ChandaDashboard still calls these
  verify: (id: number) => Promise<void>;
  reject: (id: number) => Promise<void>;
  // pending payment items only (for PendingVerificationPanel)
  pendingPayments: NotifItem[];
  // sidebar badge counts
  pendingRegCount: number;
  cashSubCount: number;
}

const Ctx = createContext<NotifCtx | null>(null);

export function useNotifications() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNotifications must be used inside NotificationProvider");
  return c;
}

async function fetchNotifications(): Promise<NotifItem[]> {
  const { data } = await api.get<NotifItem[]>("/finance/notifications");
  return Array.isArray(data) ? data : [];
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems]         = useState<NotifItem[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(getStoredUnread);
  const [loading, setLoading]     = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [pendingRegCount, setPendingRegCount] = useState(0);
  const [cashSubCount, setCashSubCount]       = useState(0);

  // Track IDs already seen so we can detect genuinely new items across refreshes.
  const seenIdsRef = useRef<Set<string>>(getStoredSeen());

  const markUnread = useCallback((ids: string[]) => {
    setUnreadIds(prev => {
      const next = new Set([...prev, ...ids]);
      saveUnread(next);
      return next;
    });
  }, []);

  const fetchBadgeCounts = useCallback(async () => {
    try {
      const [regs, subs] = await Promise.all([
        api.get<any[]>("/admin/pending-registrations").then(r => r.data),
        api.get<any[]>("/collector/admin/cash-submissions").then(r => r.data),
      ]);
      setPendingRegCount(Array.isArray(regs) ? regs.length : 0);
      setCashSubCount(Array.isArray(subs) ? subs.filter((s: any) => s.status === "pending").length : 0);
    } catch { /* non-critical — ignore errors */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const list = await fetchNotifications();

      // Any actionable item not seen before counts as unread. recent_collection
      // and recent_donation are activity-feed entries with no resolve action —
      // they'd otherwise sit unread forever with nothing for the admin to do.
      const newIds = list
        .filter(n => n.kind !== "recent_collection" && n.kind !== "recent_donation" && !seenIdsRef.current.has(n.id))
        .map(n => n.id);

      // Record everything as seen now.
      list.forEach(n => seenIdsRef.current.add(n.id));
      saveSeen(seenIdsRef.current);

      setItems(list);

      setUnreadIds(prev => {
        const liveIds = new Set(list.map(n => n.id));
        // Keep existing unread that are still live, add new ones, prune stale.
        const next = new Set([...prev].filter(id => liveIds.has(id)));
        newIds.forEach(id => next.add(id));
        saveUnread(next);
        return next;
      });
    } catch (e) {
      console.error("[Notif] refresh failed", e);
    } finally { setLoading(false); }
  }, []);

  const markAllRead = useCallback(() => {
    setUnreadIds(prev => {
      if (prev.size === 0) return prev;
      saveUnread(new Set());
      return new Set();
    });
  }, []);

  const verifyPay = useCallback(async (paymentId: number) => {
    const key = `pay_${paymentId}`;
    setActioning(key);
    try {
      await verifyPayment(paymentId);
      setItems(prev => prev.filter(n => n.id !== key));
      setUnreadIds(prev => { const n = new Set(prev); n.delete(key); saveUnread(n); return n; });
    } finally { setActioning(null); }
  }, []);

  const rejectPay = useCallback(async (paymentId: number) => {
    const key = `pay_${paymentId}`;
    setActioning(key);
    try {
      await rejectPayment(paymentId);
      setItems(prev => prev.filter(n => n.id !== key));
      setUnreadIds(prev => { const n = new Set(prev); n.delete(key); saveUnread(n); return n; });
    } finally { setActioning(null); }
  }, []);

  const approveExpense = useCallback(async (expenseId: number) => {
    const key = `exp_${expenseId}`;
    setActioning(key);
    try {
      await api.patch(`/finance/expenses/${expenseId}/approve-from-notif`);
      setItems(prev => prev.filter(n => n.id !== key));
      setUnreadIds(prev => { const n = new Set(prev); n.delete(key); saveUnread(n); return n; });
    } finally { setActioning(null); }
  }, []);

  // Initial load
  useEffect(() => { refresh(); fetchBadgeCounts(); }, [refresh, fetchBadgeCounts]);

  // Refresh badge counts every 60 s
  useEffect(() => {
    const t = setInterval(fetchBadgeCounts, 60_000);
    return () => clearInterval(t);
  }, [fetchBadgeCounts]);

  // WebSocket
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });
  const fetchBadgeCountsRef = useRef(fetchBadgeCounts);
  useEffect(() => { fetchBadgeCountsRef.current = fetchBadgeCounts; });

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const apiBase = (import.meta as any).env?.VITE_BACKEND_URL || "";
    const host = apiBase ? new URL(apiBase).host : window.location.host;
    const token = getAccessToken() || "";
    // /ws/finance only ever carried the "finance" channel — every "admin"
    // channel event (new registrations, staff created, role changes) was
    // silently invisible here regardless of what the backend published.
    // /ws/events is the unified stream that carries every channel.
    const url = `${proto}://${host}/ws/events${token ? `?token=${token}` : ""}`;

    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(url);
        ws.onmessage = async (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "payment_pending") {
              await refreshRef.current();
              if (msg.data?.payment_id) markUnread([`pay_${msg.data.payment_id}`]);
            } else if (msg.type === "expense_created") {
              await refreshRef.current();
              if (msg.data?.expense_id) markUnread([`exp_${msg.data.expense_id}`]);
            } else if (msg.type === "donation_created") {
              await refreshRef.current();
              if (msg.data?.donation_id) markUnread([`don_${msg.data.donation_id}`]);
            } else if (
              ["payment_verified", "payment_rejected", "expense_approved",
               "payment_collected", "dashboard_updated"].includes(msg.type)
            ) {
              refreshRef.current();
            } else if (
              ["registration_pending", "registration_approved", "registration_rejected"].includes(msg.type)
            ) {
              // Pending-registration count previously only updated on the 60s
              // poll — this makes a new self-registration show up immediately.
              fetchBadgeCountsRef.current();
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => {};
        ws.onclose = () => { retryTimer = setTimeout(connect, 15_000); };
      } catch { /* ignore */ }
    };

    connect();
    return () => {
      ws?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [markUnread]);

  const unreadCount = [...unreadIds].filter(id => items.some(n => n.id === id)).length;
  const pendingPayments = items.filter(n => n.kind === "pending_verification");

  return (
    <Ctx.Provider value={{
      items, unreadIds, unreadCount, loading, actioning,
      markAllRead, refresh, verifyPay, rejectPay, approveExpense,
      // legacy compat aliases used by ChandaDashboard PendingVerificationPanel
      verify: verifyPay, reject: rejectPay,
      pendingPayments,
      pendingRegCount, cashSubCount,
    }}>
      {children}
    </Ctx.Provider>
  );
}
