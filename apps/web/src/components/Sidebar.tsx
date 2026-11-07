import { NavLink } from "react-router-dom";
import { cx } from "../ui";
import { NAV_GROUPS, NAV_ICONS } from "./navIcons";
import type { NavItem } from "./navItems";

interface SidebarProps {
  items: NavItem[];
  collapsed: boolean;
  /** Entries waiting on this person; shown as a count on Daily Attendance. */
  attendanceAttention: number;
}

/**
 * Grouped left navigation. Collapsed it shows icons only; the labels stay in the DOM (visually hidden)
 * so screen readers and tooltips keep the full names.
 */
export function Sidebar({ items, collapsed, attendanceAttention }: SidebarProps) {
  const groups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.keys.map((key) => items.find((item) => item.key === key)).filter((item): item is NavItem => !!item),
  })).filter((group) => group.items.length > 0);

  return (
    <nav
      aria-label="Main"
      className={cx(
        "shrink-0 overflow-y-auto bg-sidebar py-4 text-brand-100 transition-[width] duration-200",
        collapsed ? "w-[4.5rem] px-2" : "w-64 px-3",
      )}
    >
      {groups.map((group) => (
        <div key={group.label} className="mb-5 last:mb-0">
          <p
            className={cx(
              "mb-1.5 px-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-brand-300/70",
              collapsed && "sr-only",
            )}
          >
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.key];
              const badge = item.key === "attendance" && attendanceAttention > 0;
              return (
                <li key={item.key}>
                  {item.path ? (
                    <NavLink
                      to={item.path}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cx(
                          "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300",
                          collapsed && "justify-center px-0",
                          isActive
                            ? "bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-300"
                            : "text-brand-100/80 hover:bg-white/5 hover:text-white",
                        )
                      }
                    >
                      {Icon && <Icon aria-hidden="true" size={19} className="shrink-0" />}
                      <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                      {badge && (
                        <>
                          <span
                            aria-hidden="true"
                            className={cx(
                              "inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-xs font-bold text-ink-900",
                              collapsed ? "absolute right-1 top-1" : "ml-auto",
                            )}
                          >
                            {attendanceAttention}
                          </span>
                          <span className="sr-only"> ({attendanceAttention} need attention)</span>
                        </>
                      )}
                    </NavLink>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex min-h-11 w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 text-sm font-medium text-brand-100/40"
                    >
                      {Icon && <Icon aria-hidden="true" size={19} />}
                      <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
