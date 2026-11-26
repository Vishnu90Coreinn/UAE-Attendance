import { useEffect, useState } from "react";
import { getFinanceTaxPeriod, saveFinanceTaxPeriod, type FinanceTaxPeriodSettings } from "../../api/finance";
import { Button, Card, CardHeader, Select } from "../../ui";

export function FinanceTaxPeriodCard() {
  const [value, setValue] = useState<FinanceTaxPeriodSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { Promise.resolve(getFinanceTaxPeriod()).then((v) => setValue(v ?? null)).catch(() => setError("The VAT period could not be loaded. Reload to try again.")); }, []);
  async function save() {
    if (!value) return;
    setBusy(true); setError(null); setMessage(null);
    try { setValue(await saveFinanceTaxPeriod(value)); setMessage("VAT period saved."); }
    catch { setError("The VAT period could not be saved. Try again."); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader title="Assigned VAT period" description="Use the period shown in the company's EmaraTax registration. A quarterly period can start in any month." />
    <div className="space-y-4 p-5">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-800">{message}</p>}
      {value && <>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="VAT filing frequency" value={String(value.months)} onChange={(e) => setValue({ ...value, months: Number(e.target.value) })}>
            <option value="1">Monthly</option><option value="3">Quarterly</option>
          </Select>
          <Select label="A VAT period starts in" value={String(value.startMonth)} onChange={(e) => setValue({ ...value, startMonth: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i, 1).toLocaleString("en", { month: "long" })}</option>)}
          </Select>
        </div>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={value.confirmed} onChange={(e) => setValue({ ...value, confirmed: e.target.checked })} />I checked this period against the company's EmaraTax registration.</label>
        <p className="text-sm text-ink-600">Deadline estimates are 28 days after period end. Confirm the actual deadline in EmaraTax, including any holiday extensions.</p>
        <Button disabled={busy} onClick={() => void save()}>Save VAT period</Button>
      </>}
    </div>
  </Card>;
}
