// src/api/donation.ts

import api from "./axios";

import type {
  Donation,
  DonationPage,
  DonationSummary,
  DonationDashboard,
  DonationPurpose,
  DonationReportParams,
  CreateDonationPayload,
  UpdateDonationPayload,
  CreateDonationPurposePayload,
  UpdateDonationPurposePayload,
} from "../types/donation";

/* ============================================================================
 * Donations
 * ========================================================================== */

export interface DonationFilters {
  page?: number;
  page_size?: number;
  search?: string;
  method?: string;
  purpose_id?: number;
  fund_id?: number;
  donor_type?: string;
  from_date?: string;
  to_date?: string;
}

export const getDonations = async (
  params?: DonationFilters
): Promise<DonationPage> => {
  const page = params?.page ?? 1;
  const page_size = params?.page_size ?? 15;

  // Backend uses limit/offset, not page/page_size
  const { data } = await api.get("/donations/", {
    params: {
      search: params?.search,
      method: params?.method,
      purpose_id: params?.purpose_id,
      fund_id: params?.fund_id,
      donor_type: params?.donor_type,
      from_date: params?.from_date,
      to_date: params?.to_date,
      limit: page_size,
      offset: (page - 1) * page_size,
    },
  });

  const items: Donation[] = Array.isArray(data) ? data : (data.items ?? []);
  return {
    items,
    total: items.length,
    page,
    page_size,
    total_pages: 1,
  };
};

/* ============================================================================
 * Member Search (for donation form auto-fill)
 * ========================================================================== */

export interface MemberSearchResult {
  id: number;
  name: string;
  phone: string;
  chanda_no: string;
  is_active: boolean;
}

export const searchMembers = async (
  search: string
): Promise<MemberSearchResult[]> => {
  if (!search.trim()) return [];
  const { data } = await api.get("/admin/families", {
    params: { search: search.trim(), active_only: true },
  });
  return data;
};

export const getDonation = async (
  id: number
): Promise<Donation> => {
  const { data } = await api.get(`/donations/${id}`);

  return data;
};

export const createDonation = async (
  payload: CreateDonationPayload
): Promise<Donation> => {
  const { data } = await api.post(
    "/donations/",
    payload
  );

  return data;
};

export const updateDonation = async (
  id: number,
  payload: UpdateDonationPayload
): Promise<Donation> => {
  const { data } = await api.put(
    `/donations/${id}`,
    payload
  );

  return data;
};

export const deleteDonation = async (
  id: number
): Promise<{ message: string }> => {
  const { data } = await api.delete(
    `/donations/${id}`
  );

  return data;
};

/* ============================================================================
 * Summary
 * ========================================================================== */

export interface DonationSummaryFilters {
  from_date?: string;

  to_date?: string;

  purpose_id?: number;

  donor_type?: string;
}

export const getDonationSummary = async (
  params?: DonationSummaryFilters
): Promise<DonationSummary> => {
  const { data } = await api.get(
    "/donations/summary",
    {
      params,
    }
  );

  return data;
};

/* ============================================================================
 * Dashboard
 * ========================================================================== */

export const getDonationDashboard =
  async (): Promise<DonationDashboard> => {
    const { data } = await api.get(
      "/donations/dashboard"
    );

    return data;
  };

/* ============================================================================
 * Donation Purposes
 * ========================================================================== */

export const getDonationPurposes =
  async (): Promise<DonationPurpose[]> => {
    const { data } = await api.get("/finance/donation-purposes");
    return Array.isArray(data) ? data : [];
  };

export const createDonationPurpose =
  async (
    payload: CreateDonationPurposePayload
  ): Promise<DonationPurpose> => {
    const { data } = await api.post(
      "/finance/donation-purposes",
      payload
    );

    return data;
  };

export const updateDonationPurpose =
  async (
    id: number,
    payload: UpdateDonationPurposePayload
  ): Promise<DonationPurpose> => {
    const { data } = await api.put(
      `/finance/donation-purposes/${id}`,
      payload
    );

    return data;
  };

export const toggleDonationPurpose =
  async (
    id: number
  ): Promise<DonationPurpose> => {
    const { data } = await api.patch(
      `/donation-purposes/${id}/status`
    );

    return data;
  };

export const deleteDonationPurpose =
  async (
    id: number
  ): Promise<{ message: string }> => {
    const { data } = await api.delete(
      `/finance/donation-purposes/${id}`
    );

    return data;
  };

/* ============================================================================
 * Reports
 * ========================================================================== */

export const downloadDonationReport =
  async (
    params: DonationReportParams
  ): Promise<Blob> => {
    const { data } = await api.get(
      "/donations/report",
      {
        params,
        responseType: "blob",
      }
    );

    return data;
  };