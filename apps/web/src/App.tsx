import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useOutletContext } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoginPage } from "./features/auth/LoginPage";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { RequireRole } from "./features/auth/RequireRole";
import { canViewAll, MANAGEMENT_ROLES, VIEW_ALL_ROLES } from "./permissions";
import { useAuth } from "./contexts/AuthContext";
import { NotFound } from "./pages/NotFound";

/**
 * Each screen loads on first visit, so signing in downloads only the shell and the screen being opened. The dashboard
 * is the heaviest because it pulls in the chart library.
 */
const DashboardPage = lazy(() =>
  import("./features/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const WorkersPage = lazy(() =>
  import("./features/workers/WorkersPage").then((m) => ({ default: m.WorkersPage })),
);
const AttendancePage = lazy(() =>
  import("./features/attendance/AttendancePage").then((m) => ({ default: m.AttendancePage })),
);
const PayrollPage = lazy(() =>
  import("./features/payroll/PayrollPage").then((m) => ({ default: m.PayrollPage })),
);
const DeductionsPage = lazy(() =>
  import("./features/deductions/DeductionsPage").then((m) => ({ default: m.DeductionsPage })),
);
const LeavePage = lazy(() =>
  import("./features/leave/LeavePage").then((m) => ({ default: m.LeavePage })),
);
const InvoicesPage = lazy(() =>
  import("./features/invoices/InvoicesPage").then((m) => ({ default: m.InvoicesPage })),
);
const LettersPage = lazy(() =>
  import("./features/letters/LettersPage").then((m) => ({ default: m.LettersPage })),
);
const SiteProgressPage = lazy(() =>
  import("./features/progress/SiteProgressPage").then((m) => ({ default: m.SiteProgressPage })),
);
const UserPage = lazy(() =>
  import("./features/users/UserPage").then((m) => ({ default: m.UserPage })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

/** One loading state for every lazily loaded screen, shown inside the layout so the navigation stays in place. */
function Screens() {
  // Layout hands its screens a context (the settings screen updates the header through it); pass it on.
  const context = useOutletContext();
  return (
    <Suspense
      fallback={
        <p role="status" className="py-8 text-gray-600">
          Loading...
        </p>
      }
    >
      <Outlet context={context} />
    </Suspense>
  );
}

/** Managers and administrators land on the dashboard; supervisors, who have none, land on the worker directory. */
function Home() {
  const { user } = useAuth();
  return (
    <Navigate
      to={canViewAll(user?.role) ? "/dashboard" : "/workers"}
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
          <Route element={<Screens />}>
            <Route
              path="dashboard"
              element={
                <RequireRole roles={VIEW_ALL_ROLES}>
                  <DashboardPage />
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
                <RequireRole roles={VIEW_ALL_ROLES}>
                  <PayrollPage />
                </RequireRole>
              }
            />
            <Route
              path="deductions"
              element={
                <RequireRole roles={VIEW_ALL_ROLES}>
                  <DeductionsPage />
                </RequireRole>
              }
            />
            <Route path="leave" element={<LeavePage />} />
            <Route
              path="invoices"
              element={
                <RequireRole roles={VIEW_ALL_ROLES}>
                  <InvoicesPage />
                </RequireRole>
              }
            />
            <Route path="letters" element={<LettersPage />} />
            <Route path="progress" element={<SiteProgressPage />} />
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
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
