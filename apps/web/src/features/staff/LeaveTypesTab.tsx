import { useState, type FormEvent } from "react";
import { AlertTriangle, Check, Pencil, Power, X } from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { addLeaveType, updateLeaveType, type StaffLeaveType } from "../../api/staff";
import { Button, Card, CardHeader, IconButton, Input } from "../../ui";
import { ActionFailure } from "../workers/WorkersFeedback";
import { errorText } from "./staffUi";

/** The same rules the server holds, said before the request is sent; null when the name is fine. */
function nameProblem(name: string, types: StaffLeaveType[], ownId?: number): string | null {
  const clean = name.trim();
  if (!clean) return "Enter a name.";
  if (clean.length > 60) return "Use 60 characters or fewer.";
  if (!/\p{L}/u.test(clean)) return "A name needs at least one letter.";
  if (types.some((t) => t.id !== ownId && t.name.toLowerCase() === clean.toLowerCase())) return "A leave type with that name already exists.";
  return null;
}

export function LeaveTypesTab({ types, onChanged }: { types: StaffLeaveType[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [needsDoc, setNeedsDoc] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [switchingOff, setSwitchingOff] = useState<StaffLeaveType | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setFailure(null);
    setPending(true);
    try {
      await action();
      after?.();
      onChanged();
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setPending(false);
    }
  }
  const change = (type: StaffLeaveType, patch: Partial<StaffLeaveType>, after?: () => void) => {
    const next = { ...type, ...patch };
    return run(() => updateLeaveType(type.id, next.name, next.yearlyDays, next.isActive, next.requiresDocument), after);
  };

  function add(event: FormEvent) {
    event.preventDefault();
    const problem = nameProblem(name, types);
    setAddError(problem);
    if (problem || days === "") return;
    void run(() => addLeaveType(name.trim(), Number(days), needsDoc), () => {
      setName("");
      setDays("");
      setNeedsDoc(false);
    });
  }

  const renameError = renaming ? nameProblem(renaming.name, types, renaming.id) : null;
  const checkbox = "flex h-11 cursor-pointer items-center gap-2 text-sm text-ink-700";

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
        <AlertTriangle aria-hidden="true" size={18} className="shrink-0" />
        Changes apply to every employee.
      </p>
      {failure && <ActionFailure message={failure} />}
      <Card>
        <CardHeader title="Leave types" description="The yearly entitlement for each type, and whether a request needs a document." />
        <ul className="divide-y divide-line">
          {types.map((t) => (
            <li key={t.id} aria-label={t.name} className="flex flex-wrap items-center gap-3 px-5 py-2">
              {renaming?.id === t.id ? (
                <form
                  className="flex min-w-60 flex-1 flex-wrap items-start gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!renameError) void change(t, { name: renaming.name.trim() }, () => setRenaming(null));
                  }}
                >
                  <div className="min-w-44 flex-1">
                    <Input label={`New name for ${t.name}`} value={renaming.name} maxLength={60} autoFocus error={renameError ?? undefined} onChange={(e) => setRenaming({ id: t.id, name: e.target.value })} />
                  </div>
                  <Button type="submit" icon={Check} className="mt-6" disabled={pending || !!renameError}>Save name</Button>
                  <Button variant="ghost" icon={X} className="mt-6" onClick={() => setRenaming(null)}>Cancel</Button>
                </form>
              ) : (
                <span className="flex min-w-48 flex-1 items-center gap-1">
                  <span className={`font-medium ${t.isActive ? "text-ink-900" : "text-ink-500 line-through"}`}>{t.name}</span>
                  <IconButton icon={Pencil} label={`Rename ${t.name}`} className="size-11" onClick={() => setRenaming({ id: t.id, name: t.name })} />
                </span>
              )}
              <label className="flex items-center gap-2 text-sm text-ink-700">
                Days a year
                <input
                  type="number"
                  min={0}
                  max={366}
                  defaultValue={t.yearlyDays}
                  aria-label={`Yearly days for ${t.name}`}
                  onBlur={(e) => Number(e.target.value) !== t.yearlyDays && void change(t, { yearlyDays: Number(e.target.value) })}
                  className="h-11 w-20 rounded-lg border border-ink-300 px-2 text-right focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                />
              </label>
              <label className={checkbox}>
                <input type="checkbox" checked={t.requiresDocument} onChange={(e) => void change(t, { requiresDocument: e.target.checked })} className="size-5 rounded border-ink-300 accent-brand-600" />
                Document required
              </label>
              <Button variant="secondary" icon={Power} onClick={() => (t.isActive ? setSwitchingOff(t) : void change(t, { isActive: true }))}>
                {t.isActive ? "Switch off" : "Switch on"}
              </Button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} noValidate className="flex flex-wrap items-start gap-3 border-t border-line p-5">
          <Input label="New leave type" value={name} maxLength={60} error={addError ?? undefined} onChange={(e) => { setName(e.target.value); setAddError(null); }} />
          <Input label="Days a year" type="number" min={0} max={366} value={days} onChange={(e) => setDays(e.target.value)} />
          <label className={`${checkbox} mt-6`}>
            <input type="checkbox" checked={needsDoc} onChange={(e) => setNeedsDoc(e.target.checked)} className="size-5 rounded border-ink-300 accent-brand-600" />
            Document required
          </label>
          <Button type="submit" className="mt-6" disabled={pending || !name.trim() || days === ""}>Add type</Button>
        </form>
      </Card>
      {types.every((t) => !t.isActive) && <p className="text-sm text-amber-800">No leave type is switched on, so employees cannot request leave.</p>}
      <ConfirmDialog
        open={switchingOff !== null}
        title={`Switch off ${switchingOff?.name ?? "this type"}?`}
        message={`This applies to every employee. Nobody can request ${switchingOff?.name ?? "it"} any more, and its column leaves the Balances tab. Requests already made stay as they are. You can switch it on again.`}
        confirmLabel="Switch off"
        confirmIcon={Power}
        pending={pending}
        onConfirm={() => switchingOff && void change(switchingOff, { isActive: false }, () => setSwitchingOff(null))}
        onCancel={() => setSwitchingOff(null)}
      />
    </div>
  );
}
