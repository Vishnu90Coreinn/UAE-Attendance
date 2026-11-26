import { useEffect, useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Power, X } from "lucide-react";
import { createFinCategory, listFinCategories, listFinTaxTypes, setCategoryTaxDefault, updateFinCategory, type FinCategory, type FinEntryKind, type FinTaxType } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Button, Card, CardHeader, Input, StatusBadge } from "../../ui";
import { isVatSettlementCategory } from "./financeFormat";

const KINDS: { kind: FinEntryKind; title: string; hint: string }[] = [
  { kind: "Expense", title: "Expense categories", hint: "What the company spends money on." },
  { kind: "Income", title: "Income categories", hint: "Where money received comes from." },
];

function message(error: unknown): string {
  if (error instanceof ApiError) return error.fieldErrors ? Object.values(error.fieldErrors).flat().join(" ") : error.message;
  return "Something went wrong. Please try again.";
}

function KindList({ kind, title, hint, items, taxTypes, onChanged }: {
  kind: FinEntryKind;
  title: string;
  hint: string;
  items: FinCategory[];
  taxTypes: FinTaxType[];
  onChanged: (category: FinCategory) => void;
}) {
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<FinCategory>, after?: () => void) {
    setPending(true);
    setError(null);
    try {
      onChanged(await action());
      after?.();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setPending(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    if (!adding.trim()) {
      setError("Enter the category name.");
      return;
    }
    void run(() => createFinCategory(kind, adding.trim()), () => setAdding(""));
  }

  return (
    <section aria-labelledby={`fin-cat-${kind}`}>
      <h3 id={`fin-cat-${kind}`} className="text-sm font-semibold text-ink-900">
        {title}
      </h3>
      <p className="mt-0.5 text-sm text-ink-600">{hint}</p>
      <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
        {items.map((c) => c.isSystem || isVatSettlementCategory(c.id) ? (
          // Categories the app needs: shown so nobody wonders where the money went, but nothing about them can be changed here.
          <li key={c.id} className="flex flex-wrap items-center gap-2 bg-ink-50 px-3 py-2">
            <span className="min-w-0 flex-1 break-words text-[15px] font-medium text-ink-900">{c.name}</span>
            <StatusBadge tone="neutral" variant="soft">System</StatusBadge>
            <span className="basis-full text-[13px] text-ink-600">{isVatSettlementCategory(c.id) ? "Settles VAT with the tax authority. No VAT of its own." : "Posted by the app. Not offered on entry forms."}</span>
          </li>
        ) : (
          <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            {renaming?.id === c.id ? (
              <form
                className="flex min-w-0 flex-1 items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => updateFinCategory(c.id, renaming.name.trim(), c.isActive), () => setRenaming(null));
                }}
              >
                <div className="min-w-0 flex-1">
                  <Input label={`New name for ${c.name}`} hideLabel value={renaming.name} maxLength={80} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} autoFocus />
                </div>
                <Button type="submit" size="sm" icon={Check} disabled={pending} aria-label="Save name">
                  Save
                </Button>
                <Button size="sm" variant="ghost" icon={X} onClick={() => setRenaming(null)} aria-label="Cancel renaming">
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span className={`min-w-0 basis-full break-words text-[15px] font-medium sm:flex-1 sm:basis-0 ${c.isActive ? "text-ink-900" : "text-ink-500 line-through"}`}>{c.name}</span>
                {!c.isActive && <StatusBadge tone="neutral" variant="soft">Switched off</StatusBadge>}
                <span className="mr-auto text-xs tabular-nums text-ink-500 sm:mr-0">{c.useCount === 1 ? "1 entry" : `${c.useCount} entries`}</span>
                {taxTypes.length > 0 && (
                  <select
                    aria-label={`VAT type offered for ${c.name}`}
                    value={c.noVat ? "0" : (c.defaultTaxTypeId ?? "")}
                    disabled={pending}
                    onChange={(e) => void run(() => setCategoryTaxDefault(c.id, e.target.value === "" ? null : Number(e.target.value)))}
                    className="select-control min-h-9 max-w-44 rounded-lg border border-line bg-white px-2 text-xs text-ink-800"
                  >
                    <option value="">Ask each time</option>
                    <option value="0">Never carries VAT</option>
                    {taxTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Pencil} className="px-2 text-ink-600" onClick={() => setRenaming({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`}>
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" icon={Power} className="px-2 text-ink-600" disabled={pending} onClick={() => void run(() => updateFinCategory(c.id, c.name, !c.isActive))} aria-label={`${c.isActive ? "Switch off" : "Switch on"} ${c.name}`}>
                    {c.isActive ? "Switch off" : "Switch on"}
                  </Button>
                </span>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="px-3 py-3 text-sm text-ink-600">No categories yet.</li>}
      </ul>
      <form onSubmit={add} noValidate className="mt-3 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input label={`Add ${kind.toLowerCase()} category`} value={adding} maxLength={80} onChange={(e) => setAdding(e.target.value)} autoComplete="off" />
        </div>
        <Button type="submit" icon={Plus} disabled={pending} className="mb-0">
          Add
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** Settings card where a Manager adds, renames and switches off the expense and income categories. */
export function FinanceCategoriesCard() {
  const [categories, setCategories] = useState<FinCategory[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [taxTypes, setTaxTypes] = useState<FinTaxType[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(listFinTaxTypes())
      .then((list) => !cancelled && setTaxTypes(list ?? []))
      .catch(() => {});
    listFinCategories(true)
      .then((list) => !cancelled && setCategories(list))
      .catch((error) => !cancelled && setFailed(message(error)));
    return () => {
      cancelled = true;
    };
  }, []);

  function changed(category: FinCategory) {
    setCategories((current) => {
      if (!current) return current;
      return current.some((c) => c.id === category.id) ? current.map((c) => (c.id === category.id ? category : c)) : [...current, category];
    });
  }

  return (
    <Card>
      <CardHeader title="Finance categories" description="The lists offered when an expense or income is recorded, with the VAT type each one offers first (the accountant decides this per category). Categories are renamed or switched off, never deleted, so old entries keep theirs." />
      <div className="grid gap-8 p-5">
        {failed && (
          <p role="alert" className="text-sm text-danger">
            {failed}
          </p>
        )}
        {!categories && !failed && <p className="text-sm text-ink-600">Loading categories...</p>}
        {categories && KINDS.map((k) => <KindList key={k.kind} {...k} items={categories.filter((c) => c.kind === k.kind)} taxTypes={taxTypes} onChanged={changed} />)}
      </div>
    </Card>
  );
}
