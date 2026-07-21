// src/api/report.ts

import api from "./axios";

import type {
  FinanceReportFilters,
  DonationReportFilters,
  ExpenseReportFilters,
  FundReportFilters,
} from "../types/report";

/* ============================================================================
 * Finance Report
 * ========================================================================== */

export const downloadFinanceReport = async (
  params: FinanceReportFilters
): Promise<Blob> => {
  const { data } = await api.get("/finance/report", {
    params,
    responseType: "blob",
  });

  return data;
};

/* ============================================================================
 * Donation Report
 * ========================================================================== */

export const downloadDonationReport = async (
  params: DonationReportFilters
): Promise<Blob> => {
  const { data } = await api.get("/donations/report", {
    params,
    responseType: "blob",
  });

  return data;
};

/* ============================================================================
 * Expense Report
 * ========================================================================== */

export const downloadExpenseReport = async (
  params: ExpenseReportFilters
): Promise<Blob> => {
  const { data } = await api.get("/expenses/report", {
    params,
    responseType: "blob",
  });

  return data;
};

/* ============================================================================
 * Fund Report
 * ========================================================================== */

export const downloadFundReport = async (
  fundId: number,
  params: FundReportFilters
): Promise<Blob> => {
  const { data } = await api.get(`/funds/${fundId}/report`, {
    params,
    responseType: "blob",
  });

  return data;
};