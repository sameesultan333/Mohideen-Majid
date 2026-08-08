// src/types/fund.ts

/* ============================================================================
 * Fund Status
 * ========================================================================== */

export type FundStatus = "draft" | "active" | "completed" | "archived";

/* ============================================================================
 * Backend raw shapes (as returned by the API)
 * ========================================================================== */

export interface BackendFundStats {
  total_donations: number;
  total_collected: number;
  total_expenses: number;
  total_spent: number;
  balance: number;
  goal_amount?: number | null;
  progress_pct?: number | null;
  last_donation_at?: string | null;
}

export interface BackendFund {
  id: number;
  name: string;
  description?: string | null;
  goal_amount?: number | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  completed_at?: string | null;
  status: FundStatus;
  is_active: boolean;
  is_archived: boolean;
  created_by?: string | null;
  created_by_id?: number | null;
  created_at: string;
  updated_at?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  stats?: BackendFundStats | null;
}

/* ============================================================================
 * Normalized Fund (used throughout the frontend)
 * Stats are flattened from BackendFundStats for convenience
 * ========================================================================== */

export interface Fund {
  id: number;
  name: string;
  description?: string | null;
  goal_amount?: number | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  /** Alias for expected_end_date — kept for backward compat */
  end_date?: string | null;
  completed_at?: string | null;
  status: FundStatus;
  is_active: boolean;
  is_archived: boolean;
  created_by?: string | null;
  created_by_id?: number | null;
  created_at: string;
  updated_at?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  // Flattened stats
  collected_amount: number;
  spent_amount: number;
  balance: number;
  progress_percentage: number;
  donation_count: number;
  expense_count: number;
  last_donation_at?: string | null;
}

/* ============================================================================
 * Create / Update
 * ========================================================================== */

export interface CreateFundPayload {
  name: string;
  description?: string;
  goal_amount?: number;
  start_date?: string;
  expected_end_date?: string;
  status?: FundStatus;
}

export interface UpdateFundPayload {
  name?: string;
  description?: string;
  goal_amount?: number;
  start_date?: string;
  expected_end_date?: string;
  status?: FundStatus;
}

/* ============================================================================
 * FundStats (standalone — returned by /funds/:id/stats)
 * ========================================================================== */

export interface FundStats {
  total_donations: number;
  total_collected: number;
  total_expenses: number;
  total_spent: number;
  balance: number;
  goal_amount?: number | null;
  progress_pct?: number | null;
  last_donation_at?: string | null;
}

/* ============================================================================
 * Dashboard
 * ========================================================================== */

export interface FundDashboard {
  total_funds: number;
  active_funds: number;
  completed_funds?: number;
  archived_funds?: number;
  total_collected: number;
  total_spent: number;
  overall_balance: number;
  funds: Fund[];
}

/* ============================================================================
 * Fund Collections (Donations per fund)
 * ========================================================================== */

export interface FundCollection {
  id: number;
  donor_name: string;
  phone?: string | null;
  chanda_no?: string | null;
  amount: number;
  method: string;
  receipt_id: string;
  note?: string | null;
  donation_date?: string | null;
  created_at: string;
}

export interface FundCollectionResponse {
  items: FundCollection[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/* ============================================================================
 * Fund Expenses
 * ========================================================================== */

export interface FundExpense {
  id: number;
  title: string;
  amount: number;
  vendor_name?: string | null;
  category_name?: string | null;
  receipt_id: string;
  receipt_image?: string | null;
  expense_date?: string | null;
  approved_by?: string | null;
  created_at: string;
}

export interface FundExpenseResponse {
  items: FundExpense[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/* ============================================================================
 * Report
 * ========================================================================== */

export interface FundReportParams {
  format: "pdf" | "excel" | "csv";
  from_date?: string;
  to_date?: string;
}
