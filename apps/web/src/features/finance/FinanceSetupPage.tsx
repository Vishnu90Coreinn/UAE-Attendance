import { Link } from "react-router-dom";
import { buttonClass, PageHeader, sectionLinkClass, sectionNavClass } from "../../ui";
import { FinanceCategoriesCard } from "./FinanceCategoriesCard";
import { FinanceMonthLocksCard } from "./FinanceMonthLocksCard";
import { StaffEntryCard } from "./StaffEntryCard";
import { FinanceTaxPeriodCard } from "./FinanceTaxPeriodCard";

/**
 * Where the accountant sets the finance side up: the categories (and the VAT each one carries), the month lock, and who may enter expenses.
 * These used to sit at the bottom of the HR Settings page, eight screens below the payroll rates.
 */
export function FinanceSetupPage() {
  return (
    <section className="space-y-6">
      <PageHeader title="Finance setup" description="The lists the finance screens use, which months are closed to changes, and which staff may enter expenses."
        actions={<Link to="/finance/books" className={buttonClass("secondary", "md")}>Chart of accounts and mapping</Link>} />
      <nav aria-label="On this page" className={sectionNavClass}>
        {[["categories", "Categories and VAT"], ["month-lock", "Month lock"], ["staff-entry", "Staff who enter expenses"]].map(([id, label]) => (
          <a key={id} href={`#${id}`} className={sectionLinkClass(false)}>{label}</a>
        ))}
      </nav>
      {/* The width of every other finance page; on a very wide screen the long category list sits beside the shorter cards. */}
      <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div id="categories" className="min-w-0 scroll-mt-20"><FinanceCategoriesCard /></div>
        <div className="min-w-0 space-y-6">
          <div id="tax-period" className="scroll-mt-20"><FinanceTaxPeriodCard /></div>
          <div id="month-lock" className="scroll-mt-20"><FinanceMonthLocksCard /></div>
          <div id="staff-entry" className="scroll-mt-20"><StaffEntryCard /></div>
        </div>
      </div>
    </section>
  );
}
