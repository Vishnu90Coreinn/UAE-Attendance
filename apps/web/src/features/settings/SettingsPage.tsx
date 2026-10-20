import { useEffect, useRef, useState, type FormEvent } from "react";
import { Info, Loader2, Save } from "lucide-react";
import { ApiError } from "../../api/client";
import { getPayrollSettings, updatePayrollSettings } from "../../api/settings";
import { TextField } from "../../components/TextField";
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

const sectionClass = "space-y-4";
const sectionTitleClass = "text-lg font-semibold text-gray-800";

export function SettingsPage() {
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
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Settings</h2>
        <p className="text-sm text-gray-500">Company details and payroll rates.</p>
      </div>

      {load.status === "loading" && (
        <p role="status" className="flex items-center gap-2 py-8 text-sm text-gray-500">
          <Loader2 aria-hidden="true" size={20} className="animate-spin" />
          Loading settings...
        </p>
      )}
      {load.status === "error" && <LoadError message={load.message} onRetry={retry} />}

      {load.status === "ready" && values && (
        <>
          <SuccessRegion message={success} />
          <form
            onSubmit={handleSubmit}
            noValidate
            className="max-w-3xl space-y-8 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6"
          >
            <div className={sectionClass}>
              <h3 className={sectionTitleClass}>Company</h3>
              <TextField label="Company name" autoComplete="off" {...field("companyName")} />
              <TextField label="Tagline" autoComplete="off" {...field("tagline")} />
              <TextField label="Contact email" type="email" autoComplete="off" {...field("contactEmail")} />
            </div>

            <div className={sectionClass}>
              <h3 className={sectionTitleClass}>Payroll</h3>
              <p className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <Info aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
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
              <TextField label="Shift description" autoComplete="off" {...field("shiftDescription")} />
            </div>

            <div className={sectionClass}>
              <h3 className={sectionTitleClass}>Payroll report signatures</h3>
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

            <div className="flex flex-wrap items-center justify-end gap-3">
              {!dirty && !pending && <p className="text-sm text-gray-500">No changes to save.</p>}
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
            </div>
          </form>
        </>
      )}
    </section>
  );
}
