import api from "./axios";

export interface PendingUser {
  id: number;
  name: string;
  phone: string | null;
  role: string;
  status: string;
  address: string | null;
  registered_at: string | null;
}

export interface FamilySuggestion {
  id: number;
  name: string;
  chanda_no: string;
  phone: string | null;
  monthly_amount: number;
}

export interface Collector {
  id: number;
  name: string;
}

export interface PendingDetail {
  user: PendingUser & { admin_notes: string | null; address: string | null };
  family_suggestions: FamilySuggestion[];
}

export interface ApprovePayload {
  family_action: "create" | "none";
  new_chanda_no?: string | null;
  active_from_month?: string | null; // YYYY-MM
  role: string;
  chanda_amount?: number | null;
  phone_override?: string | null;
  admin_notes?: string | null;
}

export const listPendingRegistrations = async (): Promise<PendingUser[]> => {
  const { data } = await api.get("/admin/pending-registrations");
  return data;
};

export const getPendingRegistration = async (id: number): Promise<PendingDetail> => {
  const { data } = await api.get(`/admin/pending-registrations/${id}`);
  return data;
};

export const approveRegistration = async (id: number, payload: ApprovePayload): Promise<{ message: string }> => {
  const { data } = await api.post(`/admin/pending-registrations/${id}/approve`, payload);
  return data;
};

export const rejectRegistration = async (id: number, reason: string): Promise<{ message: string }> => {
  const { data } = await api.post(`/admin/pending-registrations/${id}/reject`, { reason });
  return data;
};

// ── Cash Submissions ──────────────────────────────────────────────────────────

export interface CashSubmission {
  id: number;
  collector_id: number;
  collector_name: string;
  receiving_admin_name: string | null;
  start_date: string;
  end_date: string;
  submitted_amount: number;
  cash_amount: number | null;
  online_amount: number | null;
  categories: string[] | null;
  expected_amount: number | null;
  approved_amount: number | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  submitted_at: string;
  approved_at: string | null;
}

export interface CashSubmissionTransaction {
  type: "chanda" | "donation";
  id: number;
  date: string | null;
  head_name: string | null;
  amount: string;
  method: string;
  receipt_id: string | null;
}

const coerceSubmission = (s: any): CashSubmission => ({
  ...s,
  submitted_amount: parseFloat(s.submitted_amount ?? 0),
  cash_amount:      s.cash_amount      != null ? parseFloat(s.cash_amount)      : null,
  online_amount:    s.online_amount    != null ? parseFloat(s.online_amount)    : null,
  expected_amount:  s.expected_amount != null ? parseFloat(s.expected_amount) : null,
  approved_amount:  s.approved_amount  != null ? parseFloat(s.approved_amount)  : null,
});

export const listCashSubmissions = async (): Promise<CashSubmission[]> => {
  const { data } = await api.get("/collector/admin/cash-submissions");
  const arr = Array.isArray(data) ? data : [];
  return arr.map(coerceSubmission);
};

export const approveCashSubmission = async (id: number, approved_amount?: number): Promise<{ message: string }> => {
  const { data } = await api.patch(`/collector/admin/cash-submissions/${id}/approve`, { approved_amount });
  return data;
};

export const rejectCashSubmission = async (id: number, reason: string): Promise<{ message: string }> => {
  const { data } = await api.patch(`/collector/admin/cash-submissions/${id}/reject`, { reason });
  return data;
};

export const getCashSubmissionTransactions = async (id: number): Promise<CashSubmissionTransaction[]> => {
  const { data } = await api.get(`/collector/admin/cash-submissions/${id}/transactions`);
  return Array.isArray(data) ? data : [];
};
