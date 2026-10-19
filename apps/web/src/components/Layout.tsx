import { Outlet } from "react-router-dom";
import { HealthChip } from "./HealthChip";
import { NAV_ITEMS } from "./navItems";

export function Layout() {
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
          <div>
            <h1 className="text-lg font-bold leading-tight">DE AKS BE GLASS &amp; ALUMINIUM CO. L.L.C S.O.C</h1>
            <p className="text-xs text-blue-300">Official HR &amp; Payroll System</p>
          </div>
          <HealthChip />
        </div>
      </header>

      <nav aria-label="Main" className="border-b border-slate-700 bg-slate-800 text-white shadow-sm">
        <div className="mx-auto flex w-full max-w-7xl overflow-x-auto px-4">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled
              className="min-h-11 whitespace-nowrap border-b-2 border-transparent px-5 text-sm font-medium text-gray-400 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-300 disabled:cursor-not-allowed"
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-grow px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
