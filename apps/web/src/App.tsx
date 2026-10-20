import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AttendancePage } from "./features/attendance/AttendancePage";
import { PayrollPage } from "./features/payroll/PayrollPage";
import { LoginPage } from "./features/auth/LoginPage";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { RequireRole } from "./features/auth/RequireRole";
import { SettingsPage } from "./features/settings/SettingsPage";
import { WorkersPage } from "./features/workers/WorkersPage";
import { NotFound } from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      {/* Public. LoginPage itself redirects away when the user is already signed in. */}
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/workers" replace />} />
          <Route path="workers" element={<WorkersPage />} />
          <Route path="attendance" element={<AttendancePage guardNavigation />} />
          <Route path="payroll" element={<PayrollPage />} />
          <Route
            path="settings"
            element={
              <RequireRole roles={["Administrator"]}>
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
