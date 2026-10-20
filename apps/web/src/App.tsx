import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoginPage } from "./features/auth/LoginPage";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
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
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
