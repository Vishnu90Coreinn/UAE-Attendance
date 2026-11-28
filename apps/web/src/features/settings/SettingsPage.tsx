import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card, CardHeader, LoadingState, PageHeader, sectionLinkClass, sectionNavClass } from "../../ui";
import { Loader2, Save, TriangleAlert } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import type { LayoutContext } from "../../components/LayoutContext";
import { ApiError } from "../../api/client";
import { getPayrollSettings, updatePayrollSettings } from "../../api/settings";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { TextField } from "../../components/TextField";
import { CompanyDocumentsCard } from "./CompanyDocumentsCard";
import { StaffSettingsCard } from "../staff/StaffSettingsCard";
import { LoadError, primaryButtonClass, SuccessRegion } from "../workers/WorkersFeedback";
import {
  FIELD_ORDER,
  fieldForServerKey,
  hasChanged,
  toFormValues,
  toSettingsBody,
  validateSettings,
  type FieldMessages,
  type SettingsField,
  type SettingsFormValues,
} from "./settingsValidation";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

const GENERIC_FAILURE = "Something went wrong. Please try again.";

function failureMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_FAILURE;
}


/** The section links. They stay in view while scrolling, and the one for the section on screen is marked. */
function SectionNav({ showStaff }: { showStaff: boolean }) {
  const sections: [string, string][] = [
    ["company", "Company"],
    ["payroll", "Payroll"],
    ["signatures", "Signatures"],
    ["documents", "Documents"],
    ...(showStaff ? ([["office-staff", "Office staff"], ["finance", "Finance"]] as [string, string][]) : []),
  ];
  const [active, setActive] = useState("company");
  useEffect(() => {
    // The section being read is the last one whose top has scrolled past the sticky bar. Sections that load late
    // are simply picked up the next time the page moves.
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = sections[0][0];
      for (const [id] of sections) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= 140) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    // Capture, because the page may scroll inside a container rather than the window itself.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    const settle = window.setInterval(update, 1000); // catches a section that finishes loading while the page is still
    const stop = window.setTimeout(() => window.clearInterval(settle), 8000);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      window.clearInterval(settle);
      window.clearTimeout(stop);
      if (frame) window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStaff]);
  return (
    <nav aria-label="Settings sections" className={`sticky top-0 z-20 mb-4 bg-canvas/95 backdrop-blur ${sectionNavClass}`}>
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={active === id ? "true" : undefined}
          onClick={() => setActive(id)}
          className={sectionLinkClass(active === id)}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  /** HR can read the settings but only a Manager or Administrator can change them. */
  const readOnly = !isManagement(user?.role);
  const layout = useOutletContext<LayoutContext | null>();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** The last values the server confirmed; "nothing changed" is measured against these. */
  const [saved, setSaved] = useState<SettingsFormValues | null>(null);
  const [values, setValues] = useState<SettingsFormValues | null>(null);
  const [touched, setTouched] = useState<Partial<Record<SettingsField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldMessages>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputs = useRef<Partial<Record<SettingsField, HTMLInputElement | null>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getPayrollSettings();
        if (cancelled) {
          return;
        }
        const formValues = toFormValues(settings);
        setSaved(formValues);
        setValues(formValues);
        setLoad({ status: "ready" });
      } catch (error) {
        if (!cancelled) {
          setLoad({ status: "error", message: failureMessage(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setLoad({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  const clientErrors = values ? validateSettings(values) : {};
  const shown: FieldMessages = {};
  for (const field of FIELD_ORDER) {
    const message = (touched[field] ? clientErrors[field] : undefined) ?? serverErrors[field];
    if (message) {
      shown[field] = message;
    }
  }
  const summary = [...FIELD_ORDER.map((field) => shown[field]), generalError].filter((m): m is string => !!m);
  const dirty = values !== null && saved !== null && hasChanged(values, saved);

  function change(field: SettingsField, value: string) {
    setValues((current) => (current ? { ...current, [field]: value } : current));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
    setGeneralError(null);
    setSuccess(null);
  }

  function showServerFailure(error: unknown) {
    const mapped: FieldMessages = {};
    const unmapped: string[] = [];
    if (error instanceof ApiError && error.fieldErrors) {
      for (const [key, messages] of Object.entries(error.fieldErrors)) {
        const field = fieldForServerKey(key);
        if (field) {
          mapped[field] = messages.join(" ");
        } else {
          unmapped.push(...messages);
        }
      }
    }
    setServerErrors(mapped);
    if (unmapped.length > 0) {
      setGeneralError(unmapped.join(" "));
    } else if (Object.keys(mapped).length === 0) {
      setGeneralError(failureMessage(error));
    }
    const firstServerField = FIELD_ORDER.find((field) => mapped[field]);
    if (firstServerField) {
      inputs.current[firstServerField]?.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !values || !dirty) {
      return;
    }
    setTouched(Object.fromEntries(FIELD_ORDER.map((field) => [field, true])));
    setGeneralError(null);
    setSuccess(null);

    const firstInvalid = FIELD_ORDER.find((field) => clientErrors[field]);
    if (firstInvalid) {
      inputs.current[firstInvalid]?.focus();
      return;
    }

    setPending(true);
    setServerErrors({});
    try {
      const stored = await updatePayrollSettings(toSettingsBody(values));
      layout?.onPayrollSettingsChanged(stored);
      const formValues = toFormValues(stored);
      setSaved(formValues);
      setValues(formValues);
      setTouched({});
      setSuccess("Settings saved.");
    } catch (error) {
      showServerFailure(error);
    } finally {
      setPending(false);
    }
  }

  function field(name: SettingsField) {
    return {
      name,
      value: values?.[name] ?? "",
      error: shown[name],
      readOnly: pending,
      inputRef: (element: HTMLInputElement | null) => {
        inputs.current[name] = element;
      },
      onChange: (event: { target: { value: string } }) => change(name, event.target.value),
      onBlur: () => setTouched((current) => ({ ...current, [name]: true })),
    };
  }

  return (
    <section>
      <PageHeader title="Settings" description="Company details, payroll rates, documents and office staff attendance." />
      <SectionNav showStaff={!readOnly} />

      {load.status === "loading" && (
        <LoadingState label="Loading settings..." rows={4} />
      )}
      {load.status === "error" && <LoadError message={load.message} onRetry={retry} />}

      {load.status === "ready" && values && (
        <>
          <SuccessRegion message={success} />
          <form
            onSubmit={handleSubmit}
            noValidate
            className="max-w-4xl space-y-6"
          >
            <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-6 border-0 p-0">
            <Card id="company" className="scroll-mt-20">
              <CardHeader title="Company" description="The name and contact details shown on payroll reports and payslips." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <TextField label="Company name" autoComplete="off" {...field("companyName")} />
                </div>
                <TextField label="Tagline" autoComplete="off" {...field("tagline")} />
                <TextField label="Contact email" type="email" autoComplete="off" {...field("contactEmail")} />
              </div>
            </Card>

            <Card id="payroll" className="scroll-mt-20">
              <CardHeader title="Payroll" description="Rates and hours used to work out site workers' pay." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
              <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2">
                <TriangleAlert aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
                Changing the overtime rate recalculates every month that is not finalised.
              </p>
              <TextField
                label="Overtime rate (AED/hr)"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                {...field("overtimeRatePerHour")}
              />
              <TextField
                label="Maximum basic hours per day"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                {...field("maxBasicHoursPerDay")}
              />
              <div className="sm:col-span-2">
                <TextField label="Shift description" autoComplete="off" {...field("shiftDescription")} />
              </div>
              </div>
            </Card>

            <Card id="signatures" className="scroll-mt-20">
              <CardHeader title="Payroll report signatures" description="The titles printed under the signature lines of the payroll report." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
              <TextField
                label="Prepared by"
                autoComplete="off"
                hint="The title printed under the Prepared by signature line."
                {...field("preparedByLabel")}
              />
              <TextField
                label="Approved by"
                autoComplete="off"
                hint="The title printed under the Approved by signature line."
                {...field("approvedByLabel")}
              />
              </div>
            </Card>

            </fieldset>

            {summary.length > 0 && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <p className="font-medium">Please fix the following:</p>
                <ul className="mt-1 list-disc pl-5">
                  {summary.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {!readOnly && <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-card border border-line bg-white/95 px-4 py-3 shadow-pop backdrop-blur">
              {dirty && !pending && <p className="mr-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Unsaved changes</p>}
              {!dirty && !pending && <p className="text-sm text-ink-600">No changes to save.</p>}
              <button
                type="submit"
                disabled={pending || !dirty}
                aria-busy={pending}
                className={`${primaryButtonClass} text-base disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {pending ? (
                  <>
                    <Loader2 aria-hidden="true" size={16} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save aria-hidden="true" size={16} />
                    Save settings
                  </>
                )}
              </button>
            </div>}
          </form>
        </>
      )}
      <div id="documents" className="max-w-4xl scroll-mt-20">
        <CompanyDocumentsCard readOnly={readOnly} />
      </div>
      {!readOnly && <StaffSettingsCard />}
      {!readOnly && (
        <div id="finance" className="max-w-4xl scroll-mt-20">
          <Card>
            <CardHeader title="Finance" description="The expense and income categories with their VAT, the month lock, and who may enter expenses have moved to their own page, next to the finance screens." />
            <div className="px-5 pb-5"><a href="/finance/setup" className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">Open Finance setup</a></div>
          </Card>
        </div>
      )}
    </section>
  );
}
