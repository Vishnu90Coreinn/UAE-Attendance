import { useRef, useState, type ChangeEvent } from "react";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { getFinImportTemplate, runFinImport, type FinEntryKind, type FinImportResult } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { Button, StatusBadge } from "../../ui";
import { saveBlob } from "../payroll/downloadPdf";
import { formatDay, formatMoney } from "./financeFormat";

const SHOWN = 200;

interface ImportDialogProps {
  kind: FinEntryKind;
  variant: "center" | "sheet";
  onClose: () => void;
  onImported: (count: number) => void;
}

/** Choose an Excel file, see every row checked, then import the good rows at once. Nothing is saved until the last button. */
export function ImportDialog({ kind, variant, onClose, onImported }: ImportDialogProps) {
  const income = kind === "Income";
  const noun = income ? "income" : "expense";
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<FinImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"check" | "import" | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    setFile(picked);
    setResult(null);
    setError(null);
    setPending("check");
    try {
      setResult(await runFinImport(kind, picked, false));
    } catch (failure) {
      setError(failure instanceof ApiError ? (failure.fieldErrors?.file?.join(" ") ?? failure.message) : "The file could not be checked.");
    } finally {
      setPending(null);
    }
  }

  async function confirm() {
    if (!file) return;
    setPending("import");
    setError(null);
    try {
      const done = await runFinImport(kind, file, true);
      onImported(done.imported);
    } catch (failure) {
      setError(failure instanceof ApiError ? (failure.fieldErrors?.file?.join(" ") ?? failure.message) : "The import failed. Nothing was saved.");
      setPending(null);
    }
  }

  async function template() {
    try {
      saveBlob(await getFinImportTemplate(kind), `${income ? "Income" : "Expenses"}_import_template.xlsx`);
    } catch {
      setError("The template could not be downloaded.");
    }
  }

  const canImport = result !== null && result.errors === 0 && result.ready > 0 && pending === null;
  return (
    <Dialog open title={`Import ${noun}s from Excel`} onClose={pending ? () => {} : onClose} variant={variant} size="wide">
      <div className="mt-3 space-y-4">
        <p className="text-sm text-ink-700">
          One row per {noun}. The first row must have the headings <span className="font-medium">Date, {income ? "Received from" : "Paid to"}, Category, Account, Amount</span>, and may have Reference and Notes. Categories and accounts must already exist with the same names. Imported rows have no receipt.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Download} onClick={() => void template()}>Download the template</Button>
          <Button variant="secondary" icon={Upload} disabled={pending !== null} onClick={() => picker.current?.click()}>{file ? "Choose another file" : "Choose the Excel file"}</Button>
          <input ref={picker} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Excel file" onChange={(e) => void choose(e)} />
        </div>
        {file && <p className="flex items-center gap-2 text-sm text-ink-700"><FileSpreadsheet aria-hidden="true" size={16} /> {file.name}</p>}
        {pending === "check" && <p className="flex items-center gap-2 text-sm text-ink-600"><Loader2 aria-hidden="true" size={16} className="animate-spin" /> Checking every row...</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {result && (
          <>
            <p aria-live="polite" className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-800">
              <span className="font-semibold tabular-nums">{result.ready}</span> ready to import (AED <span className="tabular-nums">{formatMoney(result.readyTotal)}</span>)
              {result.duplicates > 0 && <> · <span className="font-semibold tabular-nums">{result.duplicates}</span> already recorded, skipped</>}
              {result.errors > 0 && <> · <span className="font-semibold tabular-nums text-danger">{result.errors}</span> with a problem</>}
            </p>
            {result.errors > 0 && <p className="text-sm text-danger">Fix the rows marked Problem in your file and choose it again. Nothing is imported until every row is right.</p>}
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label="Rows in the file">
              {result.rows.slice(0, SHOWN).map((r) => (
                <li key={r.row} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                  <span className="w-8 text-xs tabular-nums text-ink-500">{r.row}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-900">{r.party ?? "(no name)"}</span>
                    <span className="block text-[13px] text-ink-500">{[r.date ? formatDay(r.date) : null, r.category, r.account].filter(Boolean).join(" · ")}</span>
                    {r.problems.map((p) => <span key={p} className={r.status === "Error" ? "block text-xs text-danger" : "block text-[13px] text-ink-600"}>{p}</span>)}
                  </span>
                  <span className="text-right">
                    <span className="block tabular-nums text-ink-900">{r.amount !== null ? formatMoney(r.amount) : ""}</span>
                    <StatusBadge tone={r.status === "Ready" ? "success" : r.status === "Duplicate" ? "neutral" : "danger"} variant="soft">{r.status === "Error" ? "Problem" : r.status === "Duplicate" ? "Skipped" : "Ready"}</StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
            {result.rows.length > SHOWN && <p className="text-[13px] text-ink-600">Showing the first {SHOWN} of {result.rows.length} rows. All are checked.</p>}
          </>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending === "import"}>Cancel</Button>
          <Button disabled={!canImport} onClick={() => void confirm()}>
            {pending === "import" && <Loader2 aria-hidden="true" size={16} className="animate-spin" />}
            {result && result.ready > 0 ? `Import ${result.ready} ${noun}${result.ready === 1 ? "" : "s"}` : "Import"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
