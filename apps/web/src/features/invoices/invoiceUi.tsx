import { useEffect, useState } from "react";
import { ApiError, apiGetFile } from "../../api/client";
import { StatusBadge, type StatusTone } from "../../ui";
import type { InvoiceDisplayStatus } from "../../api/invoices";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}

/** Field name -> message from a failed request, or an empty map. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.fieldErrors) return {};
  return Object.fromEntries(Object.entries(error.fieldErrors).map(([key, messages]) => [key, messages[0]]));
}

export function todayInDubai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  Draft: "Draft",
  Issued: "Issued",
  PartPaid: "Part-paid",
  Paid: "Paid",
  Cancelled: "Cancelled",
};
const STATUS_TONE: Record<InvoiceDisplayStatus, StatusTone> = {
  Draft: "neutral",
  Issued: "info",
  PartPaid: "warning",
  Paid: "success",
  Cancelled: "danger",
};

export function InvoiceStatusBadges({ status, overdue }: { status: InvoiceDisplayStatus; overdue: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
      {overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
    </span>
  );
}

/** The company logo, fetched with the sign-in token (an <img> tag cannot send it). Null until loaded or when none is set. */
export function useLogoUrl(hasLogo: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasLogo) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      for (const type of ["image/png", "image/jpeg"]) {
        try {
          const blob = await apiGetFile("/api/documents/images/logo", type);
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          return;
        } catch {
          /* try the other type */
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasLogo]);
  return url;
}
