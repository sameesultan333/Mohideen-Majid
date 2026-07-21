import api from "./axios";

/* ==========================================================
   TYPES
   ========================================================== */

export interface DashboardSummary {
  current_month: string;

  families: {
    total: number;
    active: number;
    registered: number;
    pending_registration: number;
    collectors: number;
    imams: number;
    staff: number;
  };

  collections: {
    expected: number;
    collected: number;
    outstanding: number;
    percentage: number;
  };

  defaulters: {
    one_month: number;
    three_months: number;
    six_months: number;
    twelve_months: number;
  };

  donations: {
    total: number;
    count: number;
  };

  expenses: {
    total: number;
    count: number;
  };

  balance: number;
}

export interface FinanceSettings {
  mosque_name: string;
  mosque_address: string;
  mosque_phone: string;
  logo_url: string;
  upi_id: string;
  bank_account: string;
  receipt_footer: string;
}

export interface Receipt {
  receipt_id: string;
  transaction_type: string;
  amount: number;
  created_at: string;
}

export interface Analytics {
  top_donors: any[];
  monthly_trend: any[];
  yearly_trend: any[];
  collector_performance: any[];
  purpose_totals: any[];
  expense_categories: any[];
}

/* ==========================================================
   DASHBOARD
   ========================================================== */

export async function getDashboard() {
  const { data } =
    await api.get<DashboardSummary>(
      "/finance/dashboard"
    );

  return data;
}

/* ==========================================================
   SETTINGS
   ========================================================== */

export async function getSettings() {
  const { data } =
    await api.get<FinanceSettings>(
      "/finance/settings"
    );

  return data;
}

export async function updateSettings(
  settings: Partial<FinanceSettings>,
) {
  const { data } = await api.put(
    "/finance/settings",
    settings,
  );

  return data;
}

/* ==========================================================
   RECEIPT
   ========================================================== */

export async function getReceipt(
  receiptId: string,
) {
  const { data } =
    await api.get<Receipt>(
      `/finance/receipt/${receiptId}`,
    );

  return data;
}

/* ==========================================================
   ANALYTICS
   ========================================================== */

export async function getAnalytics() {
  const { data } =
    await api.get<Analytics>(
      "/finance/reports/analytics",
    );

  return data;
}

/* ==========================================================
   EXPORTS
   ========================================================== */

export async function exportMonthlyPDF(
  month: string,
) {
  const response = await api.get(
    `/finance/reports/monthly/${month}/pdf`,
    {
      responseType: "blob",
    },
  );

  return response.data;
}

export async function exportMonthlyExcel(
  month: string,
) {
  const response = await api.get(
    `/finance/reports/monthly/${month}/excel`,
    {
      responseType: "blob",
    },
  );

  return response.data;
}

export async function exportFamilyPDF(
  familyId: number,
) {
  const response = await api.get(
    `/finance/reports/family/${familyId}/pdf`,
    {
      responseType: "blob",
    },
  );

  return response.data;
}

export async function exportFamilyExcel(
  familyId: number,
) {
  const response = await api.get(
    `/finance/reports/family/${familyId}/excel`,
    {
      responseType: "blob",
    },
  );

  return response.data;
}

/* ==========================================================
   SMS QUEUE
   ========================================================== */

export async function getSMSQueue() {
  const { data } =
    await api.get("/finance/sms-queue");

  return data;
}

export async function retrySMS(
  id: number,
) {
  const { data } = await api.post(
    `/finance/sms-queue/retry/${id}`,
  );

  return data;
}