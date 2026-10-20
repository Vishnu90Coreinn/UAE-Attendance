import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-500">
        <p role="status" className="inline-flex items-center gap-2 text-sm">
          <Loader2 aria-hidden="true" size={20} className="animate-spin" />
          Checking your session...
        </p>
      </div>
    );
  }

  if (status === "signedOut") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
