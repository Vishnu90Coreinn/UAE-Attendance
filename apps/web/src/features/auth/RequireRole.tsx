import type { ReactNode } from "react";
import type { Role } from "../../api/auth";
import { useAuth } from "../../contexts/AuthContext";

interface RequireRoleProps {
  /** Roles that may open the page. The server enforces access independently of this check. */
  roles: readonly Role[];
  children: ReactNode;
}

/** Renders the page for the allowed roles; anyone else who types the URL sees a plain access message. */
export function RequireRole({ roles, children }: RequireRoleProps) {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return (
      <section>
        <h2 className="text-2xl font-bold text-gray-800">You do not have access to this page</h2>
        <p className="mt-1 text-sm text-gray-600">Ask a Manager or Administrator if you need to use it.</p>
      </section>
    );
  }
  return <>{children}</>;
}
