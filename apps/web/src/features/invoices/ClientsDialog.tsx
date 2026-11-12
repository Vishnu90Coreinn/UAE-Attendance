import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { createInvoiceClient, listInvoiceClients, updateInvoiceClient, type InvoiceClient } from "../../api/invoices";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button } from "../../ui";
import { errorMessage, fieldErrors } from "./invoiceUi";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after any change so the page can refresh its client filter. */
  onChanged: () => void;
  canWrite: boolean;
}

interface Draft {
  id: number | null;
  name: string;
  trn: string;
  address: string;
  isActive: boolean;
}

const EMPTY: Draft = { id: null, name: "", trn: "", address: "", isActive: true };

/** The client list: choose one to edit, or add a new client. */
export function ClientsDialog({ open, onClose, onChanged, canWrite }: Props) {
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function reload() {
    try {
      setClients(await listInvoiceClients(true));
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  useEffect(() => {
    if (open) {
      setDraft(EMPTY);
      setErrors({});
      setFailure(null);
      void reload();
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.name.trim() === "") return setErrors({ name: "Enter the client's name." });
    setPending(true);
    setFailure(null);
    try {
      if (draft.id === null) await createInvoiceClient({ name: draft.name, trn: draft.trn, address: draft.address });
      else await updateInvoiceClient(draft.id, { name: draft.name, trn: draft.trn, address: draft.address, isActive: draft.isActive });
      setDraft(EMPTY);
      setErrors({});
      await reload();
      onChanged();
    } catch (error) {
      const server = fieldErrors(error);
      setErrors(server);
      if (Object.keys(server).length === 0) setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Clients" size="wide">
      <div className="mt-3 space-y-4">
        {failure && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{failure}</p>}
        <ul aria-label="Saved clients" className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {clients.length === 0 && <li className="px-3 py-3 text-sm text-ink-600">No clients yet.</li>}
          {clients.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 break-words">
                <span className="font-medium">{c.name}</span>
                {!c.isActive && <span className="ml-2 text-ink-500">(inactive)</span>}
              </span>
              {canWrite && (
                <Button variant="ghost" size="sm" aria-label={`Edit ${c.name}`} onClick={() => { setDraft({ id: c.id, name: c.name, trn: c.trn, address: c.address, isActive: c.isActive }); setErrors({}); }}>
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canWrite && (
          <form onSubmit={submit} noValidate className="space-y-3" aria-label={draft.id === null ? "Add client" : "Edit client"}>
            <h3 className="text-sm font-semibold text-ink-900">{draft.id === null ? "Add a client" : "Edit client"}</h3>
            <TextField label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} error={errors.name} maxLength={120} />
            <TextField label="TRN" value={draft.trn} onChange={(e) => setDraft({ ...draft, trn: e.target.value })} error={errors.trn} maxLength={30} />
            <TextField label="Address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} error={errors.address} maxLength={250} />
            {draft.id !== null && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} className="size-4" />
                Active (can be chosen on new invoices)
              </label>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              {draft.id !== null && <Button variant="secondary" onClick={() => { setDraft(EMPTY); setErrors({}); }}>New client</Button>}
              <Button type="submit" icon={pending ? Loader2 : draft.id === null ? Plus : Save} disabled={pending}>
                {draft.id === null ? "Add client" : "Save client"}
              </Button>
            </div>
          </form>
        )}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Dialog>
  );
}
