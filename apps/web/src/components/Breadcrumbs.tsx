import { ChevronRight, House } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { NAV_GROUPS } from "./navIcons";
import type { NavItem } from "./navItems";

/** "Home > Group > Screen" above the page, derived from the nav configuration. Hidden on the dashboard and unknown routes. */
export function Breadcrumbs({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation();
  const current = items.find((item) => item.path && (pathname === item.path || pathname.startsWith(`${item.path}/`)));
  if (!current || current.key === "dashboard") return null;
  const group = NAV_GROUPS.find((g) => g.keys.includes(current.key));
  const dashboard = items.find((item) => item.key === "dashboard");

  return (
    <nav aria-label="Breadcrumb" className="mb-4 hidden text-xs text-ink-500 md:block">
      <ol className="flex items-center gap-1.5">
        {dashboard?.path && (
          <li className="flex items-center gap-1.5">
            <Link to={dashboard.path} className="inline-flex items-center gap-1 hover:text-brand-700">
              <House aria-hidden="true" size={13} />
              Home
            </Link>
            <ChevronRight aria-hidden="true" size={12} />
          </li>
        )}
        {group && group.label !== current.label && (
          <li className="flex items-center gap-1.5">
            <span>{group.label}</span>
            <ChevronRight aria-hidden="true" size={12} />
          </li>
        )}
        <li aria-current="page" className="font-medium text-ink-800">
          {current.label}
        </li>
      </ol>
    </nav>
  );
}
