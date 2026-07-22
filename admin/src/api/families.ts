import api from "./axios";
import type {
  Family,
  FamilyHistory,
  FamilyMember,
  CreateFamilyPayload,
  UpdateFamilyPayload,
} from "../types/family";

/* ============================================================================
 * Get Zones (distinct zone names from all families)
 * ========================================================================== */

export const getZones = async (): Promise<string[]> => {
  const { data } = await api.get("/admin/zones");
  return Array.isArray(data) ? data : [];
};

/* ============================================================================
 * Get Families
 * ⚠️  No trailing slash – matches backend route @router.get("/families")
 * ========================================================================== */

export interface FamilyFilters {
  search?: string;
  active_only?: boolean;
}

export const getFamilies = async (
  params?: FamilyFilters
): Promise<Family[]> => {
  const { data } = await api.get("/admin/families", {
    params,
  });
  return data;
};

/* ============================================================================
 * Create Family
 * ⚠️  No trailing slash – matches backend route @router.post("/families")
 * ========================================================================== */

export const createFamily = async (
  payload: CreateFamilyPayload
): Promise<Family> => {
  const { data } = await api.post("/admin/families", payload);
  return data;
};

/* ============================================================================
 * Update Family
 * Sub-path → no trailing slash needed
 * ========================================================================== */

export const updateFamily = async (
  familyId: number,
  payload: UpdateFamilyPayload
): Promise<Family> => {
  const { data } = await api.put(
    `/admin/families/${familyId}`,
    payload
  );
  return data;
};

/* ============================================================================
 * Activate Family
 * ========================================================================== */

export const activateFamily = async (
  familyId: number
): Promise<{ message: string }> => {
  const { data } = await api.patch(
    `/admin/families/${familyId}/activate`
  );
  return data;
};

/* ============================================================================
 * Deactivate Family
 * Sensitive action — requires the acting admin's own current password.
 * ========================================================================== */

export const deactivateFamily = async (
  familyId: number,
  password: string,
  reason?: string
): Promise<{ message: string }> => {
  const { data } = await api.patch(
    `/admin/families/${familyId}/deactivate`,
    { password, reason }
  );
  return data;
};

/* ============================================================================
 * Delete Family (Alias of Deactivate — also requires password now)
 * ========================================================================== */

export const deleteFamily = async (
  familyId: number,
  password: string,
  reason?: string
): Promise<{ message: string }> => {
  const { data } = await api.delete(
    `/admin/families/${familyId}`,
    { data: { password, reason } }
  );
  return data;
};

/* ============================================================================
 * Family History
 * ========================================================================== */

export const getFamilyHistory = async (
  familyId: number
): Promise<FamilyHistory> => {
  const { data } = await api.get(
    `/admin/families/${familyId}/history`
  );
  return data;
};

/* ============================================================================
 * Family Members
 * ========================================================================== */

export const getFamilyMembers = async (
  familyId: number
): Promise<FamilyMember[]> => {
  const { data } = await api.get(
    `/admin/families/${familyId}/members`
  );
  return data;
};