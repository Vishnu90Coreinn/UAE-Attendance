import { useEffect, useState } from "react";
import { KeyRound, LogOut, UsersRound } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { COMPANY_NAME } from "../branding";
import { getPayrollSettings, type PayrollSettings } from "../api/settings";
import { isManagement } from "../permissions";
import { useAuth } from "../contexts/AuthContext";
import { ChangePasswordDialog } from "../features/auth/ChangePasswordDialog";
import { useAttendanceSummary } from "../features/attendance/useAttendanceSummary";
import { HealthChip } from "./HealthChip";
import { navItemsForRole } from "./navItems";

const headerButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-600 px-3 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300";

const tabClass =
  "inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-5 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-300";

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [companySettings, setCompanySettings] =
    useState<PayrollSettings | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPayrollSettings()
      .then((settings) => {
        if (!cancelled) setCompanySettings(settings);
      })
      .catch(() => {
        // Branding must not prevent use of the application; the feature screen reports any load failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = user ? navItemsForRole(user.role) : [];
  const attendanceSummary = useAttendanceSummary(!!user);
  // Managers see what is waiting for them; supervisors see what was sent back to them.
  const attendanceAttention = isManagement(user?.role)
    ? (attendanceSummary?.submittedTotal ?? 0)
    : (attendanceSummary?.rejectedTotal ?? 0);

  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-100 text-gray-800">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-slate-900 focus:shadow"
      >
        Skip to main content
      </a>

      <header className="bg-slate-900 text-white shadow-md">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0 max-w-full">
            <h1 className="break-words text-lg font-bold leading-tight">
              {companySettings?.companyName ?? COMPANY_NAME}
            </h1>
            <p className="break-words text-xs text-blue-300">
              {companySettings?.tagline ?? "Official HR & Payroll System"}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <HealthChip />
            {user && (
              <>
                <p className="min-w-0 break-words text-sm text-slate-100">{`Logged in as ${user.username} (${user.role})`}</p>
                {isManagement(user.role) && (
                  <Link to="/users" className={headerButtonClass}>
                    <UsersRound aria-hidden="true" size={16} />
                    User Access
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setChangePasswordOpen(true)}
                  className={headerButtonClass}
                >
                  <KeyRound aria-hidden="true" size={16} />
                  Change password
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className={headerButtonClass}
                >
                  <LogOut aria-hidden="true" size={16} />
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="border-b border-slate-700 bg-slate-800 text-white shadow-sm"
      >
        <div className="mx-auto flex w-full max-w-7xl overflow-x-auto px-4">
          {tabs.map((item) =>
            item.path ? (
              <NavLink
                key={item.key}
                to={item.path}
                className={({ isActive }) =>
                  `${tabClass} ${isActive ? "border-blue-500 text-blue-400" : "border-transparent text-gray-300 hover:text-white"}`
                }
              >
                {item.label}
                {item.key === "attendance" && attendanceAttention > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-amber-400 px-2 text-xs font-bold text-slate-900"
                    >
                      {attendanceAttention}
                    </span>
                    <span className="sr-only">
                      {" "}
                      ({attendanceAttention} need attention)
                    </span>
                  </>
                )}
              </NavLink>
            ) : (
              <button
                key={item.key}
                type="button"
                disabled
                className={`${tabClass} border-transparent text-gray-400 disabled:cursor-not-allowed`}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      </nav>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl flex-grow px-4 py-6"
      >
        <Outlet context={{ onPayrollSettingsChanged: setCompanySettings }} />
      </main>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </div>
  );
}
