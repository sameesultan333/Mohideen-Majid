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

export const resetUserPassword = async (
  userId: number,
  newPassword: string = "12345678"
): Promise<{ message: string }> => {
  const { data } = await api.post(`/admin/users/${userId}/reset-password`, {
    new_password: newPassword,
  });
  return data;
};