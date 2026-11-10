import { useRef, useState, type FormEvent } from "react";
import { Ban, Copy, Download, Loader2, Pencil, Printer, Send, Trash2, Wallet } from "lucide-react";
import {
  addPayment, cancelInvoice, deleteInvoice, duplicateInvoice, getInvoicePdf, issueInvoice, removePayment, type Invoice,
} from "../../api/invoices";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Card, CardHeader, IconButton, Textarea, Table, TableScroll, THead, Th, TRow, Td } from "../../ui";
import { downloadFile } from "./download";
import { InvoiceDocument } from "./InvoiceDocument";
import { formatMoney } from "./invoiceMath";
import { errorMessage, fieldErrors, formatDate, InvoiceStatusBadges, todayInDubai } from "./invoiceUi";

interface Props {
  invoice: Invoice;
  canWrite: boolean;
  onChanged: (invoice: Invoice) => void;
  onEdit: () => void;
  onDeleted: () => void;
  onOpen: (invoice: Invoice) => void;
}

type Dialogs = null | "issue" | "delete" | "cancel" | "payment";

export function InvoiceView({ invoice, canWrite, onChanged, onEdit, onDeleted, onOpen }: Props) {
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  const draft = invoice.status === "Draft";
  const issued = invoice.status === "Issued";

  return (
    <div className="space-y-5">
      <div className="invoice-controls flex flex-wrap items-center gap-2">
        <InvoiceStatusBadges status={invoice.displayStatus} overdue={invoice.isOverdue} />
        <span className="flex-1" />
        <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
          Print
        </Button>
        <Button
          variant="secondary" size="sm" icon={Download} disabled={busy}
          onClick={() => run(async () => downloadFile(await getInvoicePdf(invoice.id), `${invoice.number ?? `Draft-${invoice.id}`}.pdf`))}
        >
          Download PDF
        </Button>
        {canWrite && draft && <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit}>Edit</Button>}
        {canWrite && draft && <Button size="sm" icon={Send} onClick={() => setDialog("issue")}>Issue invoice</Button>}
        {canWrite && draft && <Button variant="danger" size="sm" icon={Trash2} onClick={() => setDialog("delete")}>Delete draft</Button>}
        {canWrite && issued && <Button size="sm" icon={Wallet} onClick={() => setDialog("payment")}>Record payment</Button>}
        {canWrite && <Button variant="secondary" size="sm" icon={Copy} disabled={busy} onClick={() => run(async () => onOpen(await duplicateInvoice(invoice.id)))}>Duplicate</Button>}
        {canWrite && issued && <Button variant="danger" size="sm" icon={Ban} onClick={() => setDialog("cancel")}>Cancel invoice</Button>}
      </div>

      {failure && (
        <p role="alert" className="invoice-controls rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {failure}
        </p>
      )}
      <div role="status" className="invoice-controls empty:hidden">
        {notice && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      </div>
      {invoice.status === "Cancelled" && (
        <p className="invoice-controls rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Cancelled{invoice.cancelledUtc ? ` on ${formatDate(invoice.cancelledUtc.slice(0, 10))}` : ""}: {invoice.cancelReason}. The number {invoice.number} is kept and will not be reused.
        </p>
      )}

      <InvoiceDocument invoice={invoice} />

      {(issued || invoice.payments.length > 0) && (
        <Card className="invoice-controls">
          <CardHeader title="Payments" description={`Paid ${formatMoney(invoice.amountPaid)} of ${formatMoney(invoice.total)} AED`} />
          {invoice.payments.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-600">No payments recorded yet.</p>
          ) : (
            <TableScroll>
              <Table>
                <caption className="sr-only">Payments received</caption>
                <THead>
                  <TRow className="hover:bg-transparent">
                    <Th>Date</Th>
                    <Th align="right">Amount (AED)</Th>
                    <Th>Method</Th>
                    <Th>Reference</Th>
                    <Th>Recorded by</Th>
                    {canWrite && issued && <Th><span className="sr-only">Actions</span></Th>}
                  </TRow>
                </THead>
                <tbody>
                  {invoice.payments.map((p) => (
                    <TRow key={p.id}>
                      <Td>{formatDate(p.paidDate)}</Td>
                      <Td numeric>{formatMoney(p.amount)}</Td>
                      <Td>{p.method}</Td>
                      <Td>{p.reference || "-"}</Td>
                      <Td>{p.recordedBy}</Td>
                      {canWrite && issued && (
                        <Td>
                          <IconButton
                            icon={Trash2} tone="danger" label={`Remove payment of ${formatMoney(p.amount)} on ${formatDate(p.paidDate)}`} disabled={busy}
                            onClick={() => run(async () => { onChanged(await removePayment(invoice.id, p.id)); setNotice("Payment removed."); })}
                          />
                        </Td>
                      )}
                    </TRow>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={dialog === "issue"} title="Issue this invoice?" confirmLabel="Issue invoice" confirmIcon={Send} pending={busy}
        message="It receives the next invoice number and can no longer be edited. You can still record payments or cancel it."
        onCancel={() => setDialog(null)}
        onConfirm={() => run(async () => { onChanged(await issueInvoice(invoice.id)); setNotice("Invoice issued."); })}
      />
      <ConfirmDialog
        open={dialog === "delete"} title="Delete this draft?" confirmLabel="Delete draft" pending={busy}
        message="The draft is removed permanently. Issued invoices cannot be deleted."
        onCancel={() => setDialog(null)}
        onConfirm={() => run(async () => { await deleteInvoice(invoice.id); onDeleted(); })}
      />
      <CancelDialog open={dialog === "cancel"} onClose={() => setDialog(null)} onDone={(updated) => { onChanged(updated); setDialog(null); setNotice("Invoice cancelled."); }} invoiceId={invoice.id} />
      <PaymentDialog
        open={dialog === "payment"} balance={invoice.balanceDue} invoiceId={invoice.id} onClose={() => setDialog(null)}
        onDone={(updated) => { onChanged(updated); setDialog(null); setNotice("Payment recorded."); }}
      />
    </div>
  );
}

function CancelDialog({ open, onClose, onDone, invoiceId }: { open: boolean; onClose: () => void; onDone: (i: Invoice) => void; invoiceId: number }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() === "") return setError("Enter the reason for cancelling.");
    setPending(true);
    try {
      onDone(await cancelInvoice(invoiceId, reason));
    } catch (e) {
      setError(fieldErrors(e).reason ?? errorMessage(e));
      setPending(false);
    }
  }
  return (
    <Dialog open={open} onClose={pending ? () => {} : onClose} title="Cancel this invoice?">
      <form onSubmit={submit} noValidate className="mt-3 space-y-4">
        <p className="text-sm text-ink-700">The invoice number is kept and will never be reused.</p>
        <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} maxLength={300} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Keep invoice</Button>
          <Button type="submit" variant="danger" icon={pending ? Loader2 : Ban} disabled={pending}>Cancel invoice</Button>
        </div>
      </form>
    </Dialog>
  );
}

function PaymentDialog({ open, balance, invoiceId, onClose, onDone }: { open: boolean; balance: number; invoiceId: number; onClose: () => void; onDone: (i: Invoice) => void }) {
  const [paidDate, setPaidDate] = useState(todayInDubai());
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) found.amount = "Enter an amount above 0 with at most 2 decimals.";
    else if (Number(amount) > balance) found.amount = `The payment is more than the balance due (${formatMoney(balance)}).`;
    if (!paidDate) found.paidDate = "Enter the payment date.";
    if (method.trim() === "") found.method = "Enter how it was paid.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      onDone(await addPayment(invoiceId, { paidDate, amount: Number(amount), method, reference }));
    } catch (e) {
      const server = fieldErrors(e);
      setErrors(Object.keys(server).length > 0 ? server : { amount: errorMessage(e) });
      setPending(false);
    }
  }
  return (
    <Dialog open={open} onClose={pending ? () => {} : onClose} title="Record payment" initialFocusRef={first}>
      <form onSubmit={submit} noValidate className="mt-3 space-y-4">
        <TextField label="Amount (AED)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} hint={`Balance due ${formatMoney(balance)}`} inputRef={first} />
        <TextField label="Payment date" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} error={errors.paidDate} max={todayInDubai()} />
        <TextField label="Method" value={method} onChange={(e) => setMethod(e.target.value)} error={errors.method} maxLength={30} />
        <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} maxLength={60} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" icon={pending ? Loader2 : Wallet} disabled={pending}>Save payment</Button>
        </div>
      </form>
    </Dialog>
  );
}
