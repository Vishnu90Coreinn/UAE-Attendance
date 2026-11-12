import { useEffect, useState } from "react";
import { getLetterImage, type LetterDocument, type LetterRun } from "../../api/letters";

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Shows only the letter when the browser prints, whatever else is on the page. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .letter-print, .letter-print * { visibility: visible !important; }
  .letter-print { position: absolute !important; left: 0; top: 0; width: 100% !important; }
  .letter-sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; width: 100% !important; padding: 0 !important; min-height: 262mm !important; break-inside: avoid; }
  .letter-scroll { overflow: visible !important; }
}`;

/** An uploaded image fetched with the sign-in token and shown through an object URL. Nothing is shown until it loads. */
function useImage(kind: "logo" | "seal" | "signature", available: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!available) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    getLetterImage(kind)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, available]);
  return url;
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Runs({ runs }: { runs: LetterRun[] }) {
  return (
    <>
      {runs.map((run, index) =>
        run.bold ? (
          <strong key={index}>{run.text}</strong>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

/** Width of the letterhead's name line in px (an A4 sheet less its side margins), and the average capital width in em. */
const NAME_LINE_PX = 660;
const CAP_EM = 0.64;

/** Font size that keeps the whole company name on one line across the sheet, between 9 and 15 px. */
function nameSize(name: string): number {
  return Math.max(9, Math.min(15, Math.floor(NAME_LINE_PX / (Math.max(name.length, 1) * CAP_EM))));
}

/** A4 certificate or letter exactly as the server built it (preview) or stored it (issued). */
export function LetterSheet({ document: doc }: { document: LetterDocument }) {
  const c = doc.content;
  const logo = useImage("logo", doc.hasLogo);
  const signature = useImage("signature", doc.hasSignature && c.showSeal);
  const address = [c.address1, c.address2].filter(Boolean).join(", ");
  const contact = [c.mobile && `Mobile: ${c.mobile}`, c.email && `Email: ${c.email}`].filter(Boolean).join("  |  ");

  return (
    <div className="letter-print">
      <style>{PRINT_CSS}</style>
      <div className="letter-scroll max-w-full overflow-x-auto rounded-lg bg-ink-100 p-3 sm:p-6">
        <article
          aria-label={`${c.title} preview`}
          className="letter-sheet relative mx-auto flex min-h-[297mm] w-[210mm] flex-col justify-between border border-line bg-white px-[16mm] py-[14mm] text-ink-900 shadow-card"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[30deg] select-none whitespace-nowrap text-6xl font-extrabold uppercase text-ink-900/[0.04]"
          >
            {c.companyName.split(" ").slice(0, 5).join(" ")}
          </div>

          <div className="relative">
            <header className="border-b-2 border-ink-900 pb-3">
              <div className="flex min-h-[18mm] items-center justify-between gap-4">
                <div className="flex h-[18mm] items-center">
                  {logo && <img src={logo} alt="Company logo" className="max-h-[18mm] max-w-[40mm] object-contain" />}
                </div>
                <div className="min-w-0 text-right">
                  {address && <p className="text-xs text-ink-600">{address}</p>}
                  {contact && <p className="text-xs text-ink-600">{contact}</p>}
                </div>
              </div>
              <h2
                className="mt-2 whitespace-nowrap font-bold uppercase leading-tight text-brand-800"
                style={{ fontSize: `${nameSize(c.companyName)}px` }}
              >
                {c.companyName}
              </h2>
            </header>

            <div className="mt-4 flex justify-between border-b border-line pb-2 text-xs">
              <strong>
                Ref No: <span>{c.refNo || "Assigned when issued"}</span>
              </strong>
              <strong>
                Date: <span>{formatDate(c.issueDate)}</span>
              </strong>
            </div>

            <div className="mt-6">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-500">To:</p>
              <p className="mt-1 text-sm font-bold">{c.addressedTo}</p>
            </div>

            <h3 className="mx-auto mt-6 w-fit border-b-2 border-amber-500 pb-1 text-center text-xl font-bold uppercase tracking-wide">
              {c.title}
            </h3>

            <div className="mt-6 space-y-4 text-sm leading-relaxed">
              {c.paragraphs.map((runs, index) => (
                <p key={index}>
                  <Runs runs={runs} />
                </p>
              ))}
            </div>

            {c.salary && (
              <table className="mt-5 w-full border-collapse border border-line text-xs">
                <thead>
                  <tr className="bg-ink-50 text-left uppercase tracking-wide">
                    <th scope="col" className="border border-line p-2">
                      Salary component
                    </th>
                    <th scope="col" className="border border-line p-2 text-right">
                      Amount (AED)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Basic Monthly Salary", c.salary.basic],
                      ["Housing Allowance", c.salary.housing],
                      ["Transportation Allowance", c.salary.transport],
                      ["Other Fixed Allowances", c.salary.other],
                    ] as const
                  ).map(([label, amount]) => (
                    <tr key={label}>
                      <td className="border border-line p-2 font-medium">{label}</td>
                      <td className="border border-line p-2 text-right tabular-nums">{formatMoney(amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-50 font-bold">
                    <td className="border border-line p-2">TOTAL GROSS MONTHLY SALARY</td>
                    <td className="border border-line p-2 text-right text-sm tabular-nums">{formatMoney(c.salary.total)} AED</td>
                  </tr>
                </tfoot>
              </table>
            )}

            <p className="mt-6 rounded-r border-l-2 border-ink-400 bg-ink-50 p-3 text-xs italic text-ink-600">{c.purposeNote}</p>
          </div>

          <footer className="relative mt-8 border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase">For {c.companyName}</p>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="flex h-14 items-end">
                  {signature && <img src={signature} alt="Authorized signature" className="max-h-14 max-w-[45mm] object-contain" />}
                </div>
                <div className="w-48 border-t border-ink-900 pt-1">
                  <p className="text-xs font-bold">{c.signerName}</p>
                  <p className="text-xs text-ink-600">{c.signerTitle}</p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center text-[9px] uppercase tracking-widest text-ink-400">
              Official company document - {c.companyName}
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
