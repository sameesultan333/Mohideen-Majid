// src/types/expense.ts

/* ============================================================================
 * Expense Category
 * ========================================================================== */

export interface ExpenseCategory {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at?: string | null;
}

export interface CreateExpenseCategoryPayload {
  name: string;
  description?: string;
}

export interface UpdateExpenseCategoryPayload {
  name?: string;
  description?: string;
}

/* ============================================================================
 * Expense
 * ========================================================================== */

export interface Expense {
  id: number;

  title: string;
  amount: number;

  category_id?: number | null;
  category_name?: string | null;

  fund_id?: number | null;
  fund_name?: string | null;

  vendor_name?: string | null;

  note?: string | null;

  receipt_id: string;
  receipt_image?: string | null;

  expense_date?: string | null;

  created_by: string;
  created_by_id?: number | null;

  approved_by?: string | null;
  approved_by_id?: number | null;

  approved_at?: string | null;

  created_at: string;

  is_deleted?: boolean;
}

export interface CreateExpensePayload {
  title: string;

  amount: number;

  category_id?: number;

  fund_id?: number;

  vendor_name?: string;

  note?: string;

  receipt_image?: string;

  expense_date?: string;
}

export interface UpdateExpensePayload {
  title?: string;

  amount?: number;

  category_id?: number;

  fund_id?: number;

  vendor_name?: string;

  note?: string;

  receipt_image?: string;

  expense_date?: string;

  force?: boolean;
}

/* ============================================================================
 * Pagination
 * ========================================================================== */

export interface ExpensePage {
  items: Expense[];

  total: number;

  page: number;

  page_size: number;

  total_pages: number;
}

/* ============================================================================
 * Statistics
 * ========================================================================== */

export interface ExpenseStats {
  total_expenses: number;

  total_amount: number;

  approved_count: number;

  pending_count: number;

  today_total: number;

  this_week_total: number;

  this_month_total: number;

  this_year_total: number;

  average_expense: number;

  highest_expense: number;

  active_categories: number;

  active_funds: number;
}

/* ============================================================================
 * Dashboard
 * ========================================================================== */

export interface ExpenseDashboard {
  stats: ExpenseStats;

  monthly_summary: MonthlySummaryItem[];

  category_summary: CategorySummaryItem[];

  recent_expenses: Expense[];
}

/* ============================================================================
 * Monthly Summary
 * ========================================================================== */

export interface MonthlySummaryItem {
  month: string;

  total: number;

  count: number;
}

/* ============================================================================
 * Category Summary
 * ========================================================================== */

export interface CategorySummaryItem {
  category_id?: number | null;

  category_name: string;

  amount: number;

  count: number;

  percentage: number;
}

/* ============================================================================
 * Reports
 * ========================================================================== */

export interface ExpenseReportParams {
  format: "pdf" | "excel" | "csv";

  from_date?: string;

  to_date?: string;

  category_id?: number;

  fund_id?: number;
}