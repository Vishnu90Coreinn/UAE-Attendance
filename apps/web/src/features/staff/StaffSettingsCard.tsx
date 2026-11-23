import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, LocateFixed, MapPin, Plus, Save, Trash2, Wallet } from "lucide-react";
import {
  addHoliday, deleteHoliday, getStaffSettings, listHolidays, saveStaffSettings,
  type Holiday, type StaffSettings,
} from "../../api/staff";
import { Button, Card, CardHeader, Input, Select } from "../../ui";
import { ActionFailure, SuccessRegion } from "../workers/WorkersFeedback";
import { getPlace } from "./selfie";
import { errorText, formatMoney, longDate } from "./staffUi";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Form {
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: number;
  lateGrace: string;
  earlyGrace: string;
  lat: string;
  lng: string;
  radius: string;
  deductAbsent: boolean;
  lateRate: string;
}

function toForm(s: StaffSettings): Form {
  return {
    shiftStart: s.shiftStart,
    shiftEnd: s.shiftEnd,
    weeklyOff: s.weeklyOff,
    lateGrace: String(s.lateGraceMinutes),
    earlyGrace: String(s.earlyGraceMinutes),
    lat: s.officeLatitude?.toString() ?? "",
    lng: s.officeLongitude?.toString() ?? "",
    radius: s.officeRadiusMeters?.toString() ?? "",
    deductAbsent: !!s.deductAbsentDays,
    lateRate: String(s.lateDeductionPerMinute ?? 0),
  };
}

