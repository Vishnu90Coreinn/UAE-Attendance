import { useEffect, useState } from "react";
import { KeyRound, LogOut, PanelLeftClose, PanelLeftOpen, UsersRound } from "lucide-react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { COMPANY_NAME } from "../branding";
import { getPayrollSettings, type PayrollSettings } from "../api/settings";
import { isManagement } from "../permissions";
import { useAuth } from "../contexts/AuthContext";
import { ChangePasswordDialog } from "../features/auth/ChangePasswordDialog";
import { useAttendanceSummary } from "../features/attendance/useAttendanceSummary";
import { useIsDesktop } from "../utils/useIsDesktop";
import { navItemsForRole } from "./navItems";
import { PhoneShell } from "./PhoneShell";
import { Sidebar } from "./Sidebar";

const headerButtonClass =
  "inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-lg border border-transparent px-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100 hover:text-ink-900";

const SIDEBAR_KEY = "hrpayroll.sidebarCollapsed";

function initialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    // Storage may be unavailable; fall back to the screen size.
  }
  return typeof window !== "undefined" && window.innerWidth < 1100;
}

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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialCollapsed);
  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, current ? "0" : "1");
      } catch {
        // Not persisting is harmless.
      }
      return !current;
    });
  }

  const isDesktop = useIsDesktop();
  const page = <Outlet context={{ onPayrollSettingsChanged: setCompanySettings }} />;

  if (!isDesktop) {
    return (
      <>
        <PhoneShell
          companyName={companySettings?.companyName ?? COMPANY_NAME}
          user={user}
          attendanceAttention={attendanceAttention}
          onChangePassword={() => setChangePasswordOpen(true)}
          onSignOut={handleSignOut}
        >
          {page}
        </PhoneShell>
        <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-ink-900 focus:shadow"
      >
        Skip to main content
      </a>

      <header className="z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white px-4">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!sidebarCollapsed}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 hover:text-ink-900"
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" size={20} /> : <PanelLeftClose aria-hidden="true" size={20} />}
        </button>
        <img src="/icons/favicon-48.png" alt="" width={36} height={36} className="size-9 shrink-0 rounded-lg border border-line" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold leading-tight text-ink-900 lg:text-base">
            {companySettings?.companyName ?? COMPANY_NAME}
          </h1>
          <p className="hidden truncate text-xs text-ink-500 sm:block">
            {companySettings?.tagline ?? "Official HR & Payroll System"}
          </p>
        </div>
        {user && (
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="mr-2 hidden items-center gap-2.5 lg:flex">
              <span
                aria-hidden="true"
                className="inline-flex size-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold uppercase text-white"
              >
                {user.username.slice(0, 1)}
              </span>
              <span aria-hidden="true" className="leading-tight">
                <span className="block text-sm font-medium text-ink-900">{user.username}</span>
                <span className="block text-xs text-ink-500">{user.role}</span>
              </span>
            </div>
            <p className="sr-only">{`Logged in as ${user.username} (${user.role})`}</p>
            {isManagement(user.role) && (
              <Link to="/users" className={headerButtonClass} aria-label="User Access" title="User Access">
                <UsersRound aria-hidden="true" size={16} />
                <span className="hidden xl:inline">User Access</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => setChangePasswordOpen(true)}
              className={headerButtonClass}
              aria-label="Change password"
              title="Change password"
            >
              <KeyRound aria-hidden="true" size={16} />
              <span className="hidden xl:inline">Change password</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className={headerButtonClass}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut aria-hidden="true" size={16} />
              <span className="hidden xl:inline">Sign out</span>
            </button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar items={tabs} collapsed={sidebarCollapsed} attendanceAttention={attendanceAttention} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[90rem] px-6 py-8 outline-none lg:px-8">
            {page}
          </main>
        </div>
      </div>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </div>
  );
}
