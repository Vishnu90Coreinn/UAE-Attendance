/** Calendar-quarter shortcuts and the company's separately confirmed assigned VAT period. */

export interface VatQuarter {
  from: string;
  to: string;
  /** "Q4 2026". */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The quarter holding a date (yyyy-MM-dd), or one `offset` quarters away from it. */
export function vatQuarter(date: string, offset = 0): VatQuarter {
  const [year, month] = date.split("-").map(Number);
  const index = year * 4 + Math.floor((month - 1) / 3) + offset;
  const y = Math.floor(index / 4);
  const q = index - y * 4;
  const lastDay = new Date(Date.UTC(y, q * 3 + 3, 0)).getUTCDate();
  return { from: `${y}-${pad(q * 3 + 1)}-01`, to: `${y}-${pad(q * 3 + 3)}-${pad(lastDay)}`, label: `Q${q + 1} ${y}` };
}

export function vatDueDate(quarterEnd: string): string {
  const due = new Date(`${quarterEnd}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 28);
  return due.toISOString().slice(0, 10);
}

export function assignedVatPeriod(date: string, months: number, startMonth: number, offset = 0): VatQuarter {
  const day = new Date(`${date}T00:00:00Z`);
  const start = new Date(Date.UTC(day.getUTCFullYear(), startMonth - 1, 1));
  while (start > day) start.setUTCMonth(start.getUTCMonth() - months);
  while (new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1)) <= day) start.setUTCMonth(start.getUTCMonth() + months);
  start.setUTCMonth(start.getUTCMonth() + offset * months);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 0));
  const from = start.toISOString().slice(0, 10), to = end.toISOString().slice(0, 10);
  return { from, to, label: `${from} to ${to}` };
}
