import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Filter,
  Info,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import type { AuditFilters, AuditLog, AuditStats } from "../../api/audit";
import { fetchAuditLogs, fetchAuditStats, auditExcelUrl } from "../../api/audit";
import { getCurrentUser } from "../../api/auth";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";

// ─── cache helpers ────────────────────────────────────────────
const ITEMS_KEY = "audit_items_v3";
const STATS_KEY = "audit_stats_v3";
const SYNC_KEY  = "audit_sync_v3";

function sc<T>(key: string, v: T) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
function lc<T>(key: string): T | null {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}
function fmtSync(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso), diff = Date.now() - d.getTime(), m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── constants ────────────────────────────────────────────────
const MODULES = [
  "Authentication","Users","Families","Prayer","Finance",
  "Donations","Expenses","Announcements","Questions","Hadith",
  "Funds","Collector","Notifications","System",
  "collector_cash_submissions",
];
const ROLES    = ["superadmin","admin","imam","collector","member"];
const STATUSES = ["success","failed","warning","critical"];

const STATUS_CFG = {
  success:  { label: "Success",  bg: COLORS.successLight,  fg: COLORS.success, icon: <CheckCircle2 size={13}/> },
  failed:   { label: "Failed",   bg: COLORS.dangerLight,   fg: COLORS.danger,  icon: <XCircle size={13}/> },
  warning:  { label: "Warning",  bg: COLORS.warningLight,  fg: COLORS.warning, icon: <AlertTriangle size={13}/> },
  critical: { label: "Critical", bg: "#F3E8FF",            fg: "#7E22CE",      icon: <ShieldAlert size={13}/> },
  info:     { label: "Info",     bg: COLORS.infoLight,     fg: COLORS.info,    icon: <Info size={13}/> },
} as const;
type StatusKey = keyof typeof STATUS_CFG;

function statusCfg(s: string) {
  return STATUS_CFG[(s as StatusKey)] ?? STATUS_CFG.info;
}

function fmtTs(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" })
    + " " + d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
}

// ─── inject keyframes once ────────────────────────────────────
{
  const id = "audit-kf";
  if (!document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.innerHTML = `
      @keyframes auditFadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
      @keyframes auditSpin   { to{transform:rotate(360deg)} }
    `;
    document.head.appendChild(s);
  }
}

