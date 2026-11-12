import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { createInvoice, listInvoiceClients, updateInvoice, type Invoice, type InvoiceClient, type InvoiceInput } from "../../api/invoices";
import { getDocumentSettings } from "../../api/documentSettings";
import { TextField } from "../../components/TextField";
import { Button, Card, IconButton, Input, Select, Textarea, Table, TableScroll, THead, Th, TRow, Td } from "../../ui";
import { errorMessage, fieldErrors, todayInDubai } from "./invoiceUi";
import { formatMoney, invoiceTotals, lineAmounts } from "./invoiceMath";

interface LineDraft {
  description: string;
  quantity: string;
  rate: string;
}

interface Props {
  /** The draft being edited; undefined starts a new invoice. */
  invoice?: Invoice;
  onSaved: (invoice: Invoice) => void;
  onCancel: () => void;
}

const MANUAL = "manual";

function validMoney(text: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(text.trim());
}

export function InvoiceEditor({ invoice, onSaved, onCancel }: Props) {
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [clientChoice, setClientChoice] = useState<string>(invoice?.clientId ? String(invoice.clientId) : MANUAL);
  const [clientName, setClientName] = useState(invoice?.clientName ?? "");
  const [clientTrn, setClientTrn] = useState(invoice?.clientTrn ?? "");
  const [clientAddress, setClientAddress] = useState(invoice?.clientAddress ?? "");
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate ?? todayInDubai());
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? todayInDubai());
  const [paymentTerms, setPaymentTerms] = useState(invoice?.paymentTerms ?? "");
  const [lpoRef, setLpoRef] = useState(invoice?.lpoRef ?? "");
  const [project, setProject] = useState(invoice?.project ?? "");
  const [scope, setScope] = useState(invoice?.scope ?? "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    invoice
      ? invoice.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), rate: String(l.rate) }))
      : [{ description: "", quantity: "1", rate: "0" }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listInvoiceClients().then((list) => !cancelled && setClients(list)).catch(() => undefined);
    if (!invoice) {
      getDocumentSettings()
        .then((s) => {
          if (cancelled) return;
          setPaymentTerms(s.defaultPaymentTerms);
          setNotes(s.defaultInvoiceNotes);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [invoice]);

  const preview = useMemo(() => {
    const amounts = lines.map((l) => {
      const q = Number(l.quantity);
      const r = Number(l.rate);
      return Number.isFinite(q) && Number.isFinite(r) ? lineAmounts(q, r) : { taxable: 0, vat: 0, amount: 0 };
    });
    return { amounts, ...invoiceTotals(amounts) };
  }, [lines]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (clientChoice === MANUAL && clientName.trim() === "") found.clientName = "Choose or enter the client.";
    if (!invoiceDate) found.invoiceDate = "Enter the invoice date.";
    if (!dueDate) found.dueDate = "Enter the due date.";
    else if (invoiceDate && dueDate < invoiceDate) found.dueDate = "The due date cannot be before the invoice date.";
    if (lines.length === 0) found.lines = "Add at least one line.";
    lines.forEach((l, i) => {
      if (l.description.trim() === "") found[`lines[${i}].description`] = "Enter a description.";
      if (!validMoney(l.quantity)) found[`lines[${i}].quantity`] = "Enter 0 or more, up to 2 decimals.";
      if (!validMoney(l.rate)) found[`lines[${i}].rate`] = "Enter 0 or more, up to 2 decimals.";
    });
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body: InvoiceInput = {
      clientId: clientChoice === MANUAL ? null : Number(clientChoice),
      clientName, clientTrn, clientAddress, invoiceDate, dueDate, paymentTerms, lpoRef, project, scope, notes,
      lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), rate: Number(l.rate) })),
    };
    setPending(true);
    try {
      onSaved(invoice ? await updateInvoice(invoice.id, body) : await createInvoice(body));
    } catch (error) {
      const server = fieldErrors(error);
      setErrors(server);
      setFailure(Object.keys(server).length > 0 ? "Please fix the highlighted fields." : errorMessage(error));
      setPending(false);
    }
  }

  const saved = clients.find((c) => String(c.id) === clientChoice);

  return (
    <form onSubmit={submit} noValidate aria-label={invoice ? "Edit draft invoice" : "New invoice"} className="space-y-5">
      <Card className="space-y-4 p-5">
        <h3 className="text-base font-semibold text-ink-900">Client</h3>
        <Select label="Client" value={clientChoice} onChange={(e) => setClientChoice(e.target.value)} error={errors.clientId}>
          <option value={MANUAL}>Enter manually</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {clientChoice === MANUAL ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} error={errors.clientName} maxLength={120} />
            <TextField label="Client TRN" value={clientTrn} onChange={(e) => setClientTrn(e.target.value)} error={errors.clientTrn} maxLength={30} />
            <div className="sm:col-span-2">
              <Textarea label="Client address" rows={2} value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} error={errors.clientAddress} maxLength={250} />
            </div>
          </div>
        ) : (
          saved && (
            <p className="text-sm text-ink-600">
              {saved.trn ? `TRN ${saved.trn}. ` : ""}
              {saved.address}
            </p>
          )
        )}
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <TextField label="Invoice date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} error={errors.invoiceDate} />
        <TextField label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
        <TextField label="Payment terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} error={errors.paymentTerms} maxLength={40} />
        <TextField label="LPO reference" value={lpoRef} onChange={(e) => setLpoRef(e.target.value)} error={errors.lpoRef} maxLength={80} />
        <TextField label="Project" value={project} onChange={(e) => setProject(e.target.value)} error={errors.project} maxLength={120} />
        <TextField label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} error={errors.scope} maxLength={120} />
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-ink-900">Lines</h3>
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setLines((c) => [...c, { description: "", quantity: "1", rate: "0" }])}>
            Add line
          </Button>
        </div>
        {errors.lines && <p role="alert" className="mt-2 text-sm text-danger">{errors.lines}</p>}
        <TableScroll className="mt-3">
          <Table className="min-w-[720px]">
            <caption className="sr-only">Invoice lines</caption>
            <THead>
              <TRow className="hover:bg-transparent">
                <Th className="w-[38%]">Description</Th>
                <Th align="right" className="w-24">Area</Th>
                <Th align="right" className="w-28">Rate (AED)</Th>
                <Th align="right">VAT 5%</Th>
                <Th align="right">Amount</Th>
                <Th className="w-12"><span className="sr-only">Remove</span></Th>
              </TRow>
            </THead>
            <tbody>
              {lines.map((line, i) => (
                <TRow key={i} className="align-top">
                  <Td>
                    <TextField hideLabel label={`Description, line ${i + 1}`} placeholder="e.g. Supply and install 12 mm tempered glass" value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} error={errors[`lines[${i}].description`]} maxLength={500} />
                  </Td>
                  <Td>
                    <TextField hideLabel label={`Area, line ${i + 1}`} inputMode="decimal" value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} error={errors[`lines[${i}].quantity`]} />
                  </Td>
                  <Td>
                    <TextField hideLabel label={`Rate, line ${i + 1}`} inputMode="decimal" value={line.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} error={errors[`lines[${i}].rate`]} />
                  </Td>
                  <Td numeric className="pt-5 text-ink-600">{formatMoney(preview.amounts[i].vat)}</Td>
                  <Td numeric className="pt-5 font-semibold text-ink-900">{formatMoney(preview.amounts[i].amount)}</Td>
                  <Td className="pt-3">
                    <IconButton icon={Trash2} label={`Remove line ${i + 1}`} tone="danger" disabled={lines.length === 1} onClick={() => setLines((c) => c.filter((_, j) => j !== i))} />
                  </Td>
                </TRow>
              ))}
            </tbody>
          </Table>
        </TableScroll>
        <dl className="mt-5 ml-auto w-full max-w-sm space-y-2 rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700" aria-label="Totals preview">
          <div className="flex justify-between"><dt>Sub total</dt><dd className="tabular-nums">{formatMoney(preview.subTotal)}</dd></div>
          <div className="flex justify-between"><dt>VAT (5%)</dt><dd className="tabular-nums">{formatMoney(preview.vatTotal)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold text-ink-900"><dt>Total (AED)</dt><dd className="tabular-nums">{formatMoney(preview.total)}</dd></div>
          <p className="pt-1 text-xs text-ink-500">Preview only. The final amounts are calculated when you save.</p>
        </dl>
      </Card>

      <Card className="p-5">
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} maxLength={300} />
      </Card>

      {failure && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" icon={X} onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" icon={pending ? Loader2 : Save} disabled={pending} aria-busy={pending}>
          {pending ? "Saving..." : "Save draft"}
        </Button>
      </div>
    </form>
  );
}
