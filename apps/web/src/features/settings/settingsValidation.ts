import type { PayrollSettings } from "../../api/settings";
import { formatRate } from "../../utils/money";

/** Form fields are named exactly like the API's body properties, so server errors map one to one. */
export type SettingsField = keyof PayrollSettings;

/** Form order, which is also the order errors are listed and the first invalid field is focused. */
export const FIELD_ORDER: readonly SettingsField[] = [
  "companyName",
  "tagline",
  "contactEmail",
  "overtimeRatePerHour",
  "maxBasicHoursPerDay",
  "shiftDescription",
  "preparedByLabel",
  "approvedByLabel",
];

export type SettingsFormValues = Record<SettingsField, string>;
export type FieldMessages = Partial<Record<SettingsField, string>>;

const MAX_COMPANY_NAME = 120;
const MAX_TAGLINE = 200;
const MAX_EMAIL = 120;
const MAX_SHIFT = 60;
const MAX_LABEL = 60;
const MAX_OVERTIME_RATE = 999.99;
const MAX_BASIC_HOURS = 24;

const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d+)$/;
/** Deliberately lenient ("email-like"): the server is the authority and must never be stricter than this. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/** The API's validation keys (camelCase, compared case-insensitively) mapped to form fields. */
export function fieldForServerKey(key: string): SettingsField | undefined {
  return FIELD_ORDER.find((field) => field.toLowerCase() === key.toLowerCase());
}

export function toFormValues(settings: PayrollSettings): SettingsFormValues {
  return {
    companyName: settings.companyName,
    tagline: settings.tagline,
    contactEmail: settings.contactEmail,
    overtimeRatePerHour: formatRate(settings.overtimeRatePerHour),
    maxBasicHoursPerDay: String(settings.maxBasicHoursPerDay),
    shiftDescription: settings.shiftDescription,
    preparedByLabel: settings.preparedByLabel,
    approvedByLabel: settings.approvedByLabel,
  };
}

function trimValues(values: SettingsFormValues): SettingsFormValues {
  const result = { ...values };
  for (const field of FIELD_ORDER) {
    result[field] = values[field].trim();
  }
  return result;
}

/** Trimmed text and canonical numbers, so "2.220" and " 2.22 " count as the value already saved. */
function normalizeValues(values: SettingsFormValues): SettingsFormValues {
  const result = trimValues(values);
  for (const field of ["overtimeRatePerHour", "maxBasicHoursPerDay"] as const) {
    if (NUMBER_PATTERN.test(result[field])) {
      result[field] = String(Number(result[field]));
    }
  }
  return result;
}

export function hasChanged(values: SettingsFormValues, saved: SettingsFormValues): boolean {
  const current = normalizeValues(values);
  const baseline = normalizeValues(saved);
  return FIELD_ORDER.some((field) => current[field] !== baseline[field]);
}

function decimalPlaces(text: string): number {
  return text.split(".")[1]?.length ?? 0;
}

function validateOvertimeRate(text: string): string | undefined {
  if (text === "") {
    return "Enter the overtime rate.";
  }
  if (!NUMBER_PATTERN.test(text)) {
    return "Enter the overtime rate as a number, for example 2.50.";
  }
  const rate = Number(text);
  if (rate < 0) {
    return "Overtime rate cannot be negative.";
  }
  if (decimalPlaces(text) > 2) {
    return "Overtime rate can have at most 2 decimal places.";
  }
  if (rate > MAX_OVERTIME_RATE) {
    return `Overtime rate must be at most ${MAX_OVERTIME_RATE}.`;
  }
  return undefined;
}

function validateBasicHours(text: string): string | undefined {
  if (text === "") {
    return "Enter the maximum basic hours per day.";
  }
  if (!NUMBER_PATTERN.test(text)) {
    return "Enter the maximum basic hours as a number, for example 8.";
  }
  const hours = Number(text);
  if (hours <= 0) {
    return "Maximum basic hours must be greater than 0.";
  }
  if (decimalPlaces(text) > 2) {
    return "Maximum basic hours can have at most 2 decimal places.";
  }
  if (hours > MAX_BASIC_HOURS) {
    return `Maximum basic hours must be at most ${MAX_BASIC_HOURS}.`;
  }
  return undefined;
}

function validateRequiredText(text: string, max: number, missing: string, name: string): string | undefined {
  if (text === "") {
    return missing;
  }
  if (text.length > max) {
    return `${name} must be at most ${max} characters.`;
  }
  return undefined;
}

/** Client-side mirror of the server's settings rules; the server stays the authority. */
export function validateSettings(values: SettingsFormValues): FieldMessages {
  const text = trimValues(values);
  const errors: FieldMessages = {};

  errors.companyName = validateRequiredText(text.companyName, MAX_COMPANY_NAME, "Enter the company name.", "Company name");

  if (text.tagline.length > MAX_TAGLINE) {
    errors.tagline = `Tagline must be at most ${MAX_TAGLINE} characters.`;
  }

  if (text.contactEmail === "") {
    errors.contactEmail = "Enter the contact email.";
  } else if (text.contactEmail.length > MAX_EMAIL) {
    errors.contactEmail = `Contact email must be at most ${MAX_EMAIL} characters.`;
  } else if (!EMAIL_PATTERN.test(text.contactEmail)) {
    errors.contactEmail = "Enter a valid email address, for example hr@example.com.";
  }

  errors.overtimeRatePerHour = validateOvertimeRate(text.overtimeRatePerHour);
  errors.maxBasicHoursPerDay = validateBasicHours(text.maxBasicHoursPerDay);
  errors.shiftDescription = validateRequiredText(
    text.shiftDescription,
    MAX_SHIFT,
    "Enter the shift description.",
    "Shift description",
  );
  errors.preparedByLabel = validateRequiredText(
    text.preparedByLabel,
    MAX_LABEL,
    "Enter the Prepared by label.",
    "Prepared by",
  );
  errors.approvedByLabel = validateRequiredText(
    text.approvedByLabel,
    MAX_LABEL,
    "Enter the Approved by label.",
    "Approved by",
  );

  for (const field of FIELD_ORDER) {
    if (errors[field] === undefined) {
      delete errors[field];
    }
  }
  return errors;
}

/** Only call this for values that passed validateSettings. */
export function toSettingsBody(values: SettingsFormValues): PayrollSettings {
  const text = trimValues(values);
  return {
    companyName: text.companyName,
    tagline: text.tagline,
    contactEmail: text.contactEmail,
    overtimeRatePerHour: Number(text.overtimeRatePerHour),
    maxBasicHoursPerDay: Number(text.maxBasicHoursPerDay),
    shiftDescription: text.shiftDescription,
    preparedByLabel: text.preparedByLabel,
    approvedByLabel: text.approvedByLabel,
  };
}
