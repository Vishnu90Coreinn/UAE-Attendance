import { useCallback, useState } from "react";
import { ApiError } from "../../api/client";
import { getLetterPdf } from "../../api/letters";
import { saveBlob } from "../payroll/downloadPdf";

export type Errors = Record<string, string>;

export function dubaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.fieldErrors ? Object.values(error.fieldErrors).flat().join(" ") : error.message;
  return "Something went wrong. Please try again.";
}

export function fieldErrorsOf(error: unknown): Errors {
  const result: Errors = {};
  if (error instanceof ApiError && error.fieldErrors) {
    for (const [key, messages] of Object.entries(error.fieldErrors)) result[key] = messages.join(" ");
  }
  return result;
}

export function fileNameFor(refNo: string): string {
  return `${refNo.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
}

/** Download of an issued letter's PDF, used on the log, on an opened letter and on an approved request. */
export function usePdfDownload() {
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = useCallback(async (id: number, refNo: string) => {
    setPending(id);
    setError(null);
    try {
      saveBlob(await getLetterPdf(id), fileNameFor(refNo));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(null);
    }
  }, []);
  return { pending, error, download };
}
