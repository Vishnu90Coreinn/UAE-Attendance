import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { cancelMyLeave, getMyLeave, requestLeave, type StaffLeave, type StaffMyLeave } from "../../api/staff";
import { Button, Card, CardHeader, Input, LoadingState, PageHeader, Select, StatusBadge, Textarea, type StatusTone } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { BalanceBar } from "./staffKit";
import { errorText, shortDate, todayInUae } from "./staffUi";

const STATUS_TONE: Record<StaffLeave["status"], StatusTone> = {
  Pending: "warning",
  Approved: "success",
  Rejected: "danger",
  Cancelled: "neutral",
};

export function MyLeavePage() {
  const [data, setData] = useState<StaffMyLeave | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState(todayInUae());
  const [end, setEnd] = useState(todayInUae());
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await getMyLeave();
      setData(result);
      setTypeId((current) => current || String(result.types[0]?.id ?? ""));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    setSuccess(null);
    try {
      await requestLeave({ leaveTypeId: Number(typeId), startDate: start, endDate: end, reason });
      setReason("");
      setSuccess("Leave request sent to your manager.");
      await load();
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setPending(false);
    }
  }

  async function cancel(request: StaffLeave) {
    setFailure(null);
    setSuccess(null);
    try {
      await cancelMyLeave(request.id);
      setSuccess("Leave request cancelled.");
      await load();
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  if (error) return <LoadError message={error} onRetry={() => void load()} />;
  if (!data) return <LoadingState label="Loading..." />;

  return (
    <section>
      <PageHeader title="My Leave" description="Request leave and follow its approval. Sundays and public holidays are not counted." />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.balances.map((b) => (
          <Card key={b.leaveTypeId} className="p-4">
            <p className="text-sm font-medium text-ink-700">{b.leaveType}</p>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold leading-none tabular-nums text-ink-900">{b.remaining}</span>
              <span className="text-sm text-ink-600">of {b.entitlement} days left</span>
            </p>
            <div className="mt-3">
              <BalanceBar used={b.used} pending={b.pending} total={b.entitlement} />
            </div>
            <p className="mt-2 text-xs text-ink-600">
              {b.used} used{b.pending > 0 ? ` · ${b.pending} waiting for approval` : ""}
            </p>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader title="Request leave" />
        <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
          <Select label="Leave type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {data.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="From" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            <Input label="To" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Textarea label="Reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            {failure && <ActionFailure message={failure} />}
            <SuccessRegion message={success} />
            <div className="mt-3 flex justify-end">
              <Button type="submit" icon={pending ? Loader2 : CalendarPlus} disabled={pending || !typeId || !reason.trim()}>
                {pending ? "Sending..." : "Send request"}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="My requests" />
        {data.requests.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-600">You have not requested any leave yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">
                    {r.leaveType} · {r.days} day{r.days === 1 ? "" : "s"}
                  </p>
                  <p className="text-sm text-ink-600">
                    {shortDate(r.startDate)} to {shortDate(r.endDate)}
                  </p>
                  <p className="mt-1 text-sm text-ink-700">{r.reason}</p>
                  {r.decisionNote && (
                    <p className="mt-1 text-sm text-ink-600">
                      {r.decidedBy}: {r.decisionNote}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={STATUS_TONE[r.status]} variant="soft">
                    {r.status}
                  </StatusBadge>
                  {r.status === "Pending" && (
                    <Button size="sm" variant="secondary" onClick={() => void cancel(r)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
