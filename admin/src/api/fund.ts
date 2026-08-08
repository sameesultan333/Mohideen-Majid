// src/api/fund.ts

import api from "./axios";
import type {
  BackendFund,
  Fund,
  FundDashboard,
  FundStats,
  FundCollectionResponse,
  FundExpenseResponse,
  CreateFundPayload,
  UpdateFundPayload,
} from "../types/fund";

/* -------------------------------------------------------------------------- */
/* Normalizer — converts backend FundDetailOut → flat Fund shape              */
/* -------------------------------------------------------------------------- */

function normalizeFund(raw: BackendFund): Fund {
  const s = raw.stats;
  return {
    ...raw,
    end_date: raw.expected_end_date ?? null,
    collected_amount: s?.total_collected ?? 0,
    spent_amount: s?.total_spent ?? 0,
    balance: s?.balance ?? 0,
    progress_percentage: s?.progress_pct ?? 0,
    donation_count: s?.total_donations ?? 0,
    expense_count: s?.total_expenses ?? 0,
    last_donation_at: s?.last_donation_at ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export const getFundDashboard = async (): Promise<FundDashboard> => {
  const { data } = await api.get("/funds/dashboard");
  return {
    ...data,
    funds: ((data.funds ?? []) as BackendFund[]).map(normalizeFund),
  };
};

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

export interface GetFundsParams {
  status?: "draft" | "active" | "completed" | "archived";
  include_archived?: boolean;
}

export const getFunds = async (params?: GetFundsParams): Promise<Fund[]> => {
  const { data } = await api.get("/funds/", { params });
  return (data as BackendFund[]).map(normalizeFund);
};

/* -------------------------------------------------------------------------- */
/* Single                                                                      */
/* -------------------------------------------------------------------------- */

export const getFund = async (id: number): Promise<Fund> => {
  const { data } = await api.get(`/funds/${id}`);
  return normalizeFund(data as BackendFund);
};

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export const createFund = async (payload: CreateFundPayload): Promise<Fund> => {
  const { data } = await api.post("/funds/", payload);
  return normalizeFund(data as BackendFund);
};

/* -------------------------------------------------------------------------- */
/* Update                                                                      */
/* -------------------------------------------------------------------------- */

export const updateFund = async (id: number, payload: UpdateFundPayload): Promise<Fund> => {
  const { data } = await api.put(`/funds/${id}`, payload);
  return normalizeFund(data as BackendFund);
};

/* -------------------------------------------------------------------------- */
/* Archive / Unarchive                                                         */
/* -------------------------------------------------------------------------- */

export const archiveFund = async (id: number): Promise<{ message: string; fund_id: number }> => {
  const { data } = await api.patch(`/funds/${id}/archive`);
  return data;
};

export const unarchiveFund = async (id: number): Promise<{ message: string; fund_id: number }> => {
  const { data } = await api.patch(`/funds/${id}/unarchive`);
  return data;
};

/* -------------------------------------------------------------------------- */
/* Delete                                                                      */
/* -------------------------------------------------------------------------- */

export const deleteFund = async (id: number): Promise<{ message: string; fund_id: number }> => {
  const { data } = await api.delete(`/funds/${id}`);
  return data;
};

/* -------------------------------------------------------------------------- */
/* Stats                                                                       */
/* -------------------------------------------------------------------------- */

export const getFundStats = async (id: number): Promise<FundStats> => {
  const { data } = await api.get(`/funds/${id}/stats`);
  return data;
};

/* -------------------------------------------------------------------------- */
/* Collections                                                                 */
/* -------------------------------------------------------------------------- */

export interface GetFundCollectionsParams {
  page?: number;
  page_size?: number;
  search?: string;
  method?: string;
  from_date?: string;
  to_date?: string;
}

export const getFundCollections = async (
  id: number,
  params?: GetFundCollectionsParams
): Promise<FundCollectionResponse> => {
  const { data } = await api.get(`/funds/${id}/collections`, { params });
  return data;
};

/* -------------------------------------------------------------------------- */
/* Expenses                                                                    */
/* -------------------------------------------------------------------------- */

export interface GetFundExpensesParams {
  page?: number;
  page_size?: number;
  search?: string;
  from_date?: string;
  to_date?: string;
}

export const getFundExpenses = async (
  id: number,
  params?: GetFundExpensesParams
): Promise<FundExpenseResponse> => {
  const { data } = await api.get(`/funds/${id}/expenses`, { params });
  return data;
};

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

export interface FundReportParams {
  format: "pdf" | "excel" | "csv";
  from_date?: string;
  to_date?: string;
}

export const downloadFundReport = async (id: number, params: FundReportParams): Promise<Blob> => {
  const { data } = await api.get(`/funds/${id}/report`, {
    params,
    responseType: "blob",
  });
  return data;
};
