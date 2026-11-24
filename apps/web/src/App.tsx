import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useOutletContext } from "react-router-dom";
import { LoadingState } from "./ui";
import { Layout } from "./components/Layout";
import { LoginPage } from "./features/auth/LoginPage";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { RequireRole } from "./features/auth/RequireRole";
import { ADMIN_SCREEN_ROLES, canViewAll, FINANCE_ROLES, SITE_PROGRESS_ROLES, VIEW_ALL_ROLES } from "./permissions";
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
const WorkerProfilePage = lazy(() =>
  import("./features/workers/WorkerProfilePage").then((m) => ({ default: m.WorkerProfilePage })),
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
const MyAttendancePage = lazy(() =>
  import("./features/staff/MyAttendancePage").then((m) => ({ default: m.MyAttendancePage })),
);
const MyLeavePage = lazy(() =>
  import("./features/staff/MyLeavePage").then((m) => ({ default: m.MyLeavePage })),
);
const MyLettersPage = lazy(() =>
  import("./features/staff/MyLettersPage").then((m) => ({ default: m.MyLettersPage })),
);
const MyProfilePage = lazy(() =>
  import("./features/staff/MyProfilePage").then((m) => ({ default: m.MyProfilePage })),
);
const StaffAttendancePage = lazy(() =>
  import("./features/staff/StaffAttendancePage").then((m) => ({ default: m.StaffAttendancePage })),
);
const StaffLeavePage = lazy(() =>
  import("./features/staff/StaffLeavePage").then((m) => ({ default: m.StaffLeavePage })),
);
const StaffPayrollPage = lazy(() =>
  import("./features/staff/StaffPayrollPage").then((m) => ({ default: m.StaffPayrollPage })),
);
const AccountsPage = lazy(() =>
  import("./features/finance/AccountsPage").then((m) => ({ default: m.AccountsPage })),
);
const ExpensesPage = lazy(() =>
  import("./features/finance/ExpensesPage").then((m) => ({ default: m.ExpensesPage })),
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
      fallback={<LoadingState label="Loading..." />}
    >
      <Outlet context={context} />
    </Suspense>
  );
}

/**
 * Managers and administrators land on the dashboard; supervisors, who have none, land on the worker directory.
 * An Employee-role login has only its own sign-in page.
 */
function Home() {
  const { user } = useAuth();
  const target = user?.role === "Employee" ? "/my-attendance" : canViewAll(user?.role) ? "/dashboard" : "/workers";
  return <Navigate to={target} replace />;
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
            <Route path="workers/:id" element={<WorkerProfilePage />} />
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
            <Route path="my-attendance" element={<MyAttendancePage />} />
            <Route path="my-leave" element={<MyLeavePage />} />
            <Route path="my-letters" element={<MyLettersPage />} />
            <Route path="my-profile" element={<MyProfilePage />} />
            <Route
              path="staff"
              element={
                <RequireRole roles={VIEW_ALL_ROLES}>
                  <StaffAttendancePage />
                </RequireRole>
              }
            />
            <Route
              path="staff-payroll"
              element={
                <RequireRole roles={VIEW_ALL_ROLES}>
                  <StaffPayrollPage />
                </RequireRole>
              }
            />
            <Route
              path="staff-leave"
              element={
                <RequireRole roles={VIEW_ALL_ROLES}>
                  <StaffLeavePage />
                </RequireRole>
              }
            />
            <Route
              path="invoices"
              element={
                <RequireRole roles={VIEW_ALL_ROLES}>
                  <InvoicesPage />
                </RequireRole>
              }
            />
            <Route
              path="finance/accounts"
              element={
                <RequireRole roles={FINANCE_ROLES}>
                  <AccountsPage />
                </RequireRole>
              }
            />
            <Route
              path="finance/expenses"
              element={
                <RequireRole roles={FINANCE_ROLES}>
                  <ExpensesPage />
                </RequireRole>
              }
            />
            <Route path="letters" element={<LettersPage />} />
            <Route
              path="progress"
              element={
                <RequireRole roles={SITE_PROGRESS_ROLES}>
                  <SiteProgressPage guardNavigation />
                </RequireRole>
              }
            />
            <Route
              path="users"
              element={
                <RequireRole roles={ADMIN_SCREEN_ROLES}>
                  <UserPage />
                </RequireRole>
              }
            />
            <Route
              path="settings"
              element={
                <RequireRole roles={ADMIN_SCREEN_ROLES}>
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
