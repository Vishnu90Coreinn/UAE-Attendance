import { useState, type ReactNode } from "react";
import {
  Banknote,
  CalendarDays,
  CircleUserRound,
  ClipboardCheck,
  Ellipsis,
  KeyRound,
  LogOut,
  ReceiptText,
  Settings,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import type { CurrentUser } from "../api/auth";
import { Dialog } from "./Dialog";
import { phoneNavFor, type NavItem } from "./navItems";

const ICONS: Record<string, LucideIcon> = {
  attendance: ClipboardCheck,
  workers: UsersRound,
  payroll: Banknote,
  leave: CalendarDays,
  deductions: ReceiptText,
  users: UserCog,
  settings: Settings,
};

/** One slot of the bottom bar: icon over a short label, at least 64px tall so it is easy to hit with a thumb. */
const slotClass =
  "relative flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-medium before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-300";
const slotState = (active: boolean) =>
  active ? "text-blue-400 before:bg-blue-400" : "text-slate-300 before:bg-transparent hover:text-white";

const sheetRowClass =
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

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
  const { pathname } = useLocation();
  const { tabs, more } = user ? phoneNavFor(user.role) : { tabs: [], more: [] };
  const moreActive = more.some((item) => item.path && pathname.startsWith(item.path));

  function tabContent(item: NavItem) {
    const Icon = ICONS[item.key] ?? Ellipsis;
    const badge = item.key === "attendance" && attendanceAttention > 0;
    return (
      <>
        <span className="relative">
          <Icon aria-hidden="true" size={22} />
          {badge && (
            <span
              aria-hidden="true"
              className="absolute -right-3 -top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-xs font-bold text-slate-900"
            >
              {attendanceAttention}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="max-w-full truncate">
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
    <div className="flex min-h-dvh flex-col bg-gray-100 text-gray-800">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-slate-900 focus:shadow"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 bg-slate-900 pt-[env(safe-area-inset-top)] text-white shadow-md">
        <div className="flex min-h-14 items-center gap-3 px-4 py-2">
          <img src="/icons/favicon-48.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-md bg-white p-0.5" />
          <h1 className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-bold leading-tight">{companyName}</h1>
          {user && (
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              aria-label="Account menu"
              aria-haspopup="dialog"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
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
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-700 bg-slate-900 pb-[env(safe-area-inset-bottom)] text-white"
      >
        <div className="flex">
          {tabs.map((item) => (
            <NavLink
              key={item.key}
              to={item.path!}
              className={({ isActive }) => `${slotClass} ${slotState(isActive)}`}
            >
              {tabContent(item)}
            </NavLink>
          ))}
          {more.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-current={moreActive ? "page" : undefined}
              className={`${slotClass} ${slotState(moreActive)}`}
            >
              <Ellipsis aria-hidden="true" size={22} />
              <span>More</span>
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
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `${sheetRowClass} ${isActive ? "bg-blue-50 text-blue-800" : "text-gray-800 hover:bg-gray-100"}`
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
            <p className="break-words text-sm text-gray-700">{`Logged in as ${user.username} (${user.role})`}</p>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  setAccountOpen(false);
                  onChangePassword();
                }}
                className={`${sheetRowClass} text-gray-800 hover:bg-gray-100`}
              >
                <KeyRound aria-hidden="true" size={20} />
                Change password
              </button>
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
