import api from './axios';

export interface AuditLog {
  id: number;
  table_name: string;
  record_id: number;
  action: string;
  action_label: string;
  module: string;
  description: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  performed_by_id: number | null;
  performed_by: string | null;
  user_fullname: string | null;
  user_role: string | null;
  performed_at: string;
  ip_address: string | null;
  browser: string | null;
  os_name: string | null;
  device_name: string | null;
  session_id: number | null;
  request_id: string | null;
  endpoint: string | null;
  http_method: string | null;
  status: 'success' | 'failed' | 'warning' | 'critical';
  failure_reason: string | null;
  execution_time_ms: number | null;
  affected_record_type: string | null;
  note: string | null;
}

export interface AuditListResponse {
  total: number;
  page: number;
  per_page: number;
  pages: number;
  items: AuditLog[];
}

export interface AuditStats {
  total_today: number;
  critical_today: number;
  failed_logins: number;
  finance_changes: number;
  total_all: number;
  failed_all: number;
  system_events: number;
  user_changes: number;
  by_module: { module: string; count: number }[];
}

export type AuditFilters = {
  search?: string;
  module?: string;
  role?: string;
  status?: string;
  action?: string;
  performed_by_id?: number;
  date_from?: string;
  date_to?: string;
  today?: boolean;
  yesterday?: boolean;
  this_week?: boolean;
  this_month?: boolean;
  page?: number;
  per_page?: number;
};

export async function fetchAuditLogs(filters: AuditFilters = {}): Promise<AuditListResponse> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      params.set(k, String(v));
    }
  });
  const { data } = await api.get<AuditListResponse>(`/audit?${params}`);
  return data;
}

export async function fetchAuditStats(): Promise<AuditStats> {
  const { data } = await api.get<AuditStats>('/audit/stats');
  return data;
}

export async function fetchAuditDetail(id: number): Promise<AuditLog> {
  const { data } = await api.get<AuditLog>(`/audit/${id}`);
  return data;
}

export function auditExcelUrl(filters: AuditFilters = {}): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  const base = import.meta.env.VITE_BACKEND_URL || '';
  return `${base}/audit/export/excel?${params}`;
}
