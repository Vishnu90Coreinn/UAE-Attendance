import { describe, expect, it } from "vitest";
import vectors from "../../../../../docs/invoice-test-vectors.json";
import { amountInWords, invoiceTotals, lineAmounts, round2 } from "./invoiceMath";

describe("invoice preview math", () => {
  it.each(vectors.lines)("line matches the shared server vector: $name", (v) => {
    expect(lineAmounts(v.quantity, v.rate)).toEqual({ taxable: v.taxable, vat: v.vat, amount: v.amount });
  });

  it.each(vectors.invoices)("totals match the shared server vector: $name", (v) => {
    const lines = v.lines.map(([quantity, rate]) => lineAmounts(quantity, rate));
    expect(invoiceTotals(lines)).toEqual({ subTotal: v.subTotal, vatTotal: v.vatTotal, total: v.total });
  });

  it.each(vectors.words)("words match the shared server vector: $amount", (v) => {
    expect(amountInWords(v.amount)).toBe(v.words);
  });

  it("charges no VAT on a zero rated or exempt invoice", () => {
    expect(lineAmounts(10, 100, "ZeroRated")).toEqual({ taxable: 1000, vat: 0, amount: 1000 });
    expect(lineAmounts(10, 100, "Exempt")).toEqual({ taxable: 1000, vat: 0, amount: 1000 });
  });

  it("rounds half away from zero", () => {
    expect(round2(0.005)).toBe(0.01);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-0.005)).toBe(-0.01);
  });
});
