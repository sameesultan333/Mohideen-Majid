import type { User } from "./users";

/* ============================================================================
 * Family (ApprovedHead)
 * ========================================================================== */

export interface Family {
  /** Primary key */
  id: number;

  /** Unique chanda number (e.g., "CH-001") */
  chanda_no: string;

  /** Family head name */
  name: string;

  /** Contact phone (10 digits, normalized) */
  phone: string;

  /** Optional address */
  address?: string | null;

  /** Monthly chanda amount */
  monthly_amount: number;

  /** Date of registration (can be historical) */
  registration_date?: string | null;

  /** Whether the family is fully registered (for migration) */
  is_registered: boolean;

  /** Whether the family is active (can receive chanda) */
  is_active: boolean;

  /** User ID of the registered family head (if linked to a user account) */
  user_id?: number | null;

  /** Zone / area */
  zone?: string | null;

  /** Street (within the zone) */
  street?: string | null;

  /** Record creation timestamp */
  created_at?: string | null;

  /** When the family was deactivated (null if currently active) */
  deactivated_at?: string | null;

  /** When the 30-day restore window expires and the family is permanently archived */
  deactivated_until?: string | null;
}

/* ============================================================================
 * Create Family (used by POST /admin/families/)
 * ========================================================================== */

export interface CreateFamilyPayload {
  /** Unique chanda number (optional — blank/omitted auto-generates) */
  chanda_no?: string;

  /** Family head name (required) */
  name: string;

  /** Contact phone (will be normalized) (required) */
  phone: string;

  /** Optional address */
  address?: string;

  /** Monthly chanda amount (required, > 0) */
  monthly_amount: number;

  /** Optional registration date (ISO string) */
  registration_date?: string;

  /** Zone / area */
  zone?: string;

  /** Street (within the zone) */
  street?: string;

  /** Historical payments per month (for migration) */
  historical_payments?: Record<string, number>;
}

/* ============================================================================
 * Update Family (used by PUT /admin/families/{id})
 * ========================================================================== */

export interface UpdateFamilyPayload {
  /** Updated chanda number (unique) */
  chanda_no?: string;

  /** Updated family name */
  name?: string;

  /** Updated phone number (will be normalized) */
  phone?: string;

  /** Updated address */
  address?: string;

  /** Updated monthly amount (> 0) */
  monthly_amount?: number;

  /** Zone / area */
  zone?: string;

  /** Street (within the zone) */
  street?: string;

  /** Updated registration date */
  registration_date?: string;
}

/* ============================================================================
 * Chanda Collection (monthly record)
 * ========================================================================== */

export interface ChandaCollection {
  id: number;

  /** Month key (YYYY-MM) */
  month: string;

  /** Amount due for this month (head.monthly_amount) */
  amount_due: number;

  /** Total paid for this month (sum of payments) */
  total_paid: number;

  /** Payment status */
  status: "paid" | "partial" | "pending";

  /** Record creation timestamp */
  created_at: string;
}

/* ============================================================================
 * Payment Entry (individual payment transaction)
 * ========================================================================== */

export interface PaymentEntry {
  id: number;

  /** Unique receipt ID (e.g., CH-2026-001) */
  receipt_id: string;

  /** Payment amount */
  amount: number;

  /** Payment method (cash, online, etc.) */
  method: string;

  /** Verification status */
  status: string;

  /** Name of the person who collected the payment */
  collected_by: string;

  /** Timestamp of the payment */
  created_at: string;

  /** Name of the person who verified (if verified) */
  verified_by?: string | null;

  /** Timestamp of verification (if verified) */
  verified_at?: string | null;

  /** Purpose of payment (e.g., "Monthly Chanda") */
  purpose?: string | null;

  /** Number of months covered by this payment (if bulk) */
  months_covered?: number;

  /** List of month keys (YYYY-MM) covered by this payment */
  covered_months?: string[];
}

/* ============================================================================
 * Family History (combined view for a family)
 * ========================================================================== */

export interface FamilyHistory {
  /** The family record */
  family: Family;

  /** All monthly chanda collections for this family */
  collections: ChandaCollection[];

  /** All payment entries for this family */
  payments: PaymentEntry[];
}

/* ============================================================================
 * Family Member (a user linked to a family)
 * ========================================================================== */

export type FamilyMember = User;