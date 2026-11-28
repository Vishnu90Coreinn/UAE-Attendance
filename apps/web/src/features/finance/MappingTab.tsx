import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { getLedgerMappings, setLedgerMapping, type LedgerAccount, type LedgerMapping } from "../../api/finance";
import { Card, CardHeader, notify, Select } from "../../ui";

const GROUPS: { kind: LedgerMapping["kind"]; title: string; help: string; types: LedgerAccount["type"][] }[] = [
  { kind: "Account", title: "Bank, cash and petty-cash accounts", help: "Each posts to its own asset account.", types: ["Asset", "Liability"] },
  { kind: "Partner", title: "Partners' capital", help: "Each partner posts to their own equity account.", types: ["Equity", "Liability"] },
  { kind: "Category", title: "Expense and income categories", help: "Several categories may share one account.", types: ["Asset", "Liability", "Equity", "Revenue", "Expense"] },
];

/** Where each record posts. Changing it derives the books again so the past follows; only an Administrator may, and only while no month is locked. */
export function MappingTab({ accounts, canEdit, onChanged }: { accounts: LedgerAccount[]; canEdit: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<LedgerMapping[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLedgerMappings().then((m) => !cancelled && setItems(m)).catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "The mapping could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Bank, cash and partner accounts each need their own ledger account, so one already used by another row is not offered again. Categories may share. */
  const takenByOthers = (kind: LedgerMapping["kind"], id: number) => new Set((items ?? []).filter((x) => x.kind === kind && x.id !== id).map((x) => x.ledgerAccountId));

  async function change(m: LedgerMapping, target: number) {
    setBusy(`${m.kind}-${m.id}`);
    setError(null);
    try {
      const saved = await setLedgerMapping(m.kind, m.id, target);
      setItems((cur) => cur?.map((x) => (x.kind === saved.kind && x.id === saved.id ? saved : x)) ?? null);
      notify.success(`${m.name} now posts to ${accounts.find((a) => a.id === target)?.name ?? "the chosen account"}. The books were derived again.`);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {!canEdit && <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">Only an Administrator can change where records post.</p>}
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">Each choice below says which ledger account the entries post to. Changing one derives the books again, so past entries follow. It is refused once a month is locked.</p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!items && !error && <p className="text-sm text-ink-600">Loading...</p>}
      {items && GROUPS.map((g) => (
        <Card key={g.kind}>
          <CardHeader title={g.title} description={g.help} />
          <ul className="divide-y divide-line border-t border-line">
            {items.filter((m) => m.kind === g.kind).map((m) => (
              <li key={m.id} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
                <span className="min-w-0 break-words text-[15px] font-medium text-ink-900">{m.name}{m.detail && <span className="ml-2 text-xs font-normal text-ink-500">{m.detail === "Custody" ? "Petty cash" : m.detail}</span>}</span>
                <Select label={`${m.name} posts to`} hideLabel value={String(m.ledgerAccountId)} disabled={!canEdit || busy === `${m.kind}-${m.id}`} onChange={(e) => void change(m, Number(e.target.value))}>
                  {accounts.filter((a) => (a.isActive || a.id === m.ledgerAccountId) && g.types.includes(a.type) && (g.kind === "Category" || a.id === m.ledgerAccountId || !takenByOthers(g.kind, m.id).has(a.id))).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </Select>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
