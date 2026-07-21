// src/types/report.ts

/* ============================================================================
 * Common
 * ========================================================================== */

export type ReportFormat = "pdf" | "excel" | "csv";

/* ============================================================================
 * Base Report Filters
 * ========================================================================== */

export interface BaseReportFilters {
  format: ReportFormat;

  from_date?: string;

  to_date?: string;
}

/* ============================================================================
 * Finance Report
 * ========================================================================== */

export interface FinanceReportFilters extends BaseReportFilters {
  fund_id?: number;

  category_id?: number;
}

/* ============================================================================
 * Donation Report
 * ========================================================================== */

export interface DonationReportFilters extends BaseReportFilters {
  fund_id?: number;

  purpose_id?: number;

  method?: string;
}

/* ============================================================================
 * Expense Report
 * ========================================================================== */

export interface ExpenseReportFilters extends BaseReportFilters {
  fund_id?: number;

  category_id?: number;
}

/* ============================================================================
 * Fund Report
 * ========================================================================== */

export interface FundReportFilters extends BaseReportFilters {}

/* ============================================================================
 * Generated Report
 * ========================================================================== */

export interface GeneratedReport {
  file_name: string;

  mime_type: string;

  blob: Blob;
}