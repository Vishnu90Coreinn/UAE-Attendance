import { useRef, useState, type FormEvent } from "react";
import { Loader2, Save } from "lucide-react";
import { createFinPartner, updateFinPartner, type FinPartner } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button } from "../../ui";
import { parseMoneyInput } from "./financeFormat";

interface PartnerDialogProps {
  /** Null adds a partner; a partner edits that partner. */
  partner: FinPartner | null;
  variant: "center" | "sheet";
  onClose: () => void;
  onSaved: (partner: FinPartner, message: string) => void;
}

/** A partner's name and the capital they had put in before this app was used. */
export function PartnerDialog({ partner, variant, onClose, onSaved }: PartnerDialogProps) {
  const [name, setName] = useState(partner?.name ?? "");
  const [opening, setOpening] = useState(partner ? String(partner.openingCapital) : "0");
  const [active, setActive] = useState(partner?.isActive ?? true);
  const [errors, setErrors] = useState<{ name?: string; openingCapital?: string }>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseMoneyInput(opening);
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Enter the partner's name.";
    if (value === null || value < 0) next.openingCapital = "Enter 0 or more, with at most 2 decimals.";
    setErrors(next);
    setGeneral(null);
    if (Object.keys(next).length > 0 || value === null) return;

    setPending(true);
    try {
      const input = { name: name.trim(), openingCapital: value, isActive: active };
      const saved = partner ? await updateFinPartner(partner.id, input) : await createFinPartner(input);
      onSaved(saved, partner ? `${saved.name} was updated.` : `${saved.name} was added as a partner.`);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        setErrors({ name: error.fieldErrors.name?.join(" "), openingCapital: error.fieldErrors.openingCapital?.join(" ") });
        const rest = Object.entries(error.fieldErrors).filter(([key]) => key !== "name" && key !== "openingCapital").flatMap(([, messages]) => messages);
        setGeneral(rest.length ? rest.join(" ") : null);
      } else {
        setGeneral(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open title={partner ? "Edit partner" : "Add partner"} onClose={pending ? () => {} : onClose} initialFocusRef={nameRef} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <TextField label="Partner name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} inputRef={nameRef} maxLength={120} autoComplete="off" />
        <TextField
          label="Opening capital (AED)"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          error={errors.openingCapital}
          inputMode="decimal"
          autoComplete="off"
          hint="Capital this partner put in before this app was used. It is already inside the account opening balances, so it does not change them. Later capital is added with Add capital."
        />
        {partner && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink-900">
            <input type="checkbox" className="size-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Offer this partner for new capital entries
          </label>
        )}
        {general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Save aria-hidden="true" size={16} />}
            {partner ? "Save partner" : "Add partner"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
