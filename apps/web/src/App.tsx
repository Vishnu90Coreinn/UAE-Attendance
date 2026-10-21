import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AttendancePage } from "./features/attendance/AttendancePage";
import { PayrollPage } from "./features/payroll/PayrollPage";
import { LoginPage } from "./features/auth/LoginPage";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { RequireRole } from "./features/auth/RequireRole";
import { SettingsPage } from "./features/settings/SettingsPage";
import { WorkersPage } from "./features/workers/WorkersPage";
import { LeavePage } from "./features/leave/LeavePage";
import { DeductionsPage } from "./features/deductions/DeductionsPage";
import { UserPage } from "./features/users/UserPage";
import { isManagement, MANAGEMENT_ROLES } from "./permissions";
import { useAuth } from "./contexts/AuthContext";
import { NotFound } from "./pages/NotFound";

/** The dashboard pulls in the chart library, so it loads only when a manager or administrator opens it. */
const DashboardPage = lazy(() =>
  import("./features/dashboard/DashboardPage").then((m) => ({
    default: m.DashboardPage,
  })),
);

/** Managers and administrators land on the dashboard; supervisors, who have none, land on the worker directory. */
function Home() {
  const { user } = useAuth();
  return (
    <Navigate
      to={isManagement(user?.role) ? "/dashboard" : "/workers"}
      replace
    />
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public. LoginPage itself redirects away when the user is already signed in. */}
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route
            path="dashboard"
            element={
              <RequireRole roles={MANAGEMENT_ROLES}>
                <Suspense
                  fallback={
                    <p role="status" className="py-8 text-gray-600">
                      Loading dashboard...
                    </p>
                  }
                >
                  <DashboardPage />
                </Suspense>
              </RequireRole>
            }
          />
          <Route path="workers" element={<WorkersPage />} />
          <Route
            path="attendance"
            element={<AttendancePage guardNavigation />}
          />
          <Route
            path="payroll"
            element={
              <RequireRole roles={MANAGEMENT_ROLES}>
                <PayrollPage />
              </RequireRole>
            }
          />
          <Route
            path="deductions"
            element={
              <RequireRole roles={MANAGEMENT_ROLES}>
                <DeductionsPage />
              </RequireRole>
            }
          />
          <Route path="leave" element={<LeavePage />} />
          <Route
            path="users"
            element={
              <RequireRole roles={MANAGEMENT_ROLES}>
                <UserPage />
              </RequireRole>
            }
          />
          <Route
            path="settings"
            element={
              <RequireRole roles={MANAGEMENT_ROLES}>
                <SettingsPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
