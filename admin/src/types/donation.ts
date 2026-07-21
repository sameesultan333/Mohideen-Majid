// src/types/donation.ts

/* ============================================================================
 * Payment Method
 * ========================================================================== */

export type DonationMethod =
  | "cash"
  | "upi"
  | "bank"
  | "cheque"
  | "other";

/* ============================================================================
 * Donation
 * ========================================================================== */

export type DonorType = "member" | "walk_in" | "anonymous";

export interface Donation {
  id: number;

  donor_name: string;

  amount: number;

  method: DonationMethod;

  receipt_id: string;

  note?: string | null;

  created_at: string;

  donation_date?: string | null;

  donor_type?: DonorType | null;

  /* Relations */

  member_id?: number | null;

  head_id?: number | null;

  user_id?: number | null;

  phone?: string | null;

  chanda_no?: string | null;

  purpose_id?: number | null;
  purpose_name?: string | null;

  fund_id?: number | null;
  fund_name?: string | null;

  recorded_by: string;
}

/* ============================================================================
 * Create Donation
 * ========================================================================== */

export interface CreateDonationPayload {
  donor_name?: string;

  member_id?: number;

  head_id?: number;

  donor_type?: DonorType;

  phone?: string;

  chanda_no?: string;

  amount: number;

  method: DonationMethod;

  purpose_id?: number;

  fund_id?: number;

  donation_date?: string;

  note?: string;
}

/* ============================================================================
 * Update Donation
 * ========================================================================== */

export interface UpdateDonationPayload {
  donor_name?: string;

  member_id?: number;

  amount?: number;

  method?: DonationMethod;

  purpose_id?: number;

  fund_id?: number;

  note?: string;
}

/* ============================================================================
 * Pagination
 * ========================================================================== */

export interface DonationPage {
  items: Donation[];

  total: number;

  page: number;

  page_size: number;

  total_pages: number;
}

/* ============================================================================
 * Summary
 * ========================================================================== */

export interface DonationSummary {
  total_donations: number;

  total_amount: number;

  cash_total: number;

  upi_total: number;

  bank_total?: number;

  cheque_total?: number;

  other_total: number;
}

/* ============================================================================
 * Monthly Summary
 * ========================================================================== */

export interface MonthlyDonationSummary {
  month: string;

  amount: number;

  count: number;
}

/* ============================================================================
 * Purpose Summary
 * ========================================================================== */

export interface PurposeSummary {
  purpose_id?: number | null;

  purpose_name: string;

  amount: number;

  count: number;

  percentage: number;
}

/* ============================================================================
 * Dashboard
 * ========================================================================== */

export interface DonationDashboard {
  summary: DonationSummary;

  recent_donations: Donation[];

  monthly_summary: MonthlyDonationSummary[];

  purpose_summary: PurposeSummary[];
}

/* ============================================================================
 * Donation Purpose
 * ========================================================================== */

export interface DonationPurpose {
  id: number;

  name: string;

  description?: string | null;

  is_active: boolean;

  is_archived: boolean;

  created_at?: string;
}

export interface CreateDonationPurposePayload {
  name: string;

  description?: string;
}

export interface UpdateDonationPurposePayload {
  name?: string;

  description?: string;
}

/* ============================================================================
 * Reports
 * ========================================================================== */

export interface DonationReportParams {
  format: "pdf" | "excel";

  from_date?: string;

  to_date?: string;

  purpose_id?: number;

  fund_id?: number;

  method?: DonationMethod;
}