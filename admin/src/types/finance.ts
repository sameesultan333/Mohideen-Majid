// src/types/finance.ts

/* ============================================================================
 * Dashboard
 * ========================================================================== */

export interface FinanceDashboard {
  total_income: number;

  total_expenses: number;

  total_balance: number;

  total_donations: number;

  total_chanda: number;

  total_other_income: number;

  active_funds: number;

  pending_expenses: number;

  monthly_income: number;

  monthly_expenses: number;

  monthly_balance: number;

  recent_transactions: FinanceTransaction[];
}

/* ============================================================================
 * Transaction
 * ========================================================================== */

export type FinanceTransactionType =
  | "donation"
  | "expense"
  | "chanda"
  | "adjustment";

export interface FinanceTransaction {
  id: number;

  type: FinanceTransactionType;

  receipt_id: string;

  title: string;

  amount: number;

  created_at: string;

  created_by?: string | null;
}

/* ============================================================================
 * Analytics
 * ========================================================================== */

export interface FinanceAnalytics {
  income_trend: FinanceChartItem[];

  expense_trend: FinanceChartItem[];

  balance_trend: FinanceChartItem[];

  donation_methods: DonationMethodSummary[];

  category_breakdown: CategoryBreakdown[];
}

/* ============================================================================
 * Charts
 * ========================================================================== */

export interface FinanceChartItem {
  label: string;

  amount: number;
}

/* ============================================================================
 * Donation Methods
 * ========================================================================== */

export interface DonationMethodSummary {
  method: string;

  total: number;

  percentage: number;
}

/* ============================================================================
 * Expense Categories
 * ========================================================================== */

export interface CategoryBreakdown {
  category: string;

  total: number;

  percentage: number;
}

/* ============================================================================
 * Receipt Lookup
 * ========================================================================== */

export interface ReceiptLookup {
  receipt_id: string;

  type: "donation" | "expense";

  amount: number;

  created_at: string;

  title?: string | null;

  donor_name?: string | null;

  fund_name?: string | null;

  category_name?: string | null;

  method?: string | null;

  note?: string | null;
}

/* ============================================================================
 * Finance Settings
 * ========================================================================== */

export interface FinanceSettings {
  mosque_name: string;

  currency: string;

  currency_symbol: string;

  financial_year_start: string;

  default_expense_category?: number | null;

  receipt_prefix?: string | null;
}

export interface UpdateFinanceSettingsPayload {
  mosque_name?: string;

  currency?: string;

  currency_symbol?: string;

  financial_year_start?: string;

  default_expense_category?: number;

  receipt_prefix?: string;
}

/* ============================================================================
 * Report
 * ========================================================================== */

export interface FinanceReportParams {
  format: "pdf" | "excel" | "csv";

  from_date?: string;

  to_date?: string;

  fund_id?: number;

  category_id?: number;
}