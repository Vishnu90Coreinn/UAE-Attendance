import { useState, type ReactNode } from "react";
import { Bell, BellOff, CircleUserRound, Ellipsis, KeyRound, LogOut } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import type { CurrentUser } from "../api/auth";
import { roleLabel } from "../permissions";
import { Dialog } from "./Dialog";
import { NAV_ICONS as ICONS } from "./navIcons";
import { activeNavItem, needsExactMatch, phoneNavFor, type NavItem } from "./navItems";
import { usePushToggle } from "../usePushToggle";

/**
 * One slot of the bottom bar: an icon with its label under it, at least 64px tall so it is easy to hit with a thumb. The
 * current screen is marked by a soft pill behind its icon and a bolder label, so it reads at a glance without colour alone.
 */
const slotClass =
  "relative flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500";
const pillClass = (active: boolean) =>
  `grid h-8 w-16 place-items-center rounded-full transition-colors duration-150 ${active ? "bg-brand-100 text-brand-800" : "text-ink-600"}`;
const labelClass = (active: boolean) => `max-w-full truncate ${active ? "font-bold text-ink-900" : "font-medium text-ink-600"}`;

const sheetRowClass =
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

interface PhoneShellProps {
  companyName: string;
  user: CurrentUser | null;
  /** Entries waiting on this person: waiting for approval for managers, sent back for supervisors. */
  attendanceAttention: number;
  onChangePassword: () => void;
  onSignOut: () => void;
  /** The routed page. */
  children: ReactNode;
}

/**
 * The phone arrangement of the app shell: a slim top bar, the page, and a bottom tab bar with the account actions
 * behind a menu. Below the desktop breakpoint only; the desktop header and tab row are untouched.
 */
export function PhoneShell({ companyName, user, attendanceAttention, onChangePassword, onSignOut, children }: PhoneShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const push = usePushToggle(user?.username);
  const { pathname } = useLocation();
  const { tabs, more } = user ? phoneNavFor(user.role, user.employeeId, user.canSubmitExpenses) : { tabs: [], more: [] };
  const moreActive = !!activeNavItem([...tabs, ...more], pathname) && more.some((item) => item.key === activeNavItem([...tabs, ...more], pathname)?.key);

  function tabContent(item: NavItem, active: boolean) {
    const Icon = ICONS[item.key] ?? Ellipsis;
    const badge = item.key === "attendance" && attendanceAttention > 0;
    return (
      <>
        <span className={`relative ${pillClass(active)}`}>
          <Icon aria-hidden="true" size={22} strokeWidth={active ? 2.5 : 2} />
          {badge && (
            <span
              aria-hidden="true"
              className="absolute right-0 top-0 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-xs font-bold text-ink-900 ring-2 ring-white"
            >
              {attendanceAttention}
            </span>
          )}
        </span>
        <span aria-hidden="true" className={labelClass(active)}>
          {item.shortLabel}
        </span>
        <span className="sr-only">
          {item.label}
          {badge && ` (${attendanceAttention} need attention)`}
        </span>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink-100 text-ink-800">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-ink-900 focus:shadow"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-white pt-[env(safe-area-inset-top)] text-ink-900">
        <div className="flex min-h-14 items-center gap-3 px-4 py-2">
          <img src="/icons/favicon-48.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-lg border border-line bg-white p-0.5" />
          <h1 className="min-w-0 flex-1 truncate text-sm font-bold leading-tight text-ink-900" title={companyName}>{companyName}</h1>
          {user && (
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              aria-label="Account menu"
              aria-haspopup="dialog"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-700 hover:bg-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              <CircleUserRound aria-hidden="true" size={26} />
            </button>
          )}
        </div>
      </header>

      <main id="main" tabIndex={-1} className="w-full flex-grow px-4 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(19_38_42/0.06)]"
      >
        <div className="flex">
          {tabs.map((item) => (
            <NavLink
              key={item.key}
              to={item.path!}
              end={needsExactMatch([...tabs, ...more], item)}
              className={slotClass}
            >
              {({ isActive }) => tabContent(item, isActive)}
            </NavLink>
          ))}
          {more.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-current={moreActive ? "page" : undefined}
              className={slotClass}
            >
              <span className={pillClass(moreActive)}>
                <Ellipsis aria-hidden="true" size={22} strokeWidth={moreActive ? 2.5 : 2} />
              </span>
              <span className={labelClass(moreActive)}>More</span>
            </button>
          )}
        </div>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More" variant="sheet">
        <ul className="mt-2 space-y-1">
          {more.map((item) => {
            const Icon = ICONS[item.key] ?? Ellipsis;
            return (
              <li key={item.key}>
                <NavLink
                  to={item.path!}
                  end={needsExactMatch([...tabs, ...more], item)}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `${sheetRowClass} ${isActive ? "bg-brand-50 text-brand-800" : "text-ink-800 hover:bg-ink-100"}`
                  }
                >
                  <Icon aria-hidden="true" size={20} />
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </Dialog>

      <Dialog open={accountOpen} onClose={() => setAccountOpen(false)} title="Account" variant="sheet">
        {user && (
          <div className="mt-2 space-y-3">
            <p className="break-words text-sm text-ink-700">{`Logged in as ${user.username} (${roleLabel(user.role)})`}</p>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  setAccountOpen(false);
                  onChangePassword();
                }}
                className={`${sheetRowClass} text-ink-800 hover:bg-ink-100`}
              >
                <KeyRound aria-hidden="true" size={20} />
                Change password
              </button>
              {push.visible && (
                <button
                  type="button"
                  disabled={push.busy || push.state === "blocked"}
                  onClick={() => void push.toggle()}
                  className={`${sheetRowClass} text-ink-800 hover:bg-ink-100 disabled:opacity-60`}
                >
                  {push.state === "on" ? <BellOff aria-hidden="true" size={20} /> : <Bell aria-hidden="true" size={20} />}
                  {push.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setAccountOpen(false);
                  onSignOut();
                }}
                className={`${sheetRowClass} text-red-800 hover:bg-red-50`}
              >
                <LogOut aria-hidden="true" size={20} />
                Sign out
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
