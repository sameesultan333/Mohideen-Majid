import api from "./axios";

/* ==========================================================
   TYPES
   ========================================================== */

export interface Family {
  id: number;
  chanda_no: string;
  name: string;
  phone: string;
  address?: string;
  zone?: string;
  monthly_amount: number;
  registration_date?: string;
  is_active: boolean;
  is_registered: boolean;
}

export interface AddFamilyRequest {
  chanda_no?: string; // blank/omitted => backend auto-generates
  name: string;
  phone: string;
  address?: string;
  zone?: string;
  street?: string;
  monthly_amount: number;
  registration_date?: string;
  historical_payments?: Record<string, number>;
}

export interface EditFamilyRequest {
  chanda_no?: string;
  name?: string;
  phone?: string;
  address?: string;
  street?: string;
  monthly_amount?: number;
  registration_date?: string;
}

export interface MemberWithCollection {
  member: Family;
  collections: Array<{
    id: number;
    head_id: number;
    month: string;
    amount_due: number;
    total_paid: number;
    status: "paid" | "partial" | "pending";
    created_at: string;
  }>;
}

export interface DefaulterItem {
  family_id: number;
  chanda_no: string;
  name: string;
  phone: string;
  pending_months: number;
  outstanding: number;
  months: string[];
}

export interface DefaultersResponse {
  grouped: {
    "1": { count: number; items: DefaulterItem[] };
    "3": { count: number; items: DefaulterItem[] };
    "6": { count: number; items: DefaulterItem[] };
    "12": { count: number; items: DefaulterItem[] };
  };
  filtered?: { threshold_months: number; count: number; items: DefaulterItem[] };
}

export interface PendingPayment {
  id: number;
  head_id: number;
  payer_name: string;
  amount: number;
  method: string;
  purpose: string;
  proof_image: string | null;
  transaction_ref: string | null;
  created_at: string;
  receipt_id: string | null;
  covered_months: string[];
  paid_by_name: string | null;
}

export interface CollectPaymentRequest {
  member_id: number;
  amount: number;
  method: "cash" | "upi";
  month?: string;
  purpose?: string;
  transaction_ref?: string;
  proof_image?: string;
  collected_date?: string;
}

export interface FinanceDashboard {
  month: string;
  is_historical_month?: boolean;
  families: {
    total: number;
    registered: number;
    unregistered: number;
    pending_registration: number;
    total_members: number;
    collectors: number;
    imams: number;
    staff: number;
  };
  chanda: {
    paid: number;
    partial: number;
    pending: number;
    due: number;
    collected: number;
    outstanding: number;
    collection_pct: number;
    total_outstanding_all_months: number;
    defaulters_3m: number;
  };
  donations: { count: number; total: number };
  expenses: { count: number; total: number; pending_count: number; pending_total: number };
  balance: number;
  pending_verification: number;
  pending_rollbacks?: number;
  collection_periods: {
    today:      { total: number; cash: number; upi: number; bank: number; cheque: number; other: number; collector: number; online: number };
    yesterday:  { total: number; cash: number; upi: number; bank: number; cheque: number; other: number; collector: number; online: number };
    this_week:  { total: number; cash: number; upi: number; bank: number; cheque: number; other: number; collector: number; online: number };
    this_month: { total: number; cash: number; upi: number; bank: number; cheque: number; other: number; collector: number; online: number };
    this_year:  { total: number; cash: number; upi: number; bank: number; cheque: number; other: number; collector: number; online: number };
  };
  recent_payments: any[];
  recent_donations: any[];
  recent_expenses: any[];
}

/* ==========================================================
   DASHBOARD
   ========================================================== */

export async function getDashboard(month?: string) {
  const { data } = await api.get<FinanceDashboard>("/finance/dashboard", {
    params: month ? { month } : undefined,
  });
  return data;
}

export interface WeeklyCollectionDay {
  date: string;
  amount: number;
}

export async function getWeeklyCollections() {
  const { data } = await api.get<WeeklyCollectionDay[]>("/finance/collections/weekly");
  return data;
}

export interface YearlyCollections {
  year: number;
  months: number[];
}

export async function getYearlyCollections(year?: number) {
  const { data } = await api.get<YearlyCollections>("/finance/collections/yearly", {
    params: year ? { year } : undefined,
  });
  return data;
}

/* ==========================================================
   MEMBERS / COLLECTIONS
   ========================================================== */

