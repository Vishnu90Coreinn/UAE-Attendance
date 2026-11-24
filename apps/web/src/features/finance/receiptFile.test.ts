import { describe, expect, it } from "vitest";
import { formatBytes, receiptProblem, shrinkPhoto } from "./receiptFile";

const file = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type });

describe("receiptFile", () => {
  it("accepts a PDF, JPEG or PNG within 5 MB", () => {
    expect(receiptProblem(file("a.pdf", "application/pdf"))).toBeNull();
    expect(receiptProblem(file("a.jpg", "image/jpeg"))).toBeNull();
    expect(receiptProblem(file("a.png", "image/png"))).toBeNull();
  });

  it("refuses other types, empty files and files over 5 MB, naming the file", () => {
    expect(receiptProblem(file("notes.txt", "text/plain"))).toMatch(/notes\.txt.*PDF, JPEG or PNG/);
    expect(receiptProblem(file("e.pdf", "application/pdf", 0))).toMatch(/empty/);
    expect(receiptProblem(file("big.pdf", "application/pdf", 5 * 1024 * 1024 + 1))).toMatch(/5 MB/);
  });

  it("leaves a small photo, and a PDF, untouched", async () => {
    const small = file("s.jpg", "image/jpeg", 500);
    const pdf = file("p.pdf", "application/pdf", 3 * 1024 * 1024);
    expect(await shrinkPhoto(small)).toBe(small);
    expect(await shrinkPhoto(pdf)).toBe(pdf);
  });

  it("returns the original when the browser cannot shrink it", async () => {
    const big = file("b.jpg", "image/jpeg", 3 * 1024 * 1024);
    expect(await shrinkPhoto(big)).toBe(big); // jsdom has no createImageBitmap
  });

  it("writes sizes people can read", () => {
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });
});
