import { expect, it } from "vitest";
import vectors from "../../../../../docs/finance-test-vectors.json";
import { vatOf } from "./financeFormat";

// The same vectors the server's tests read: the browser's preview of the VAT can never differ from what is saved.
it.each(vectors.vat)("works out VAT like the server: $name", (v) => {
  const result = vatOf(v.typed, v.treatment, v.rate, v.inclusive);
  expect(result.cash).toBeCloseTo(v.cash, 2);
  expect(result.net).toBeCloseTo(v.net, 2);
  expect(result.tax).toBeCloseTo(v.tax, 2);
});
