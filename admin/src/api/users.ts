import api from "./axios";
import type {
  User,
  UserRoleUpdatePayload,
} from "../types/users";

/* ============================================================================
 * Get All Users
 * ⚠️  No trailing slash – matches backend route @router.get("/users")
 * ========================================================================== */

export const getUsers = async (): Promise<User[]> => {
  const { data } = await api.get("/users/");
  return data;
};

/* ============================================================================
 * Get Single User
 * ========================================================================== */

export const getUser = async (
  userId: number
): Promise<User> => {
  const { data } = await api.get(`/users/${userId}`);
  return data;
};

/* ============================================================================
 * Update User Role
 * ========================================================================== */

export const updateUserRole = async (
  userId: number,
  payload: UserRoleUpdatePayload
): Promise<{
  message: string;
  user_id: number;
}> => {
  const { data } = await api.put(
    `/users/${userId}/role`,
    payload
  );
  return data;
};

/* ============================================================================
 * Assign member to a family head (fix broken registration)
 * ========================================================================== */

export const assignFamily = async (
  userId: number,
  head_id: number,
  name?: string,
): Promise<{ ok: boolean; head_name: string }> => {
  const { data } = await api.patch(`/users/${userId}/assign-family`, { head_id, name });
  return data;
};

/** Not every "not linked to a family" flag is a real family - some are just
 * staff who left the committee and were never meant to be a Chanda payer.
 * Clears the flag without creating a false family link. */
export const dismissFamilyFlag = async (
  userId: number
): Promise<{ ok: boolean; user_id: number }> => {
  const { data } = await api.patch(`/users/${userId}/dismiss-family-flag`);
  return data;
};

export const repairMemberLinks = async () => {
  const { data } = await api.post("/users/repair-member-links");
  return data;
};

/* ============================================================================
 * Delete User
 * ========================================================================== */

export const deleteUser = async (
  userId: number
): Promise<{
  message: string;
}> => {
  const { data } = await api.delete(
    `/users/${userId}`
  );
  return data;
};

/* ============================================================================
 * Enable / disable a user account. Reuses the staff status-toggle endpoint —
 * it only requires superadmin and an existing user id, no staff-role check —
 * so any account (including one that just left the committee and has no
 * Chanda Head link) can be locked out without needing to delete it or link
 * it to a family first.
 * ========================================================================== */

export const toggleUserStatus = async (
  userId: number
): Promise<{ id: number; is_active: boolean }> => {
  const { data } = await api.patch(`/admin/staff/${userId}/status`);
  return data;
};

export const resetUserPassword = async (
  userId: number,
  newPassword: string = "12345678"
): Promise<{ message: string }> => {
  const { data } = await api.post(`/admin/users/${userId}/reset-password`, {
    new_password: newPassword,
  });
  return data;
};