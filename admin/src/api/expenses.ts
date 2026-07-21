import api from "./axios";

/* ==========================================================================
   TYPES
   ========================================================================== */

export type ReportFormat = "pdf" | "excel" | "csv";

export interface ExpenseCategory {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Expense {
  id: number;
  receipt_id: string;
  title: string;
  amount: number;

  category_id: number | null;
  category_name?: string | null;

  fund_id?: number | null;
  fund_name?: string | null;

  vendor_name?: string | null;

  expense_date?: string | null;

  note?: string | null;
  receipt_image?: string | null;

  created_by: string;
  created_by_id: number;

  approved_by?: string | null;
  approved_by_id?: number | null;
  approved_at?: string | null;

  created_at: string;

  is_deleted: boolean;
}

export interface ExpensePage {
  items: Expense[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ExpenseStats {
  total_expenses: number;
  total_amount: number;

  this_month_amount: number;
  today_amount: number;

  pending_approval: number;
  approved: number;

  average_expense: number;

  highest_expense: number;
  lowest_expense: number;

  current_month_count: number;
  previous_month_count: number;

  monthly_growth_percentage: number;
}

export interface MonthlySummaryItem {
  month: string;
  expense_count: number;
  total_amount: number;
}

export interface CategorySummaryItem {
  category: string;
  total_amount: number;
  expense_count: number;
  percentage: number;
}

export interface ExpenseDashboard {
  stats: ExpenseStats;
  monthly_summary: MonthlySummaryItem[];
  category_summary: CategorySummaryItem[];
  recent_expenses: Expense[];
}

export interface ExpenseFilters {
  page?: number;
  page_size?: number;

  search?: string;

  category_id?: number;

  fund_id?: number;

  approved?: boolean;

  created_by?: number;

  month?: number;
  year?: number;

  from_date?: string;
  to_date?: string;

  min_amount?: number;
  max_amount?: number;

  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export interface CreateExpensePayload {
  title: string;
  amount: number;
  category_id?: number;
  fund_id?: number;
  vendor_name?: string;
  expense_date?: string;
  note?: string;
  receipt_image?: string;
}

export interface UpdateExpensePayload {
  title?: string;
  amount?: number;
  category_id?: number;
  note?: string;
  receipt_image?: string;
}

export interface CreateCategoryPayload {
  name: string;
  description?: string;
}

export interface UpdateCategoryPayload {
  name?: string;
  description?: string;
}

export interface ApiMessage {
  message: string;
}

/* ==========================================================================
   HELPERS
   ========================================================================== */

const buildQuery = (params?: ExpenseFilters) => {
  if (!params) return "";

  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      search.append(key, String(value));
    }
  });

  return search.toString() ? `?${search.toString()}` : "";
};

/* ==========================================================================
   EXPENSE CATEGORIES
   ========================================================================== */

export const getExpenseCategories = async () => {
  const { data } = await api.get<ExpenseCategory[]>(
    "/expenses/categories"
  );
  return data;
};

export const createExpenseCategory = async (
  payload: CreateCategoryPayload
) => {
  const { data } = await api.post<ExpenseCategory>(
    "/expenses/categories",
    payload
  );

  return data;
};

export const updateExpenseCategory = async (
  id: number,
  payload: UpdateCategoryPayload
) => {
  const { data } = await api.put<ExpenseCategory>(
    `/expenses/categories/${id}`,
    payload
  );

  return data;
};

export const toggleExpenseCategoryStatus = async (
  id: number
) => {
  const { data } = await api.patch<ApiMessage>(
    `/expenses/categories/${id}/status`
  );

  return data;
};

export const deleteExpenseCategory = async (
  id: number
) => {
  const { data } = await api.delete<ApiMessage>(
    `/expenses/categories/${id}`
  );

  return data;
};

/* ==========================================================================
   EXPENSES
   ========================================================================== */

export const getExpenses = async (
  filters?: ExpenseFilters
) => {
  const { data } = await api.get<ExpensePage>(
    "/expenses/",
    { params: filters }
  );

  return data;
};

export const getExpense = async (id: number) => {
  const { data } = await api.get<Expense>(
    `/expenses/${id}`
  );

  return data;
};

export const createExpense = async (
  payload: CreateExpensePayload
) => {
  const { data } = await api.post<Expense>(
    "/expenses/",
    payload
  );

  return data;
};

export const updateExpense = async (
  id: number,
  payload: UpdateExpensePayload
) => {
  const { data } = await api.put<Expense>(
    `/expenses/${id}`,
    payload
  );

  return data;
};

export const approveExpense = async (
  id: number
) => {
  const { data } = await api.patch<Expense>(
    `/expenses/${id}/approve`
  );

  return data;
};

export const deleteExpense = async (
  id: number
) => {
  const { data } = await api.delete<ApiMessage>(
    `/expenses/${id}`
  );

  return data;
};

/* ==========================================================================
   RECEIPTS
   ========================================================================== */

export const replaceExpenseReceipt = async (
  id: number,
  receipt_image: string
) => {
  const { data } = await api.patch<Expense>(
    `/expenses/${id}/receipt`,
    {
      receipt_image,
    }
  );

  return data;
};

export const deleteExpenseReceipt = async (
  id: number
) => {
  const { data } = await api.delete<ApiMessage>(
    `/expenses/${id}/receipt`
  );

  return data;
};

/* ==========================================================================
   DASHBOARD
   ========================================================================== */

export const getExpenseStats = async () => {
  const { data } = await api.get<ExpenseStats>(
    "/expenses/stats"
  );

  return data;
};

export const getMonthlySummary = async () => {
  const { data } = await api.get<
    MonthlySummaryItem[]
  >("/expenses/monthly-summary");

  return data;
};

export const getCategorySummary = async () => {
  const { data } = await api.get<
    CategorySummaryItem[]
  >("/expenses/category-summary");

  return data;
};

export const getRecentExpenses = async () => {
  const { data } = await api.get<Expense[]>(
    "/expenses/recent"
  );

  return data;
};

export const getExpenseDashboard = async () => {
  const { data } = await api.get<ExpenseDashboard>(
    "/expenses/dashboard"
  );

  return data;
};

/* ==========================================================================
   REPORTS
   ========================================================================== */

export const downloadExpenseReport = async (
  format: ReportFormat,
  filters?: ExpenseFilters
) => {
  const query = buildQuery(filters);

  const { data } = await api.get(
    `/expenses/report${query ? `${query}&` : "?"}format=${format}`,
    {
      responseType: "blob",
    }
  );

  return data;
};