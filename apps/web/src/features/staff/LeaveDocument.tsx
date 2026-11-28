import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileImage, Paperclip, X } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { getLeaveDocument } from "../../api/staff";
import { Button } from "../../ui";
import { preparePhoto } from "../leave/photo";
import { ActionFailure } from "../workers/WorkersFeedback";
import { errorText } from "./staffUi";

export interface PickedDocument {
  base64: string;
  previewUrl: string;
}

/** Choose or photograph a document (for example a medical certificate). It is shrunk to a JPEG before upload. */
export function DocumentPicker({
  value,
  onChange,
  required = false,
  label = "Document",
  hint,
}: {
  value: PickedDocument | null;
  onChange: (next: PickedDocument | null) => void;
  required?: boolean;
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (valueRef.current) URL.revokeObjectURL(valueRef.current.previewUrl);
    },
    [],
  );

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const next = await preparePhoto(file);
      if (value) URL.revokeObjectURL(value.previewUrl);
      onChange(next);
    } catch {
      setError("That image could not be read. Try another photo.");
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (value) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
  }

  return (
    <div>
      <p className="text-sm font-medium text-ink-800">
        {label}
        {required ? <span className="font-normal text-red-800"> (required)</span> : <span className="font-normal text-ink-600"> (optional)</span>}
      </p>
      {hint && <p className="text-sm text-ink-600">{hint}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {value ? (
          <>
            <img src={value.previewUrl} alt="Selected document" className="h-20 w-16 rounded-lg border border-line object-cover" />
            <Button variant="secondary" size="sm" icon={X} onClick={remove}>
              Remove
            </Button>
          </>
        ) : (
          <Button variant="secondary" icon={Paperclip} disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "Preparing..." : "Add a photo or image"}
          </Button>
        )}
        {/* "capture" lets a phone offer its camera as well as the gallery. */}
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={pick} />
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** A small button that opens the document attached to a leave request. */
export function DocumentButton({ id, own, title }: { id: number; own: boolean; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <FileImage aria-hidden="true" size={15} /> Document
      </button>
      {open && <DocumentView id={id} own={own} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The same preview as a panel beside the page, so the request stays in view while its paperwork is read. */
export function DocumentDrawer({ id, title, onClose }: { id: number; title: string; onClose: () => void }) {
  return <DocumentView id={id} own={false} title={title} onClose={onClose} drawer />;
}

function DocumentView({ id, own, title, onClose, drawer = false }: { id: number; own: boolean; title: string; onClose: () => void; drawer?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    getLeaveDocument(id, own)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id, own]);
  return (
    <Dialog open title="Leave document" onClose={onClose} size="wide" variant={drawer ? "drawer" : "center"}>
      <p className="mt-1 text-sm text-ink-600">{title}</p>
      <div className="mt-4">
        {error ? (
          <ActionFailure message={error} />
        ) : url ? (
          <img src={url} alt={`Document for ${title}`} className="mx-auto max-h-[70dvh] max-w-full rounded-lg border border-line object-contain" />
        ) : (
          <p role="status" className="py-8 text-center text-ink-600">Loading document...</p>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
