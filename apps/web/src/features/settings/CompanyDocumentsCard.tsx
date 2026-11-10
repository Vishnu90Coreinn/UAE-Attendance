import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Loader2, Save, Trash2 } from "lucide-react";
import {
  getDocumentSettings, removeDocumentImage, updateDocumentSettings, uploadDocumentImage,
  type DocumentImageKind, type DocumentSettings, type DocumentSettingsInput,
} from "../../api/documentSettings";
import { ApiError } from "../../api/client";
import { TextField } from "../../components/TextField";
import { Button, Card, CardHeader, Textarea } from "../../ui";

const MAX_IMAGE_BYTES = 1024 * 1024;

type TextKey = keyof DocumentSettingsInput;

const FIELDS: { key: TextKey; label: string; max: number; group: "company" | "bank" | "defaults" }[] = [
  { key: "companyName", label: "Letterhead company name", max: 120, group: "company" },
  { key: "companySubtitle", label: "Subtitle", max: 120, group: "company" },
  { key: "companyNameAr", label: "Company name (Arabic)", max: 160, group: "company" },
  { key: "mobile", label: "Mobile", max: 30, group: "company" },
  { key: "address1", label: "Address line 1", max: 120, group: "company" },
  { key: "address2", label: "Address line 2", max: 120, group: "company" },
  { key: "email", label: "Letterhead email", max: 120, group: "company" },
  { key: "trn", label: "Company TRN", max: 30, group: "company" },
  { key: "bankName", label: "Bank name", max: 80, group: "bank" },
  { key: "accountName", label: "Account name", max: 120, group: "bank" },
  { key: "accountNumber", label: "Account number", max: 40, group: "bank" },
  { key: "iban", label: "IBAN", max: 40, group: "bank" },
  { key: "defaultPaymentTerms", label: "Default payment terms", max: 40, group: "defaults" },
  { key: "signerName", label: "Letter signatory name", max: 80, group: "defaults" },
  { key: "signerTitle", label: "Letter signatory title", max: 80, group: "defaults" },
];

const IMAGES: { kind: DocumentImageKind; label: string; flag: "hasLogo" | "hasSeal" | "hasSignature"; hint: string }[] = [
  { kind: "logo", label: "Company logo", flag: "hasLogo", hint: "Shown on invoices." },
  { kind: "seal", label: "Company seal", flag: "hasSeal", hint: "Shown on letters and certificates." },
  { kind: "signature", label: "Signature", flag: "hasSignature", hint: "Shown on letters and certificates." },
];

function toInput(s: DocumentSettings): DocumentSettingsInput {
  const { nextInvoiceNumber: _n, hasLogo: _l, hasSeal: _s, hasSignature: _g, ...rest } = s;
  void _n; void _l; void _s; void _g;
  return rest;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

/** Company identity, bank details and artwork used on invoices and letters. Shown to Managers and the Administrator. */
export function CompanyDocumentsCard() {
  const [settings, setSettings] = useState<DocumentSettings | null>(null);
  const [values, setValues] = useState<DocumentSettingsInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDocumentSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setValues(toInput(s));
      })
      .catch((e) => !cancelled && setLoadError(e instanceof ApiError ? e.message : "Could not load the company document settings."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) return <p role="alert" className="mt-8 text-sm text-danger">{loadError}</p>;
  if (!settings || !values) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSuccess(null);
    const found: Record<string, string> = {};
    if (values!.companyName.trim() === "") found.companyName = "This field is required.";
    for (const f of FIELDS) if (values![f.key].length > f.max) found[f.key] = `Must be ${f.max} characters or fewer.`;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      const updated = await updateDocumentSettings(values!);
      setSettings(updated);
      setValues(toInput(updated));
      setSuccess("Company document settings saved.");
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        setErrors(Object.fromEntries(Object.entries(error.fieldErrors).map(([k, v]) => [k, v[0]])));
        setFailure("Please fix the highlighted fields.");
      } else setFailure(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function pickImage(kind: DocumentImageKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFailure(null);
    setSuccess(null);
    if (!["image/png", "image/jpeg"].includes(file.type)) return setFailure("Choose a PNG or JPEG picture.");
    if (file.size > MAX_IMAGE_BYTES) return setFailure("The picture must be 1 MB or smaller.");
    try {
      setSettings(await uploadDocumentImage(kind, await toBase64(file)));
      setSuccess("Picture saved.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not save the picture.");
    }
  }

  async function removeImage(kind: DocumentImageKind) {
    setFailure(null);
    setSuccess(null);
    try {
      await removeDocumentImage(kind);
      setSettings(await getDocumentSettings());
      setSuccess("Picture removed.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not remove the picture.");
    }
  }

  const group = (name: "company" | "bank" | "defaults") =>
    FIELDS.filter((f) => f.group === name).map((f) => (
      <TextField
        key={f.key} label={f.label} value={values[f.key]} maxLength={f.max} error={errors[f.key]}
        {...(f.key === "companyNameAr" ? { dir: "rtl", lang: "ar" } : {})}
        onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
      />
    ));

  return (
    <section aria-labelledby="company-documents-title" className="mt-10">
      <Card>
        <CardHeader title="Company documents" description="Used on tax invoices and HR letters. The next invoice number is shown for information." />
        <form onSubmit={save} noValidate className="space-y-5 p-5">
          <h3 id="company-documents-title" className="sr-only">Company documents settings</h3>
          <div className="grid gap-4 sm:grid-cols-2">{group("company")}</div>
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-ink-900">Bank details (printed on invoices)</legend>
            <div className="grid gap-4 sm:grid-cols-2">{group("bank")}</div>
          </fieldset>
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-ink-900">Defaults</legend>
            <div className="grid gap-4 sm:grid-cols-2">{group("defaults")}</div>
            <Textarea
              label="Default invoice notes" rows={2} maxLength={300} value={values.defaultInvoiceNotes}
              error={errors.defaultInvoiceNotes} onChange={(e) => setValues({ ...values, defaultInvoiceNotes: e.target.value })}
            />
            <p className="text-sm text-ink-600">Next invoice number: INV-{String(settings.nextInvoiceNumber).padStart(6, "0")}</p>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-ink-900">Pictures (PNG or JPEG, up to 1 MB)</legend>
            {IMAGES.map((image) => (
              <ImageRow
                key={image.kind} label={image.label} hint={image.hint} present={settings[image.flag]}
                onPick={(e) => void pickImage(image.kind, e)} onRemove={() => void removeImage(image.kind)}
              />
            ))}
          </fieldset>

          {failure && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{failure}</p>}
          <div role="status" className="empty:hidden">
            {success && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{success}</p>}
          </div>
          <div className="flex justify-end">
            <Button type="submit" icon={pending ? Loader2 : Save} disabled={pending} aria-busy={pending}>
              {pending ? "Saving..." : "Save company documents"}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

function ImageRow({ label, hint, present, onPick, onRemove }: { label: string; hint: string; present: boolean; onPick: (e: ChangeEvent<HTMLInputElement>) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="text-sm text-ink-600">{present ? "Uploaded." : "Not uploaded."} {hint}</p>
      </div>
      <div className="flex gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label={`Choose ${label.toLowerCase()} file`} onChange={onPick} tabIndex={-1} />
        <Button variant="secondary" size="sm" icon={ImagePlus} aria-label={`${present ? "Replace" : "Upload"} ${label.toLowerCase()}`} onClick={() => input.current?.click()}>
          {present ? "Replace" : "Upload"}
        </Button>
        {present && (
          <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
