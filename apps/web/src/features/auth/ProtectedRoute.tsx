import { LoadingState, Skeleton } from "../../ui";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex h-screen flex-col bg-canvas">
        <div aria-hidden="true" className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white px-4">
          <Skeleton className="size-10" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex min-h-0 flex-1">
          <div aria-hidden="true" className="hidden w-64 shrink-0 space-y-3 bg-sidebar p-4 md:block">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-8 bg-white/10" />
            ))}
          </div>
          <div className="min-w-0 flex-1 p-6 lg:p-8">
            <LoadingState label="Checking your session..." />
          </div>
        </div>
      </div>
    );
  }

  if (status === "signedOut") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
