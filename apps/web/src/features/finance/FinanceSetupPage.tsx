import { Link } from "react-router-dom";
import { PageHeader } from "../../ui";
import { FinanceCategoriesCard } from "./FinanceCategoriesCard";
import { FinanceMonthLocksCard } from "./FinanceMonthLocksCard";
import { StaffEntryCard } from "./StaffEntryCard";

/**
 * Where the accountant sets the finance side up: the categories (and the VAT each one carries), the month lock, and who may enter expenses.
 * These used to sit at the bottom of the HR Settings page, eight screens below the payroll rates.
 */
export function FinanceSetupPage() {
  return (
    <section className="space-y-6">
      <PageHeader title="Finance setup" description="The lists the finance screens use, which months are closed to changes, and which staff may enter expenses. The books' accounts are under Books > Setup." />
      <nav aria-label="On this page" className="flex flex-wrap gap-2 text-sm">
        {[["categories", "Categories and VAT"], ["month-lock", "Month lock"], ["staff-entry", "Staff who enter expenses"]].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-9 items-center rounded-full border border-line bg-white px-3 font-medium text-ink-800 hover:bg-ink-50">{label}</a>
        ))}
        <Link to="/finance/books" className="inline-flex min-h-9 items-center rounded-full border border-line bg-white px-3 font-medium text-brand-700 hover:bg-brand-50">Chart of accounts and mapping</Link>
      </nav>
      <div id="categories" className="max-w-4xl scroll-mt-20"><FinanceCategoriesCard /></div>
      <div id="month-lock" className="max-w-4xl scroll-mt-20"><FinanceMonthLocksCard /></div>
      <div id="staff-entry" className="max-w-4xl scroll-mt-20"><StaffEntryCard /></div>
    </section>
  );
}
