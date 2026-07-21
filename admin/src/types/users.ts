/* ============================================================================
 * User Roles
 * ========================================================================== */

export type UserRole =
  | "superadmin"
  | "admin"
  | "imam"
  | "collector"
  | "head"
  | "member";

/* ============================================================================
 * User
 * ========================================================================== */

export interface User {
  /** Primary key */
  id: number;

  /** Full name of the user */
  name: string;

  /** Phone number (10 digits, normalized) */
  phone: string;

  /** User role – determines permissions */
  role: UserRole;

  /** Whether the user account is active (can log in) */
  is_active: boolean;

  /** Whether the phone number has been verified via OTP */
  phone_verified: boolean;

  /** If the user belongs to a family, this is the family (ApprovedHead) ID */
  family_id?: number | null;

  /** Phone number of the family head (if applicable) */
  head_phone?: string | null;

  /** Account creation timestamp */
  created_at?: string | null;

  /** Last successful login timestamp */
  last_login?: string | null;
}

/* ============================================================================
 * Update Role (used by /users/{id}/role)
 * ========================================================================== */

export interface UserRoleUpdatePayload {
  /** New role to assign to the user */
  role: UserRole;
}

/* ============================================================================
 * Update User (used by /admin/members/{id})
 * ========================================================================== */

export interface UpdateUserPayload {
  /** Updated full name */
  name?: string;

  /** Updated phone number (will be normalized) */
  phone?: string;

  /** Whether the user is active */
  is_active?: boolean;
}

/* ============================================================================
 * Family Member – Same shape as User, used in family context
 * ========================================================================== */

export type FamilyMember = User;

/* ============================================================================
 * User Statistics – future extension (not yet implemented in backend)
 * ========================================================================== */

export interface UserStatistics {
  /** Total donation count for this user */
  donations?: number;

  /** Total payment entries count */
  payments?: number;

  /** Number of questions asked (if applicable) */
  questions?: number;

  /** Number of answers given (if applicable) */
  answers?: number;
}