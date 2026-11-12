/**
 * Browser preview of the invoice arithmetic. The server is authoritative; this mirrors InvoiceCalculator and AmountInWords
 * and is tested against the same vectors (docs/invoice-test-vectors.json).
 */
export const VAT_RATE = 0.05;

/** Rounds to 2 dp half away from zero, working in integer cents of the decimal text so 1.005-style floats do not drift. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const text = Math.abs(value).toFixed(8);
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2));
  const next = Number(fraction[2] ?? "0") >= 5 ? 1 : 0;
  return (sign * (cents + next)) / 100;
}

export interface LineAmounts {
  taxable: number;
  vat: number;
  amount: number;
}

export function lineAmounts(quantity: number, rate: number): LineAmounts {
  const taxable = round2(quantity * rate);
  const vat = round2(taxable * VAT_RATE);
  return { taxable, vat, amount: round2(taxable + vat) };
}

export function invoiceTotals(lines: readonly LineAmounts[]): { subTotal: number; vatTotal: number; total: number } {
  const subTotal = round2(lines.reduce((sum, l) => sum + l.taxable, 0));
  const vatTotal = round2(lines.reduce((sum, l) => sum + l.vat, 0));
  return { subTotal, vatTotal, total: round2(subTotal + vatTotal) };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES: [number, string][] = [
  [1_000_000_000, "Billion"],
  [1_000_000, "Million"],
  [1_000, "Thousand"],
];

function below1000(value: number): string {
  const parts: string[] = [];
  if (value >= 100) {
    parts.push(`${ONES[Math.floor(value / 100)]} Hundred`);
    value %= 100;
  }
  if (value >= 20) parts.push(TENS[Math.floor(value / 10)] + (value % 10 > 0 ? `-${ONES[value % 10]}` : ""));
  else if (value > 0) parts.push(ONES[value]);
  return parts.join(" ");
}

function numberWords(value: number): string {
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (value < size) continue;
    parts.push(`${below1000(Math.floor(value / size))} ${name}`);
    value %= size;
  }
  if (value > 0) parts.push(below1000(value));
  return parts.join(" ");
}

export function amountInWords(amount: number): string {
  const cents = Math.round(Math.abs(round2(amount)) * 100);
  const dirhams = Math.floor(cents / 100);
  const fils = cents % 100;
  const words = `UAE Dirham ${dirhams === 0 ? "Zero" : numberWords(dirhams)}`;
  return fils > 0 ? `${words} and ${numberWords(fils)} Fils` : words;
}

export function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
