import { useCallback, useEffect, useState } from "react";
import { LocateFixed, Plus, Save, Trash2 } from "lucide-react";
import {
  addHoliday, deleteHoliday, getStaffSettings, listHolidays, saveStaffSettings,
  type Holiday, type StaffSettings,
} from "../../api/staff";
import { Button, Card, CardHeader, Input, Select } from "../../ui";
import { ActionFailure, SuccessRegion } from "../workers/WorkersFeedback";
import { getPlace } from "./selfie";
import { errorText, shortDate } from "./staffUi";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function numberOrNull(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

/** Shift, weekly off, office location and public holidays for office attendance. */
export function StaffSettingsCard() {
  const [settings, setSettings] = useState<StaffSettings | null>(null);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("");
  const [lateRate, setLateRate] = useState("0");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([getStaffSettings(), listHolidays()]);
      setSettings(s);
      setLat(s.officeLatitude?.toString() ?? "");
      setLng(s.officeLongitude?.toString() ?? "");
      setRadius(s.officeRadiusMeters?.toString() ?? "");
      setLateRate(String(s.lateDeductionPerMinute ?? 0));
      setHolidays(h);
    } catch (e) {
      setFailure(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!settings) return failure ? <p className="mt-8 text-sm text-ink-600">Office staff attendance settings could not be loaded.</p> : null;

  function patch(change: Partial<StaffSettings>) {
    setSettings((current) => (current ? { ...current, ...change } : current));
    setSuccess(null);
  }

  async function save() {
    if (!settings) return;
    setPending(true);
    setFailure(null);
    setSuccess(null);
    try {
      const saved = await saveStaffSettings({ ...settings, officeLatitude: numberOrNull(lat), officeLongitude: numberOrNull(lng), officeRadiusMeters: numberOrNull(radius), lateDeductionPerMinute: Number(lateRate || 0) });
      setSettings(saved);
      setSuccess("Staff attendance settings saved.");
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setPending(false);
    }
  }

  async function useHere() {
    const result = await getPlace();
    if (result.ok) {
      setLat(result.place.latitude.toFixed(6));
      setLng(result.place.longitude.toFixed(6));
      if (!radius) setRadius("150");
    } else {
      setFailure(result.reason);
    }
  }

  async function addDay() {
    setFailure(null);
    try {
      await addHoliday(holidayDate, holidayName);
      setHolidayDate("");
      setHolidayName("");
      setHolidays(await listHolidays());
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  return (
    <Card className="mt-8">
      <CardHeader title="Office staff attendance" description="Working hours, weekly off day, office location and public holidays for office employees." />
      <div className="space-y-6 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Shift starts" type="time" value={settings.shiftStart} onChange={(e) => patch({ shiftStart: e.target.value })} />
          <Input label="Shift ends" type="time" value={settings.shiftEnd} onChange={(e) => patch({ shiftEnd: e.target.value })} />
          <Select label="Weekly off day" value={settings.weeklyOff} onChange={(e) => patch({ weeklyOff: Number(e.target.value) })}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </Select>
          <Input label="Late grace (minutes)" type="number" min={0} max={180} value={settings.lateGraceMinutes} onChange={(e) => patch({ lateGraceMinutes: Number(e.target.value) })} />
          <Input label="Early leave grace (minutes)" type="number" min={0} max={180} value={settings.earlyGraceMinutes} onChange={(e) => patch({ earlyGraceMinutes: Number(e.target.value) })} />
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-800">Office location</h3>
          <p className="text-sm text-ink-600">A sign-in outside this area is accepted but flagged for the manager. Leave empty to switch the check off.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Input label="Latitude" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
            <Input label="Longitude" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
            <Input label="Allowed radius (metres)" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
          </div>
          <div className="mt-3"><Button variant="secondary" icon={LocateFixed} onClick={() => void useHere()}>Use my current location</Button></div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-800">Payroll deductions (optional)</h3>
          <p className="text-sm text-ink-600">Used only in the Staff Payroll Summary. Both are off until you turn them on.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink-800">
              <input type="checkbox" checked={!!settings.deductAbsentDays} onChange={(e) => patch({ deductAbsentDays: e.target.checked })} className="size-5 rounded border-ink-300 accent-brand-600" />
              Deduct one day of pay (salary / 30) for each absent day
            </label>
            <Input label="Late arrival deduction (AED per minute)" inputMode="decimal" value={lateRate} onChange={(e) => setLateRate(e.target.value)} hint="0 means no deduction." />
          </div>
        </div>

        {failure && <ActionFailure message={failure} />}
        <SuccessRegion message={success} />
        <div className="flex justify-end"><Button icon={Save} onClick={() => void save()} disabled={pending}>Save attendance settings</Button></div>

        <div className="border-t border-line pt-5">
          <h3 className="text-sm font-semibold text-ink-800">Public holidays</h3>
          <p className="text-sm text-ink-600">Holidays are not counted as absent, and are skipped when leave days are counted.</p>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {holidays.length === 0 && <li className="px-4 py-3 text-sm text-ink-600">No holidays added.</li>}
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span><strong className="font-medium text-ink-900">{shortDate(h.date)}</strong> · {h.name}</span>
                <button type="button" aria-label={`Remove ${h.name}`} onClick={() => void deleteHoliday(h.id).then(load).catch((e) => setFailure(errorText(e)))} className="rounded p-2 text-red-800 hover:bg-red-50"><Trash2 aria-hidden="true" size={16} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Input label="Date" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
            <Input label="Holiday name" value={holidayName} maxLength={100} onChange={(e) => setHolidayName(e.target.value)} />
            <Button icon={Plus} onClick={() => void addDay()} disabled={!holidayDate || !holidayName.trim()}>Add holiday</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
