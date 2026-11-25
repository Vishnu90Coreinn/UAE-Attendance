import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { getFinReceipt, type FinAttachment } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { Button, cx } from "../../ui";
import { formatBytes } from "./receiptFile";

/** Shows a receipt (an image, or a PDF in a frame). Several receipts get a tab each. */
export function ReceiptDialog({ title, files, variant, onClose, mine = false, fetchFile, startIndex = 0 }: { title: string; files: FinAttachment[]; variant: "center" | "sheet"; onClose: () => void; mine?: boolean; fetchFile?: (id: number) => Promise<Blob>; startIndex?: number }) {
  const [index, setIndex] = useState(startIndex);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = files[index];

  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    setUrl(null);
    setError(null);
    (fetchFile ? fetchFile(file.id) : getFinReceipt(file.id, mine))
      .then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((failure) => !cancelled && setError(failure instanceof ApiError ? failure.message : "The receipt could not be opened."));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file.id]);

  return (
    <Dialog open title={title} onClose={onClose} variant={variant} size="wide">
      <div className="mt-3">
        {files.length > 1 && (
          <div role="tablist" aria-label="Receipts" className="mb-3 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                onClick={() => setIndex(i)}
                className={cx("min-h-11 rounded-full border px-3 text-sm font-medium md:min-h-9", i === index ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-ink-700 hover:border-brand-300")}
              >
                Receipt {i + 1}
              </button>
            ))}
          </div>
        )}
        <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-line bg-ink-50">
          {error && <p role="alert" className="px-4 py-10 text-sm text-danger">{error}</p>}
          {!error && !url && (
            <p role="status" className="flex items-center gap-2 py-10 text-sm text-ink-600">
              <Loader2 aria-hidden="true" size={16} className="animate-spin" /> Opening receipt...
            </p>
          )}
          {url && file.contentType === "application/pdf" && <iframe title={`Receipt ${index + 1}, ${file.fileName}`} src={url} className="h-[60dvh] w-full bg-white" />}
          {url && file.contentType !== "application/pdf" && <img src={url} alt={`Receipt ${index + 1}: ${file.fileName}`} className="max-h-[60dvh] w-auto max-w-full object-contain" />}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm text-ink-600">
            <FileText aria-hidden="true" size={16} className="shrink-0" />
            <span className="truncate">{file.fileName}</span>
            <span className="shrink-0 text-ink-500">· {formatBytes(file.sizeBytes)}</span>
          </p>
          <div className="flex gap-2">
            {url && (
              <a href={url} download={file.fileName} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50 md:min-h-9">
                <Download aria-hidden="true" size={16} /> Download
              </a>
            )}
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
