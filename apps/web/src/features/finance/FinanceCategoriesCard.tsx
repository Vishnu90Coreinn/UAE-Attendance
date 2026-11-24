import { useEffect, useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Power, X } from "lucide-react";
import { createFinCategory, listFinCategories, updateFinCategory, type FinCategory, type FinEntryKind } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Button, Card, CardHeader, Input, StatusBadge } from "../../ui";

const KINDS: { kind: FinEntryKind; title: string; hint: string }[] = [
  { kind: "Expense", title: "Expense categories", hint: "What the company spends money on." },
  { kind: "Income", title: "Income categories", hint: "Where money received comes from." },
];

function message(error: unknown): string {
  if (error instanceof ApiError) return error.fieldErrors ? Object.values(error.fieldErrors).flat().join(" ") : error.message;
  return "Something went wrong. Please try again.";
}

function KindList({ kind, title, hint, items, onChanged }: {
  kind: FinEntryKind;
  title: string;
  hint: string;
  items: FinCategory[];
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
        {items.map((c) => (
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
                <span className={`min-w-0 flex-1 break-words text-sm ${c.isActive ? "text-ink-900" : "text-ink-500 line-through"}`}>{c.name}</span>
                {!c.isActive && <StatusBadge tone="neutral" variant="soft">Switched off</StatusBadge>}
                <span className="text-xs tabular-nums text-ink-500">{c.useCount === 1 ? "1 entry" : `${c.useCount} entries`}</span>
                <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setRenaming({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`}>
                  Rename
                </Button>
                <Button size="sm" variant="ghost" icon={Power} disabled={pending} onClick={() => void run(() => updateFinCategory(c.id, c.name, !c.isActive))} aria-label={`${c.isActive ? "Switch off" : "Switch on"} ${c.name}`}>
                  {c.isActive ? "Switch off" : "Switch on"}
                </Button>
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

  useEffect(() => {
    let cancelled = false;
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
      <CardHeader title="Finance categories" description="The lists offered when an expense or income is recorded. Categories are renamed or switched off, never deleted, so old entries keep theirs." />
      <div className="grid gap-8 p-5 lg:grid-cols-2">
        {failed && (
          <p role="alert" className="text-sm text-danger lg:col-span-2">
            {failed}
          </p>
        )}
        {!categories && !failed && <p className="text-sm text-ink-600 lg:col-span-2">Loading categories...</p>}
        {categories && KINDS.map((k) => <KindList key={k.kind} {...k} items={categories.filter((c) => c.kind === k.kind)} onChanged={changed} />)}
      </div>
    </Card>
  );
}