// ─── styles ───────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  page:         { padding:"16px", maxWidth:"1400px", margin:"0 auto", display:"flex", flexDirection:"column", gap:"16px" },
  header:       { display:"flex", flexWrap:"wrap", justifyContent:"space-between", alignItems:"center", gap:"12px" },
  titleWrap:    { display:"flex", alignItems:"center", gap:"10px" },
  iconWrap:     { width:"40px", height:"40px", borderRadius:"10px", background:COLORS.primaryLight, display:"flex", alignItems:"center", justifyContent:"center", color:COLORS.primary, flexShrink:0 },
  title:        { fontFamily:TYPOGRAPHY.fontDisplay, fontSize:"32px", fontWeight:400, color:COLORS.text, margin:0, letterSpacing:"0" },
  subtitle:     { fontSize:"13px", color:COLORS.textSecondary, margin:0 },
  headerActions:{ display:"flex", gap:"8px", alignItems:"center" },

  btnPrimary:   { height:"38px", padding:"0 16px", borderRadius:"10px", background:COLORS.primary, color:"#fff", fontWeight:600, fontSize:"13px", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:"6px", boxShadow:COLORS.shadowPrimary },
  btnOutline:   { height:"38px", padding:"0 14px", borderRadius:"10px", border:`1px solid ${COLORS.border}`, background:COLORS.surface, fontSize:"13px", cursor:"pointer", color:COLORS.textSecondary, fontWeight:500, display:"flex", alignItems:"center", gap:"6px", transition:"background 0.2s" },
  btnIcon:      { width:"36px", height:"36px", borderRadius:"8px", border:`1px solid ${COLORS.border}`, background:COLORS.surface, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:COLORS.textSecondary },
  btnGhost:     { background:"none", border:"none", cursor:"pointer", color:COLORS.textSecondary, fontSize:"13px", padding:"6px 8px", borderRadius:"6px", display:"flex", alignItems:"center", gap:"4px" },

  offlineBanner:{ background:COLORS.warningLight, color:COLORS.warning, border:`1px solid ${COLORS.warning}`, borderRadius:"12px", padding:"10px 16px", fontSize:"13px", fontWeight:500, display:"flex", alignItems:"center", gap:"8px" },
  forbidden:    { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"12px", minHeight:"60vh", textAlign:"center" },

  statsGrid:    { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))", gap:"12px" },
  statCard:     { background:COLORS.surface, border:`1px solid ${COLORS.cardBorder}`, borderRadius:"14px", padding:"14px 16px", boxShadow:COLORS.shadowXs },
  statValue:    { fontSize:"28px", fontWeight:700, lineHeight:1, letterSpacing:"-0.02em" },
  statLabel:    { fontSize:"12px", color:COLORS.textSecondary, fontWeight:500, marginTop:"4px" },

  toolbar:      { display:"flex", flexWrap:"wrap", gap:"10px", alignItems:"center" },
  searchWrap:   { position:"relative", flex:1, minWidth:"200px" },
  searchIcon:   { position:"absolute", left:"11px", top:"50%", transform:"translateY(-50%)", color:COLORS.textMuted, pointerEvents:"none" },
  searchInput:  { width:"100%", height:"40px", padding:"0 14px 0 36px", border:`1px solid ${COLORS.border}`, borderRadius:"10px", background:COLORS.surface, fontSize:"14px", outline:"none", color:COLORS.text, boxSizing:"border-box" as const },
  filterBadge:  { background:COLORS.primary, color:"#fff", borderRadius:"999px", fontSize:"11px", minWidth:"18px", height:"18px", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 5px" },
  totalLabel:   { fontSize:"13px", color:COLORS.textSecondary, whiteSpace:"nowrap" as const, marginLeft:"auto" },

  filterPanel:  { background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:"14px", padding:"16px", animation:"auditFadeIn 0.2s ease" },
  filterRow:    { display:"flex", flexWrap:"wrap", gap:"14px", alignItems:"flex-end" },
  filterGroup:  { display:"flex", flexDirection:"column", gap:"5px", minWidth:"130px" },
  filterLabel:  { fontSize:"11px", fontWeight:700, color:COLORS.textMuted, textTransform:"uppercase" as const, letterSpacing:"0.05em" },
  filterSelect: { height:"36px", padding:"0 10px", border:`1px solid ${COLORS.border}`, borderRadius:"8px", background:COLORS.surface, fontSize:"13px", color:COLORS.text, outline:"none" },
  filterInput:  { height:"36px", padding:"0 10px", border:`1px solid ${COLORS.border}`, borderRadius:"8px", background:COLORS.surface, fontSize:"13px", color:COLORS.text, outline:"none" },
  pillRow:      { display:"flex", flexWrap:"wrap", gap:"6px" },

  tableCard:    { background:COLORS.surface, border:`1px solid ${COLORS.cardBorder}`, borderRadius:"16px", boxShadow:COLORS.shadowSm, overflow:"hidden", animation:"auditFadeIn 0.3s ease" },

  th:           { padding:"11px 14px", textAlign:"left" as const, fontWeight:600, color:COLORS.textSecondary, fontSize:"11px", textTransform:"uppercase" as const, letterSpacing:"0.04em", background:COLORS.tableHeader, borderBottom:`1px solid ${COLORS.border}`, whiteSpace:"nowrap" as const },
  td:           { padding:"11px 14px", borderBottom:`1px solid ${COLORS.divider}`, color:COLORS.text, verticalAlign:"middle" as const, fontSize:"13px" },
  emptyCell:    { padding:"60px 20px", textAlign:"center" as const, color:COLORS.textMuted, fontSize:"14px" },

  pagination:   { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", borderTop:`1px solid ${COLORS.border}`, fontSize:"13px", color:COLORS.textSecondary, flexWrap:"wrap" as const, gap:"8px" },
  pageBtn:      { height:"32px", padding:"0 12px", border:`1px solid ${COLORS.border}`, borderRadius:"8px", background:COLORS.surface, cursor:"pointer", fontSize:"13px", color:COLORS.text },

  overlay:      { position:"fixed" as const, inset:0, background:COLORS.overlay, zIndex:1000, display:"flex", justifyContent:"flex-end" },
  drawer:       { width:"min(520px,96vw)", background:COLORS.surface, height:"100%", display:"flex", flexDirection:"column", boxShadow:"-4px 0 32px rgba(0,0,0,0.12)", animation:"auditFadeIn 0.2s ease" },
  drawerHeader: { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px", borderBottom:`1px solid ${COLORS.border}`, flexShrink:0 },
  drawerTitle:  { display:"flex", alignItems:"center", gap:"8px", fontWeight:700, fontSize:"15px", color:COLORS.text },
  drawerBody:   { flex:1, overflowY:"auto" as const, padding:"16px 20px", display:"flex", flexDirection:"column", gap:"16px" },
  sectionHead:  { fontSize:"11px", fontWeight:700, color:COLORS.textMuted, textTransform:"uppercase" as const, letterSpacing:"0.05em", margin:"0 0 8px" },
  fieldRow:     { display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"6px 0", borderBottom:`1px solid ${COLORS.divider}`, fontSize:"13px", gap:"12px" },
  fieldLabel:   { color:COLORS.textSecondary, flexShrink:0 },
  fieldValue:   { color:COLORS.text, fontWeight:500, textAlign:"right" as const, wordBreak:"break-all" as const },

  jsonBlock:    { background:COLORS.backgroundAlt, borderRadius:"8px", padding:"10px 12px", fontFamily:"monospace", fontSize:"12px", overflowX:"auto" as const, maxHeight:"200px", overflowY:"auto" as const, whiteSpace:"pre-wrap" as const, wordBreak:"break-word" as const },
};

// ─── component ────────────────────────────────────────────────
export default function AuditPage() {
  const user         = getCurrentUser();
  const isSuperAdmin = user?.role === "superadmin";

  const [logs,       setLogs]       = useState<AuditLog[]>([]);
  const [stats,      setStats]      = useState<AuditStats | null>(null);
  const [total,      setTotal]      = useState(0);
  const [pages,      setPages]      = useState(1);
  const [loading,    setLoading]    = useState(false);
  const [offline,    setOffline]    = useState(false);
  const [syncTime,   setSyncTime]   = useState<string | null>(lc(SYNC_KEY));
  const [selected,   setSelected]   = useState<AuditLog | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [filters,    setFilters]    = useState<AuditFilters>({ page:1, per_page:100 });

  const searchRef  = useRef<HTMLInputElement>(null);
  const debRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (f: AuditFilters) => {
    setLoading(true);
    try {
      const [res, st] = await Promise.all([fetchAuditLogs(f), fetchAuditStats()]);
      const items = Array.isArray(res.items) ? res.items : [];
      setLogs(items);
      setTotal(res.total ?? 0);
      setPages(res.pages ?? 1);
      setStats(st);
      setOffline(false);
      sc(ITEMS_KEY, items);
      sc(STATS_KEY, st);
      const now = new Date().toISOString();
      sc(SYNC_KEY, now);
      setSyncTime(now);
    } catch {
      setOffline(true);
      const ci = lc<AuditLog[]>(ITEMS_KEY);
      const cs = lc<AuditStats>(STATS_KEY);
      if (Array.isArray(ci)) setLogs(ci);
      if (cs) setStats(cs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ci = lc<AuditLog[]>(ITEMS_KEY);
    const cs = lc<AuditStats>(STATS_KEY);
    if (Array.isArray(ci)) setLogs(ci);
    if (cs) setStats(cs);
    load(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hooks must run unconditionally on every render — this guard sits after
  // all hook declarations, not before, so hook call order stays identical
  // regardless of role.
  if (!isSuperAdmin) {
    return (
      <div style={S.forbidden}>
        <div style={{ ...S.iconWrap, width:56, height:56, borderRadius:"50%", background:COLORS.dangerLight, color:COLORS.danger }}>
          <ShieldAlert size={28}/>
        </div>
        <div style={{ fontSize:"20px", fontWeight:700, color:COLORS.danger }}>403 — Forbidden</div>
        <div style={{ color:COLORS.textSecondary, fontSize:"14px" }}>Only Super Administrator can access Audit Logs.</div>
      </div>
    );
  }

  function apply(next: Partial<AuditFilters>) {
    const merged = { ...filters, ...next, page: 1 };
    setFilters(merged);
    load(merged);
  }

  function setPage(p: number) {
    const merged = { ...filters, page: p };
    setFilters(merged);
    load(merged);
  }

  function onSearch(val: string) {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => apply({ search: val || undefined }), 350);
  }

  function clearAll() {
    if (searchRef.current) searchRef.current.value = "";
    const next = { page:1, per_page:100 };
    setFilters(next);
    load(next);
  }

  function doExport() {
    const url = auditExcelUrl({ search:filters.search, module:filters.module, role:filters.role, status:filters.status, date_from:filters.date_from, date_to:filters.date_to });
    import("../../api/auth").then(({ getAccessToken }) => {
      fetch(url, { headers:{ Authorization:`Bearer ${getAccessToken()}` } })
        .then(r => r.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `audit_${new Date().toISOString().slice(0,10)}.xlsx`;
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });
    });
  }

  const activeFCount = [
    filters.module, filters.role, filters.status, filters.action,
    filters.today, filters.yesterday, filters.this_week, filters.this_month,
    filters.date_from, filters.date_to,
  ].filter(Boolean).length;

  const curPage = filters.page ?? 1;

  return (
    <div style={S.page}>
      {/* offline banner */}
      {offline && (
        <div style={S.offlineBanner}>
          <WifiOff size={15}/>
          Showing cached audit logs — Last synced: {fmtSync(syncTime)}
        </div>
      )}

      {/* header */}
      <div style={S.header}>
        <div style={S.titleWrap}>
          <div style={S.iconWrap}><Shield size={20}/></div>
          <div>
            <div style={S.title}>Audit Log</div>
            <div style={S.subtitle}>Immutable record of every administrative action</div>
          </div>
        </div>
        <div style={S.headerActions}>
          <button style={S.btnIcon} onClick={() => load(filters)} title="Refresh">
            <RefreshCw size={15} style={loading ? { animation:"auditSpin 1s linear infinite" } : {}}/>
          </button>
          <button style={S.btnOutline} onClick={doExport}>
            <Download size={14}/> Export Excel
          </button>
        </div>
      </div>

      {/* stats */}
      {stats && (
        <div style={S.statsGrid}>
          <StatCard label="Total Today"     value={stats.total_today}     color={COLORS.primary}/>
          <StatCard label="Critical Events" value={stats.critical_today}  color="#7E22CE"/>
          <StatCard label="Failed Logins"   value={stats.failed_logins}   color={COLORS.danger}/>
          <StatCard label="Finance Changes" value={stats.finance_changes} color={COLORS.warning}/>
          <StatCard label="All-Time Total"  value={stats.total_all}       color={COLORS.lapis}/>
          <StatCard label="All Failures"    value={stats.failed_all}      color={COLORS.danger}/>
          <StatCard label="System Events"   value={stats.system_events}   color={COLORS.textSecondary}/>
          <StatCard label="User Changes"    value={stats.user_changes}    color={COLORS.accent}/>
        </div>
      )}

      {/* toolbar */}
      <div style={S.toolbar}>
        <div style={S.searchWrap}>
          <Search size={15} style={S.searchIcon}/>
          <input
            ref={searchRef}
            style={S.searchInput}
            placeholder="Search by user, action, module, IP, browser, receipt…"
            onChange={e => onSearch(e.target.value)}
          />
        </div>
        <button
          style={{ ...S.btnOutline, ...(showFilter ? { background:COLORS.primaryLight, borderColor:COLORS.primary, color:COLORS.primary } : {}) }}
          onClick={() => setShowFilter(v => !v)}
        >
          <Filter size={14}/> Filters
          {activeFCount > 0 && <span style={S.filterBadge}>{activeFCount}</span>}
        </button>
        {(activeFCount > 0 || filters.search) && (
          <button style={S.btnGhost} onClick={clearAll}><X size={13}/> Clear</button>
        )}
        <span style={S.totalLabel}>
          {loading ? "Loading…" : `${(total ?? 0).toLocaleString()} records`}
        </span>
      </div>

      {/* filter panel */}
      {showFilter && (
        <div style={S.filterPanel}>
          <div style={S.filterRow}>
            {/* quick dates */}
            <div style={S.filterGroup}>
              <div style={S.filterLabel}>Quick Date</div>
              <div style={S.pillRow}>
                {([["Today","today"],["Yesterday","yesterday"],["This Week","this_week"],["This Month","this_month"]] as [string,keyof AuditFilters][]).map(([lbl,k]) => {
                  const active = !!(filters as Record<string,unknown>)[k];
                  return (
                    <button key={k}
                      style={{ height:"30px", padding:"0 12px", borderRadius:"999px", border:`1px solid ${active ? COLORS.primary : COLORS.border}`, background: active ? COLORS.primary : COLORS.surface, color: active ? "#fff" : COLORS.textSecondary, fontSize:"12px", cursor:"pointer", fontWeight:500 }}
                      onClick={() => {
                        const f: Partial<AuditFilters> = { today:undefined, yesterday:undefined, this_week:undefined, this_month:undefined, date_from:undefined, date_to:undefined };
                        if (!active) (f as Record<string,unknown>)[k] = true;
                        apply(f);
                      }}
                    >{lbl}</button>
                  );
                })}
              </div>
            </div>
            {/* module */}
            <div style={S.filterGroup}>
              <div style={S.filterLabel}>Module</div>
              <select style={S.filterSelect} value={filters.module || ""} onChange={e => apply({ module: e.target.value || undefined })}>
                <option value="">All Modules</option>
                {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {/* role */}
            <div style={S.filterGroup}>
              <div style={S.filterLabel}>Role</div>
              <select style={S.filterSelect} value={filters.role || ""} onChange={e => apply({ role: e.target.value || undefined })}>
                <option value="">All Roles</option>
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
              </select>
            </div>
            {/* status */}
            <div style={S.filterGroup}>
              <div style={S.filterLabel}>Status</div>
              <select style={S.filterSelect} value={filters.status || ""} onChange={e => apply({ status: e.target.value || undefined })}>
                <option value="">All Status</option>
                {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
              </select>
            </div>
            {/* date range */}
            <div style={S.filterGroup}>
              <div style={S.filterLabel}>From</div>
              <input type="datetime-local" style={S.filterInput}
                value={filters.date_from ? filters.date_from.slice(0,16) : ""}
                onChange={e => apply({ date_from: e.target.value || undefined, today:undefined, yesterday:undefined, this_week:undefined, this_month:undefined })}
              />
            </div>
            <div style={S.filterGroup}>
              <div style={S.filterLabel}>To</div>
              <input type="datetime-local" style={S.filterInput}
                value={filters.date_to ? filters.date_to.slice(0,16) : ""}
                onChange={e => apply({ date_to: e.target.value || undefined, today:undefined, yesterday:undefined, this_week:undefined, this_month:undefined })}
              />
            </div>
          </div>
        </div>
      )}

      {/* table */}
      <div style={S.tableCard}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"13px" }}>
            <thead>
              <tr>
                {["Timestamp","Module","Action","User / Role","IP · Browser","Status",""].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={7} style={S.emptyCell}>
                  {loading ? "Loading audit logs…" : "No audit logs found."}
                </td></tr>
              ) : logs.map(log => {
                const cfg    = statusCfg(log.status);
                const isOpen = expandedId === log.id;
                return (
                  <React.Fragment key={log.id}>
                    <tr
                      style={{ cursor:"pointer", background: isOpen ? COLORS.primaryLighter : undefined }}
                      onClick={() => setExpandedId(isOpen ? null : log.id)}
                    >
                      <td style={S.td}>
                        <div style={{ display:"flex", alignItems:"center", gap:"5px", color:COLORS.textSecondary }}>
                          <Clock size={11}/>
                          <span style={{ fontFamily:"monospace", fontSize:"12px" }}>{fmtTs(log.performed_at)}</span>
                        </div>
                      </td>
                      <td style={S.td}>
                        <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:"999px", fontSize:"11px", fontWeight:600, background:COLORS.infoLight, color:COLORS.info }}>
                          {log.module || "—"}
                        </span>
                      </td>
                      <td style={S.td}>
                        <div style={{ fontWeight:600, color:COLORS.text }}>{log.action_label || log.action}</div>
                        {log.description && <div style={{ fontSize:"12px", color:COLORS.textSecondary, marginTop:"2px" }}>{log.description}</div>}
                      </td>
                      <td style={S.td}>
                        <div style={{ fontWeight:500 }}>{log.user_fullname || log.performed_by || "System"}</div>
                        {log.user_role && <div style={{ fontSize:"11px", color:COLORS.textMuted, marginTop:"2px" }}>{log.user_role}</div>}
                      </td>
                      <td style={S.td}>
                        {log.ip_address && <div style={{ fontSize:"12px", fontFamily:"monospace" }}>{log.ip_address}</div>}
                        {log.browser    && <div style={{ fontSize:"11px", color:COLORS.textMuted }}>{log.browser}</div>}
                      </td>
                      <td style={S.td}>
                        <span style={{ display:"inline-flex", alignItems:"center", gap:"4px", padding:"2px 9px", borderRadius:"999px", fontSize:"11px", fontWeight:600, background:cfg.bg, color:cfg.fg }}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign:"right" as const }}>
                        <div style={{ display:"flex", gap:"6px", justifyContent:"flex-end" }}>
                          <button
                            style={{ ...S.btnGhost, fontSize:"12px", color:COLORS.primary }}
                            onClick={e => { e.stopPropagation(); setSelected(log); }}
                          >Details</button>
                          {isOpen ? <ChevronDown size={14} color={COLORS.textMuted}/> : <ChevronRight size={14} color={COLORS.textMuted}/>}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ padding:"0", background:COLORS.backgroundAlt }}>
                          <ExpandedRow log={log}/>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {pages > 1 && (
          <div style={S.pagination}>
            <span>{(total ?? 0).toLocaleString()} total records</span>
            <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
              <button style={S.pageBtn} disabled={curPage === 1} onClick={() => setPage(1)}>«</button>
              <button style={S.pageBtn} disabled={curPage === 1} onClick={() => setPage(curPage - 1)}>‹</button>
              <span>Page {curPage} of {pages}</span>
              <button style={S.pageBtn} disabled={curPage >= pages} onClick={() => setPage(curPage + 1)}>›</button>
              <button style={S.pageBtn} disabled={curPage >= pages} onClick={() => setPage(pages)}>»</button>
            </div>
          </div>
        )}
      </div>

      {/* detail drawer */}
      {selected && <DetailDrawer log={selected} onClose={() => setSelected(null)}/>}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────
function StatCard({ label, value, color }: { label:string; value:number|undefined; color:string }) {
  return (
    <div style={{ ...S.statCard, borderTop:`3px solid ${color}` }}>
      <div style={{ ...S.statValue, color }}>{(value ?? 0).toLocaleString()}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

// ─── ExpandedRow ──────────────────────────────────────────────
function ExpandedRow({ log }: { log:AuditLog }) {
  const pairs: [string, string|number|null|undefined][] = [
    ["Audit ID",    `#${log.id}`],
    ["Table",       log.table_name],
    ["Record ID",   log.record_id],
    ["IP Address",  log.ip_address],
    ["Browser",     log.browser],
    ["OS",          log.os_name],
    ["Device",      log.device_name],
    ["Session ID",  log.session_id],
    ["Request ID",  log.request_id],
    ["Endpoint",    log.endpoint],
    ["HTTP Method", log.http_method],
    ["Exec Time",   log.execution_time_ms != null ? `${log.execution_time_ms}ms` : null],
    ["Failure",     log.failure_reason],
  ].filter(([,v]) => v != null && v !== "") as [string,string|number][];

  return (
    <div style={{ padding:"14px 16px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:"8px 16px", marginBottom: (log.old_values || log.new_values) ? "12px" : 0 }}>
        {pairs.map(([k,v]) => (
          <div key={k}>
            <div style={{ fontSize:"10px", fontWeight:700, color:COLORS.textMuted, textTransform:"uppercase", letterSpacing:"0.05em" }}>{k}</div>
            <div style={{ fontSize:"12px", color:COLORS.text, wordBreak:"break-all" }}>{String(v)}</div>
          </div>
        ))}
      </div>
      {(log.old_values || log.new_values) && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:"12px" }}>
          {log.old_values && (
            <div style={{ flex:1, minWidth:"200px" }}>
              <div style={{ ...S.filterLabel, marginBottom:"6px", color:COLORS.danger }}>Before</div>
              <pre style={S.jsonBlock}>{JSON.stringify(log.old_values, null, 2)}</pre>
            </div>
          )}
          {log.new_values && (
            <div style={{ flex:1, minWidth:"200px" }}>
              <div style={{ ...S.filterLabel, marginBottom:"6px", color:COLORS.success }}>After</div>
              <pre style={S.jsonBlock}>{JSON.stringify(log.new_values, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DetailDrawer ─────────────────────────────────────────────
function DetailDrawer({ log, onClose }: { log:AuditLog; onClose:()=>void }) {
  const cfg = statusCfg(log.status);

  function F({ label, value }: { label:string; value:unknown }) {
    if (value == null || value === "") return null;
    return (
      <div style={S.fieldRow}>
        <span style={S.fieldLabel}>{label}</span>
        <span style={S.fieldValue}>{String(value)}</span>
      </div>
    );
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.drawer} onClick={e => e.stopPropagation()}>
        <div style={S.drawerHeader}>
          <div style={S.drawerTitle}><Shield size={16} color={COLORS.primary}/> Audit Detail — #{log.id}</div>
          <button style={{ ...S.btnIcon, border:"none" }} onClick={onClose}><X size={16}/></button>
        </div>
        <div style={S.drawerBody}>
          {/* status */}
          <div style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px", borderRadius:"8px", background:cfg.bg, borderLeft:`4px solid ${cfg.fg}`, fontSize:"13px", fontWeight:600, color:cfg.fg }}>
            {cfg.icon} {cfg.label}
            {log.failure_reason && <span style={{ color:COLORS.textSecondary, fontWeight:400, marginLeft:"6px", fontSize:"12px" }}>{log.failure_reason}</span>}
          </div>

          <div>
            <p style={S.sectionHead}>Action</p>
            <F label="Module"      value={log.module}/>
            <F label="Action"      value={log.action_label || log.action}/>
            <F label="Description" value={log.description || log.note}/>
            <F label="Timestamp"   value={fmtTs(log.performed_at)}/>
            <F label="Table"       value={log.table_name}/>
            <F label="Record ID"   value={log.record_id}/>
          </div>

          <div>
            <p style={S.sectionHead}>Who</p>
            <F label="User"    value={log.user_fullname || log.performed_by}/>
            <F label="Role"    value={log.user_role}/>
            <F label="User ID" value={log.performed_by_id}/>
          </div>

          <div>
            <p style={S.sectionHead}>Device &amp; Network</p>
            <F label="IP Address" value={log.ip_address}/>
            <F label="Browser"    value={log.browser}/>
            <F label="OS"         value={log.os_name}/>
            <F label="Device"     value={log.device_name}/>
          </div>

          <div>
            <p style={S.sectionHead}>Request</p>
            <F label="Session ID"  value={log.session_id}/>
            <F label="Request ID"  value={log.request_id}/>
            <F label="Endpoint"    value={log.endpoint}/>
            <F label="HTTP Method" value={log.http_method}/>
            <F label="Exec Time"   value={log.execution_time_ms != null ? `${log.execution_time_ms}ms` : null}/>
          </div>

          {(log.old_values || log.new_values) && (
            <div>
              <p style={S.sectionHead}>Changes</p>
              {log.old_values && (
                <div style={{ marginBottom:"10px" }}>
                  <div style={{ fontSize:"11px", fontWeight:700, color:COLORS.danger, marginBottom:"4px" }}>Before</div>
                  <pre style={S.jsonBlock}>{JSON.stringify(log.old_values, null, 2)}</pre>
                </div>
              )}
              {log.new_values && (
                <div>
                  <div style={{ fontSize:"11px", fontWeight:700, color:COLORS.success, marginBottom:"4px" }}>After</div>
                  <pre style={S.jsonBlock}>{JSON.stringify(log.new_values, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