export async function getMembers(month?: string) {
  const { data } = await api.get<MemberWithCollection[]>("/chanda/members", {
    params: month ? { month } : undefined,
  });
  return data;
}

export async function generateMonth(month: string) {
  const { data } = await api.post("/chanda/generate", { month });
  return data;
}

export async function collectPayment(payment: CollectPaymentRequest) {
  const { data } = await api.post("/chanda/collect", payment);
  return data;
}

/* ==========================================================
   FAMILY CRUD
   ========================================================== */

export async function getFamilies(search?: string) {
  const { data } = await api.get<Family[]>("/admin/families", {
    params: search ? { search } : undefined,
  });
  return data;
}

export async function getFamily(id: number) {
  const { data } = await api.get(`/admin/families/${id}/history`);
  return data;
}

export async function addFamily(family: AddFamilyRequest) {
  const { data } = await api.post("/admin/families", family);
  return data;
}

export async function updateFamily(id: number, family: EditFamilyRequest) {
  const { data } = await api.put(`/admin/families/${id}`, family);
  return data;
}

export async function activateFamily(id: number) {
  const { data } = await api.patch(`/admin/families/${id}/activate`);
  return data;
}

export async function deactivateFamily(id: number) {
  const { data } = await api.patch(`/admin/families/${id}/deactivate`);
  return data;
}

/* ==========================================================
   DEFAULTERS
   ========================================================== */

export async function getDefaulters(months?: number) {
  const { data } = await api.get<DefaultersResponse>("/finance/defaulters", {
    params: months != null ? { months } : undefined,
  });
  return data;
}

export interface DefaulterReminderResult {
  requested: number;
  notified: number;
  skipped: number[];
}

/** Push (FCM) reminder to selected defaulters — replaces the old SMS reminder. */
export async function notifyDefaulters(familyIds: number[]) {
  const { data } = await api.post<DefaulterReminderResult>("/finance/defaulters/notify", {
    family_ids: familyIds,
  });
  return data;
}

/* ==========================================================
   REPORTS / EXPORTS
   ========================================================== */

export async function getFamilyHistory(familyId: number) {
  const { data } = await api.get(`/finance/reports/family/${familyId}`);
  return data;
}

export async function downloadMonthlyExcel(month: string) {
  const response = await api.get(`/finance/reports/monthly/${month}/excel`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function downloadMonthlyPDF(month: string) {
  const response = await api.get(`/finance/reports/monthly/${month}/pdf`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function downloadFamilyStatementPDF(familyId: number) {
  const response = await api.get(`/finance/reports/family/${familyId}/pdf`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function downloadFamilyStatementExcel(familyId: number) {
  const response = await api.get(`/finance/reports/family/${familyId}/excel`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

/* ==========================================================
   HELPERS
   ========================================================== */

/** Returns current month key in YYYY-MM format */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Trigger a browser file download from a Blob (Safari-compatible) */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ==========================================================
   PENDING VERIFICATION
   ========================================================== */

export async function getPendingPayments(): Promise<PendingPayment[]> {
  const { data } = await api.get<PendingPayment[]>("/payments/pending");
  return data;
}

export async function verifyPayment(paymentId: number) {
  const { data } = await api.put(`/chanda/verify/${paymentId}`);
  return data;
}

export async function rejectPayment(paymentId: number) {
  const { data } = await api.put(`/chanda/reject/${paymentId}`);
  return data;
}

export async function adminRecordPayment(payload: {
  member_id: number;
  amount: number;
  method: string;
  purpose?: string;
  months_list?: string[];
  start_month?: string;
  transaction_ref?: string;
  note?: string;
  collected_date?: string;
}) {
  const { data } = await api.post("/chanda/admin-record", payload);
  return data;
}

export async function requestPaymentRollback(paymentId: number, reason?: string) {
  const { data } = await api.post("/chanda/rollback-request", { payment_id: paymentId, reason });
  return data;
}

export async function approvePaymentRollback(requestId: number, decisionNote?: string) {
  const { data } = await api.post(`/chanda/rollback-approve/${requestId}`, { decision_note: decisionNote });
  return data;
}

export async function rejectPaymentRollback(requestId: number, decisionNote?: string) {
  const { data } = await api.post(`/chanda/rollback-reject/${requestId}`, { decision_note: decisionNote });
  return data;
}
