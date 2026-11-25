import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CalendarClock, CheckCircle2 } from "lucide-react";
import { getFinAttention, type FinAttention } from "../../api/finance";
import { Card, CardHeader, cx } from "../../ui";
import { formatDay, formatMoney } from "./financeFormat";

function Row({ to, urgent, children }: { to: string; urgent?: boolean; children: ReactNode }) {
  return (
    <li>
      <Link to={to} className="flex min-h-11 items-center gap-3 px-5 py-2.5 text-sm hover:bg-ink-50">
        {urgent ? <AlertCircle aria-hidden="true" size={16} className="shrink-0 text-danger" /> : <CalendarClock aria-hidden="true" size={16} className="shrink-0 text-ink-500" />}
        <span className="min-w-0 flex-1 text-ink-900">{children}</span>
        <span aria-hidden="true" className="text-ink-400">›</span>
      </Link>
    </li>
  );
}

const many = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

/** The morning question: what do I need to do? Overdue and soon-due bills, cheques and invoices, expenses to approve, a finished month still open, and the next VAT return. */
export function AttentionCard({ canLock }: { canLock: boolean }) {
  const [data, setData] = useState<FinAttention | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(getFinAttention())
      .then((d) => !cancelled && d && setData(d))
      .catch(() => {});   // a missing panel must never get in the way of the page
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;
  const rows: ReactNode[] = [];
  if (data.overdueBills.count > 0) rows.push(<Row key="ob" to="/finance/bills" urgent>{many(data.overdueBills.count, "supplier bill is", "supplier bills are")} overdue: <strong className="tabular-nums">AED {formatMoney(data.overdueBills.amount)}</strong> to pay</Row>);
  if (data.billsDueSoon.count > 0) rows.push(<Row key="bs" to="/finance/bills">{many(data.billsDueSoon.count, "bill", "bills")} due in the next 7 days: <span className="tabular-nums">AED {formatMoney(data.billsDueSoon.amount)}</span></Row>);
  if (data.overdueCheques.count > 0) rows.push(<Row key="oc" to="/finance/cheques" urgent>{many(data.overdueCheques.count, "cheque is", "cheques are")} past its date and not cleared: <span className="tabular-nums">AED {formatMoney(data.overdueCheques.amount)}</span></Row>);
  if (data.chequesDueSoon.count > 0) rows.push(<Row key="cs" to="/finance/cheques">{many(data.chequesDueSoon.count, "cheque", "cheques")} dated in the next 7 days: <span className="tabular-nums">AED {formatMoney(data.chequesDueSoon.amount)}</span></Row>);
  if (data.overdueInvoices.count > 0) rows.push(<Row key="oi" to="/invoices" urgent>{many(data.overdueInvoices.count, "tax invoice is", "tax invoices are")} overdue: <span className="tabular-nums">AED {formatMoney(data.overdueInvoices.amount)}</span> to collect</Row>);
  if (data.pendingApprovals > 0) rows.push(<Row key="pa" to="/finance/expenses">{many(data.pendingApprovals, "staff expense waits", "staff expenses wait")} for your approval</Row>);
  if (data.openMonth && canLock) rows.push(<Row key="om" to="/finance/setup#month-lock">{data.openMonth} is over but not locked yet</Row>);
  const quiet = rows.length === 0;
  return (
    <Card>
      <CardHeader title="Needs attention" description="What to act on today." />
      <ul className="divide-y divide-line border-t border-line">
        {quiet && (
          <li className="flex items-center gap-3 px-5 py-3 text-sm text-ink-700"><CheckCircle2 aria-hidden="true" size={16} className="shrink-0 text-brand-600" /> Nothing is overdue and nothing waits for you.</li>
        )}
        {rows}
        <Row to="/finance/vat">
          <span className={cx(data.vatDaysLeft <= 14 && "font-medium")}>VAT return for {data.vatPeriod}: due {formatDay(data.vatDue)}</span> ({data.vatDaysLeft === 0 ? "today" : many(data.vatDaysLeft, "day", "days")} left)
        </Row>
      </ul>
    </Card>
  );
}
