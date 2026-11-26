const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], month: MONTHS[m - 1] };
}

/** "Tue 24 Nov"; the year is added only when it is not the current one. */
export function leaveDay(iso: string, thisYear = new Date().getFullYear()): string {
  const p = parts(iso);
  return `${p.weekday} ${p.d} ${p.month}${p.y === thisYear ? "" : ` ${p.y}`}`;
}

/** One day, "Mon 14 – Tue 15 Dec" within a month, or both dates in full across months and years. */
export function leaveDates(start: string, end: string, thisYear = new Date().getFullYear()): string {
  if (start === end) return leaveDay(start, thisYear);
  const a = parts(start);
  const b = parts(end);
  const first = a.y === b.y && a.m === b.m ? `${a.weekday} ${a.d}` : a.y === b.y ? `${a.weekday} ${a.d} ${a.month}` : leaveDay(start, thisYear);
  return `${first} – ${leaveDay(end, thisYear)}`;
}
