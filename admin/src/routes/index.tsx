// src/routes/index.tsx

import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import LoginPage from "../pages/auth/LoginPage";
import DashboardPage from "../pages/dashboard/DashboardPage";
import Prayertimespage from "../pages/prayer/Prayertimespage";
import { StaffManagement } from "../pages/staff/StaffManagementPage";

import DashboardLayout from "../components/layout/DashboardLayout";
import ChandaDashboard from "../pages/finance/ChandaDashboard";
import FundManagementPage from "../pages/Fund/FundManagementPage";
import FundDetailPage from "../pages/Fund/FundDetailPage";
import DonationsPage from "../pages/donations/DonationsPage";
import ExpensesPage from "../pages/expenses/ExpensesPage";
import ProtectedRoute from "./ProtectedRoute";
import UserManagementPage from "../pages/users/UserManagementPage";
import AnnouncementPage from "../pages/announcements/AnnouncementPage";
import CollectionHistoryPage from "../pages/collections/CollectionHistoryPage";
import AuditPage from "../pages/audit/AuditPage";
import PendingRegistrationsPage from "../pages/registrations/PendingRegistrationsPage";
import CashSubmissionsPage from "../pages/cash/CashSubmissionsPage";
import PublicRoute from "./PublicRoute";

/**
 * Protected page wrapper
 * Adds authentication + dashboard layout
 */
function Protected({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardLayout>{children}</DashboardLayout>
    </ProtectedRoute>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* ================= PUBLIC ================= */}

      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />

      {/* ================= PROTECTED ================= */}

      <Route
        path="/dashboard"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />

      <Route
        path="/prayer"
        element={
          <Protected>
            <Prayertimespage />
          </Protected>
        }
      />
      <Route
        path="/staff"
        element={
          <Protected>
            <StaffManagement />
          </Protected>
        }
      />
      <Route
      path="/chanda"
      element={
        <Protected>
          <ChandaDashboard />
        </Protected>
      }
    />  

      <Route
        path="/funds"
        element={
          <Protected>
            <FundManagementPage />
          </Protected>
        }
      />

      <Route
        path="/funds/:id"
        element={
          <Protected>
            <FundDetailPage />
          </Protected>
        }
      />

      <Route
        path="/donations"
        element={
          <Protected>
            <DonationsPage />
          </Protected>
        }
      />

      <Route
        path="/expenses"
        element={
          <Protected>
            <ExpensesPage />
          </Protected>
        }
      />
      <Route
        path="/users"
        element={
          <Protected> 
            <UserManagementPage />
          </Protected>
        }
      />
      <Route
        path="/announcements"
        element={
          <Protected>
            <AnnouncementPage />
          </Protected>
        }
      />

      <Route
        path="/collections"
        element={
          <Protected>
            <CollectionHistoryPage />
          </Protected>
        }
      />

      <Route
        path="/audit"
        element={
          <Protected>
            <AuditPage />
          </Protected>
        }
      />

      <Route
        path="/pending-registrations"
        element={
          <Protected>
            <PendingRegistrationsPage />
          </Protected>
        }
      />

      <Route
        path="/cash-submissions"
        element={
          <Protected>
            <CashSubmissionsPage />
          </Protected>
        }
      />

      {/* ================= DEFAULT ================= */}

      <Route
        path="/"
        element={<Navigate to="/dashboard" replace />}
      />

      <Route
        path="*"
        element={<Navigate to="/dashboard" replace />}
      />
    </Routes>
  );
}