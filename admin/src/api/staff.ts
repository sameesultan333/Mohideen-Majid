import api from "./axios";

// ─── Types ──────────────────────────────────────────────────────────────

export type StaffRole = "admin" | "imam" | "collector" | "modhin" | "watchman";
export type UserRole = StaffRole | "superadmin";

export interface Staff {
  id: number;
  name: string;
  phone: string | null;
  role: UserRole;
  // Not narrowed to UserRole: a staff account that is also a Chanda Head
  // legitimately carries "head" here alongside their staff role(s).
  roles: string[];
  is_active: boolean;
  phone_verified: boolean;
  last_login: string | null;
  created_at: string;
  /** Set once this staff account is also linked to a Chanda Head/family -
   * the same person, not a second identity. */
  family_id: number | null;
  chanda_no: string | null;
}

/** Flow A: assign a staff role to a mosque member (existing user). */
export interface AssignMemberRolePayload {
  user_id: number;
  role: StaffRole;
  is_active?: boolean;
}

/** Flow B: create a standalone staff account for a non-member. */
export interface CreateStandaloneStaffPayload {
  name: string;
  phone: string;
  role: StaffRole;
  is_active?: boolean;
}

export type CreateStaffPayload = AssignMemberRolePayload | CreateStandaloneStaffPayload;

export interface UpdateStaffPayload {
  name?: string;
  phone?: string;
  role?: StaffRole;
  is_active?: boolean;
}

export interface MemberSearchResult {
  head_id: number;
  name: string;
  phone: string | null;
  chanda_no: string;
  zone: string | null;
  user_id: number | null;
  user_role: string | null;
}

export interface DeleteStaffResponse {
  message: string;
}

// ─── API Functions ────────────────────────────────────────────────────

export const getStaff = async (): Promise<Staff[]> => {
  const response = await api.get<Staff[]>("/admin/staff");
  return response.data;
};

export const createStaff = async (payload: CreateStaffPayload): Promise<Staff> => {
  const response = await api.post<Staff>("/admin/staff", payload);
  return response.data;
};

export const updateStaff = async (staffId: number, payload: UpdateStaffPayload): Promise<Staff> => {
  const response = await api.put<Staff>(`/admin/staff/${staffId}`, payload);
  return response.data;
};

export const toggleStaffStatus = async (staffId: number): Promise<Staff> => {
  const response = await api.patch<Staff>(`/admin/staff/${staffId}/status`);
  return response.data;
};

/** Leave the committee, keep the account: removes only the staff/committee
 * role. Login, Chanda Head link and payment history are untouched. */
export const removeStaffRole = async (
  staffId: number
): Promise<{ ok: boolean; removed_role: string; new_role: string }> => {
  const response = await api.patch(`/admin/staff/${staffId}/remove-role`);
  return response.data;
};

export const deleteStaff = async (staffId: number): Promise<DeleteStaffResponse> => {
  const response = await api.delete<DeleteStaffResponse>(`/admin/staff/${staffId}`);
  return response.data;
};

export const searchMember = async (q: string): Promise<MemberSearchResult[]> => {
  if (!q || q.trim().length < 2) return [];
  const { data } = await api.get<MemberSearchResult[]>("/admin/search-member", { params: { q } });
  return Array.isArray(data) ? data : [];
};