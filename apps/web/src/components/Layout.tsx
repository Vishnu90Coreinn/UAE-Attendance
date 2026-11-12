import { useEffect, useState } from "react";
import { Bell, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { COMPANY_NAME, SHORT_NAME } from "../branding";
import { getPayrollSettings, type PayrollSettings } from "../api/settings";
import { isManagement } from "../permissions";
import { useAuth } from "../contexts/AuthContext";
import { ChangePasswordDialog } from "../features/auth/ChangePasswordDialog";
import { useAttendanceSummary } from "../features/attendance/useAttendanceSummary";
import { useIsDesktop } from "../utils/useIsDesktop";
import { AccountMenu } from "./AccountMenu";
import { Breadcrumbs } from "./Breadcrumbs";
import { navItemsForRole } from "./navItems";
import { QuickSearch } from "./QuickSearch";
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
  const { pathname } = useLocation();
  // Each screen names the browser tab, so tabs and history are told apart.
  useEffect(() => {
    const here = tabs.find((item) => item.path && (pathname === item.path || pathname.startsWith(`${item.path}/`)));
    document.title = here ? `${here.label} · ${SHORT_NAME}` : `${SHORT_NAME} HR & Payroll`;
  }, [pathname, tabs]);
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
        <div className="min-w-0 shrink-0 lg:w-72 xl:w-80">
          <h1 className="truncate text-sm font-semibold leading-tight text-ink-900 lg:text-base">
            {companySettings?.companyName ?? COMPANY_NAME}
          </h1>
          <p className="hidden truncate text-xs text-ink-500 sm:block">
            {companySettings?.tagline ?? "Official HR & Payroll System"}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 justify-center px-2">
          <QuickSearch items={tabs} />
        </div>
        {user && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              to="/attendance"
              aria-label={attendanceAttention > 0 ? `Attendance alerts: ${attendanceAttention} need attention` : "Attendance alerts: none"}
              title="Attendance alerts"
              className={`${headerButtonClass} relative`}
            >
              <Bell aria-hidden="true" size={18} />
              {attendanceAttention > 0 && (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[0.625rem] font-bold text-ink-900">
                  {attendanceAttention}
                </span>
              )}
            </Link>
            <p className="sr-only">{`Logged in as ${user.username} (${user.role})`}</p>
            <AccountMenu user={user} onChangePassword={() => setChangePasswordOpen(true)} onSignOut={handleSignOut} />
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar items={tabs} collapsed={sidebarCollapsed} attendanceAttention={attendanceAttention} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[90rem] px-6 py-8 outline-none lg:px-8">
            <Breadcrumbs items={tabs} />
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
