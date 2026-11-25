const MONEY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12,345.50: AED with two decimals. The currency is written next to it, never inside it. */
export function formatMoney(amount: number): string {
  return MONEY.format(amount);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Aug 2026" from "2026-08-05". Read as text so no time zone can move the day. */
export function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Today on UAE time as yyyy-MM-dd, matching what the server treats as "today". */
export function todayInUae(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Adds server-confirmed amounts without floating-point drift (0.1 + 0.2): works in whole fils. */
export function sumMoney(values: number[]): number {
  return values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
}

/** The part's share of the whole, as a whole percentage; 0 when there is nothing to share. */
export function sharePercent(part: number, whole: number): number {
  return whole > 0 && part > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Parses what a person typed into a money field: digits with an optional decimal part. Null when it is not a number. */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** "40.00%": a share with its two decimals, exactly as the server worked it out. */
export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

/** 111.8k, 2.4M: a short form for chart axes, where exact figures sit in the labels and tables. */
export function formatCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(amount));
}

/** How the current figure compares with the one before, in words: "up 12.5%", "down 8.0%" or "no change"; null when there is nothing to compare with. */
export function changeWords(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const percent = ((current - previous) / previous) * 100;
  if (Math.abs(percent) < 0.05) return "no change";
  return `${percent > 0 ? "up" : "down"} ${Math.abs(percent).toFixed(1)}%`;
}