function orNull(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

/** A titled group inside the card: an icon, a name and one line saying what it does. */
function Group({ icon: Icon, title, hint, children }: { icon: typeof Clock; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon size={16} />
        </span>
        <div>
          <h4 className="text-sm font-semibold text-ink-900">{title}</h4>
          <p className="text-sm text-ink-600">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** Shift, weekly off, office location, deduction rules and public holidays for office staff. */
export function StaffSettingsCard() {
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [base, setBase] = useState<StaffSettings | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayEnd, setHolidayEnd] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([getStaffSettings(), listHolidays()]);
      setBase(s);
      setSaved(toForm(s));
      setForm(toForm(s));
      setHolidays(h);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  if (loadFailed) return <p className="text-sm text-ink-600">Office staff attendance settings could not be loaded.</p>;
  if (!form || !base) return null;

  function patch(change: Partial<Form>) {
    setForm((current) => (current ? { ...current, ...change } : current));
    setSuccess(null);
  }

  async function save() {
    if (!form || !base) return;
    setPending(true);
    setFailure(null);
    setSuccess(null);
    try {
      const result = await saveStaffSettings({
        ...base,
        shiftStart: form.shiftStart,
        shiftEnd: form.shiftEnd,
        weeklyOff: form.weeklyOff,
        lateGraceMinutes: Number(form.lateGrace),
        earlyGraceMinutes: Number(form.earlyGrace),
        officeLatitude: orNull(form.lat),
        officeLongitude: orNull(form.lng),
        officeRadiusMeters: orNull(form.radius),
        deductAbsentDays: form.deductAbsent,
        lateDeductionPerMinute: Number(form.lateRate || 0),
      });
      setBase(result);
      setSaved(toForm(result));
      setForm(toForm(result));
      setSuccess("Office staff settings saved.");
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setPending(false);
    }
  }

  async function useHere() {
    const result = await getPlace();
    if (result.ok) {
      patch({ lat: result.place.latitude.toFixed(6), lng: result.place.longitude.toFixed(6), radius: form?.radius || "150" });
    } else {
      setFailure(result.reason);
    }
  }

  async function addDay() {
    setFailure(null);
    try {
      await addHoliday(holidayDate, holidayName, holidayEnd && holidayEnd > holidayDate ? holidayEnd : undefined);
      setHolidayDate("");
      setHolidayEnd("");
      setHolidayName("");
      setHolidays(await listHolidays());
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  const locationOn = form.lat.trim() !== "" && form.lng.trim() !== "" && form.radius.trim() !== "";
  const example = 6000;
  const upcoming = holidays.filter((h) => h.date >= new Date().toISOString().slice(0, 10));
  const past = holidays.filter((h) => h.date < new Date().toISOString().slice(0, 10));

  return (
    <section id="office-staff" aria-labelledby="office-staff-title" className="mt-10 max-w-4xl scroll-mt-20">
      <Card>
        <CardHeader
          title="Office staff"
          description="How attendance is worked out for office employees: hours, location, pay deductions and holidays."
        />
        <h3 id="office-staff-title" className="sr-only">Office staff settings</h3>
        <div className="space-y-5 p-5">
          <Group icon={Clock} title="Working hours" hint="Late and early leave are measured against these times.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Shift starts" type="time" value={form.shiftStart} onChange={(e) => patch({ shiftStart: e.target.value })} />
              <Input label="Shift ends" type="time" value={form.shiftEnd} onChange={(e) => patch({ shiftEnd: e.target.value })} />
              <Select label="Weekly off day" value={form.weeklyOff} onChange={(e) => patch({ weeklyOff: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </Select>
              <Input label="Late grace (minutes)" type="number" min={0} max={180} value={form.lateGrace} onChange={(e) => patch({ lateGrace: e.target.value })} hint="Arriving within this time is not late." />
              <Input label="Early leave grace (minutes)" type="number" min={0} max={180} value={form.earlyGrace} onChange={(e) => patch({ earlyGrace: e.target.value })} hint="Leaving this early is not flagged." />
            </div>
          </Group>

          <Group icon={MapPin} title="Office location" hint="A sign-in outside this area is accepted but flagged for the manager. Leave empty to switch the check off.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Latitude" inputMode="decimal" value={form.lat} onChange={(e) => patch({ lat: e.target.value })} />
              <Input label="Longitude" inputMode="decimal" value={form.lng} onChange={(e) => patch({ lng: e.target.value })} />
              <Input label="Allowed radius (metres)" inputMode="numeric" value={form.radius} onChange={(e) => patch({ radius: e.target.value })} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="secondary" icon={LocateFixed} onClick={() => void useHere()}>Use my current location</Button>
              <p className="flex items-center gap-2 text-sm" role="status">
                <span aria-hidden="true" className={`size-2.5 rounded-full ${locationOn ? "bg-green-600" : "bg-ink-300"}`} />
                <span className={locationOn ? "font-medium text-green-800" : "text-ink-600"}>
                  {locationOn ? `Location check is on (${form.radius} m)` : "Location check is off"}
                </span>
              </p>
            </div>
          </Group>

          <Group icon={Wallet} title="Payroll deductions" hint="Used only in the Staff Payroll Summary and payslips. Both are off until you turn them on.">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex min-h-11 items-start gap-3 text-sm font-medium text-ink-800">
                <input type="checkbox" checked={form.deductAbsent} onChange={(e) => patch({ deductAbsent: e.target.checked })} className="mt-0.5 size-5 shrink-0 rounded border-ink-300 accent-brand-600" />
                <span>
                  Deduct one day of pay for each absent day
                  <span className="block font-normal text-ink-600">One day is the monthly salary divided by 30.</span>
                </span>
              </label>
              <Input label="Late arrival deduction (AED per minute)" inputMode="decimal" value={form.lateRate} onChange={(e) => patch({ lateRate: e.target.value })} hint="0 means no deduction." />
            </div>
            <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
              {form.deductAbsent || Number(form.lateRate) > 0 ? (
                <>
                  Example: on a salary of {formatMoney(example)} AED, {form.deductAbsent ? <>one absent day costs <strong>{formatMoney(example / 30)} AED</strong></> : "absences cost nothing"}
                  {Number(form.lateRate) > 0 ? <> and 30 minutes late costs <strong>{formatMoney(Number(form.lateRate) * 30)} AED</strong></> : ""}.
                </>
              ) : (
                "No deductions are applied: employees are paid their full salary."
              )}
            </p>
          </Group>

          <Group icon={CalendarDays} title="Public holidays" hint="Holidays are not counted as absent, and are skipped when leave days are counted.">
            {holidays.length === 0 ? (
              <p className="text-sm text-ink-600">No holidays added yet.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {[...upcoming, ...past].map((h) => (
                  <li key={h.id} className={`flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm ${h.date < new Date().toISOString().slice(0, 10) ? "opacity-60" : ""}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">{h.name}</span>
                      <span className="text-ink-600">{longDate(h.date)}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${h.name}`}
                      onClick={() => void deleteHoliday(h.id).then(load).catch((e) => setFailure(errorText(e)))}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <Input label="From" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
              <Input label="To (optional, for several days)" type="date" value={holidayEnd} min={holidayDate || undefined} onChange={(e) => setHolidayEnd(e.target.value)} />
              <Input label="Holiday name" value={holidayName} maxLength={100} onChange={(e) => setHolidayName(e.target.value)} />
              <Button variant="secondary" icon={Plus} onClick={() => void addDay()} disabled={!holidayDate || !holidayName.trim()}>Add holiday</Button>
            </div>
            <p className="mt-2 text-xs text-ink-600">Leave "To" empty for a single day; for a multi-day holiday such as National Day, pick the first and last day and each day is listed. Holidays are saved as soon as you add or remove them. The other settings need Save.</p>
          </Group>

          {failure && <ActionFailure message={failure} />}
          <SuccessRegion message={success} />
        </div>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 rounded-b-card border-t border-line bg-white/95 px-5 py-3 backdrop-blur">
          <p className={`text-sm ${dirty ? "font-medium text-amber-800" : "text-ink-600"}`} role="status">
            {dirty ? "You have unsaved changes." : "No changes to save."}
          </p>
          <Button icon={Save} onClick={() => void save()} disabled={pending || !dirty}>
            {pending ? "Saving..." : "Save office staff settings"}
          </Button>
        </div>
      </Card>
    </section>
  );
}
