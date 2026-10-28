import type { WorkerInput } from "../../api/workers";

export type WorkerField =
  | "workerCode"
  | "fullName"
  | "designation"
  | "hourlyRate"
  | "monthlySalary"
  | "overtimeRate"
  | "joinDate"
  | "department"
  | "emiratesId"
  | "passportNumber"
  | "phone"
  | "email"
  | "emergencyContact"
  | "workLocation"
  | "notes";

/** Form order, which is also the order errors are listed and the first invalid field is focused. */
export const FIELD_ORDER: readonly WorkerField[] = [
  "workerCode",
  "fullName",
  "designation",
  "hourlyRate",
  "monthlySalary",
  "overtimeRate",
  "joinDate",
  "department",
  "emiratesId",
  "passportNumber",
  "phone",
  "email",
  "emergencyContact",
  "workLocation",
  "notes",
];

/** The onboarding checklist, in display order. Keys match the API's booleans. */
export const CHECKLIST = [
  { key: "contractSigned", label: "Labor Contract Signed" },
  { key: "visaMedicalCleared", label: "Visa & Medical Fitness" },
  { key: "safetyGearIssued", label: "Safety PPE Gear Issued" },
  { key: "siteOrientationDone", label: "Factory Site Orientation" },
  { key: "wpsRegistered", label: "WPS Payroll Registered" },
  { key: "badgeIssued", label: "ID Badge Printed & Issued" },
] as const;

export type ChecklistKey = (typeof CHECKLIST)[number]["key"];
export type ChecklistValues = Record<ChecklistKey, boolean>;

export type WorkerFormValues = Record<WorkerField, string>;
export type FieldMessages = Partial<Record<WorkerField, string>>;

const MAX_CODE = 20;
const MAX_NAME = 120;
const MAX_DESIGNATION = 80;
const MAX_RATE = 999.99;
const MAX_SALARY = 99999.99;
/** A month is always paid as 30 days of 8 hours. */
export const HOURS_PER_MONTH = 240;

/** The salary a typed hourly rate implies, rounded to 10 AED like the client's figures (6.67 -> 1600). */
export function salaryFromHourly(rate: number): number {
  const rounded = Math.round((rate * HOURS_PER_MONTH) / 10) * 10;
  return rounded > 0 ? rounded : Math.round(rate * HOURS_PER_MONTH * 100) / 100;
}

export function hourlyFromSalary(salary: number): number {
  return Math.round((salary / HOURS_PER_MONTH) * 100) / 100;
}

/** Optional profile fields and their length limits (mirroring the server) with the label used in messages. */
const OPTIONAL_TEXT: readonly { field: WorkerField; max: number; label: string }[] = [
  { field: "department", max: 80, label: "Department" },
  { field: "emiratesId", max: 25, label: "Emirates ID" },
  { field: "passportNumber", max: 20, label: "Passport number" },
  { field: "phone", max: 25, label: "Phone" },
  { field: "email", max: 120, label: "Email" },
  { field: "emergencyContact", max: 150, label: "Emergency contact" },
  { field: "workLocation", max: 120, label: "Work location" },
  { field: "notes", max: 1000, label: "Notes" },
];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d+)$/;

/** The API's validation keys (camelCase, compared case-insensitively) mapped to form fields. */
export function fieldForServerKey(key: string): WorkerField | undefined {
  return FIELD_ORDER.find((field) => field.toLowerCase() === key.toLowerCase());
}

function validateSalary(text: string): string | undefined {
  if (text === "") {
    return "Enter the monthly salary.";
  }
  if (!NUMBER_PATTERN.test(text)) {
    return "Enter the salary as a number, for example 1600.";
  }
  const salary = Number(text);
  if (salary <= 0) {
    return "Salary must be greater than 0.";
  }
  if ((text.split(".")[1]?.length ?? 0) > 2) {
    return "Salary can have at most 2 decimal places.";
  }
  if (salary > MAX_SALARY) {
    return `Salary must be at most ${MAX_SALARY}.`;
  }
  return undefined;
}

function validateRate(text: string): string | undefined {
  if (text === "") {
    return "Enter the base hourly rate.";
  }
  if (!NUMBER_PATTERN.test(text)) {
    return "Enter the rate as a number, for example 12.50.";
  }
  const rate = Number(text);
  if (rate <= 0) {
    return "Rate must be greater than 0.";
  }
  if ((text.split(".")[1]?.length ?? 0) > 2) {
    return "Rate can have at most 2 decimal places.";
  }
  if (rate > MAX_RATE) {
    return `Rate must be at most ${MAX_RATE}.`;
  }
  return undefined;
}

/** The overtime rate is optional: blank means "use the company rate", and 0 means no overtime pay. */
function validateOvertimeRate(text: string): string | undefined {
  if (text === "") {
    return undefined;
  }
  if (!NUMBER_PATTERN.test(text)) {
    return "Enter the overtime rate as a number, for example 2.50.";
  }
  const rate = Number(text);
  if (rate < 0) {
    return "Overtime rate cannot be negative.";
  }
  if ((text.split(".")[1]?.length ?? 0) > 2) {
    return "Overtime rate can have at most 2 decimal places.";
  }
  if (rate > MAX_RATE) {
    return `Overtime rate must be at most ${MAX_RATE}.`;
  }
  return undefined;
}

/** Client-side mirror of the server's worker rules (W1); the server stays the authority. */
export function validateWorker(values: WorkerFormValues): FieldMessages {
  const errors: FieldMessages = {};
  const code = values.workerCode.trim();
  const name = values.fullName.trim();
  const designation = values.designation.trim();

  if (code === "") {
    errors.workerCode = "Enter a worker ID.";
  } else if (code.length > MAX_CODE) {
    errors.workerCode = `Worker ID must be at most ${MAX_CODE} characters.`;
  } else if (!CODE_PATTERN.test(code)) {
    errors.workerCode = "Worker ID can only contain letters, numbers, hyphens and underscores.";
  }

  if (name === "") {
    errors.fullName = "Enter the full name.";
  } else if (name.length > MAX_NAME) {
    errors.fullName = `Full name must be at most ${MAX_NAME} characters.`;
  }

  if (designation === "") {
    errors.designation = "Enter the designation.";
  } else if (designation.length > MAX_DESIGNATION) {
    errors.designation = `Designation must be at most ${MAX_DESIGNATION} characters.`;
  }

  const rateError = validateRate(values.hourlyRate.trim());
  if (rateError) {
    errors.hourlyRate = rateError;
  }

  const salaryError = validateSalary(values.monthlySalary.trim());
  if (salaryError) {
    errors.monthlySalary = salaryError;
  }

  const overtimeError = validateOvertimeRate(values.overtimeRate.trim());
  if (overtimeError) {
    errors.overtimeRate = overtimeError;
  }

  for (const { field, max, label } of OPTIONAL_TEXT) {
    if (values[field].trim().length > max) {
      errors[field] = `${label} must be at most ${max} characters.`;
    }
  }
  const email = values.email.trim();
  if (!errors.email && email !== "" && !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
}

function optional(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** Only call this for values that passed validateWorker. A blank overtime rate becomes null (company rate). */
export function toWorkerInput(values: WorkerFormValues, checklist?: ChecklistValues): WorkerInput {
  const overtime = values.overtimeRate.trim();
  return {
    workerCode: values.workerCode.trim(),
    fullName: values.fullName.trim(),
    designation: values.designation.trim(),
    monthlySalary: Number(values.monthlySalary.trim()),
    hourlyRate: Number(values.hourlyRate.trim()),
    overtimeRate: overtime === "" ? null : Number(overtime),
    joinDate: values.joinDate.trim() === "" ? null : values.joinDate.trim(),
    department: optional(values.department),
    emiratesId: optional(values.emiratesId),
    passportNumber: optional(values.passportNumber),
    phone: optional(values.phone),
    email: optional(values.email),
    emergencyContact: optional(values.emergencyContact),
    workLocation: optional(values.workLocation),
    notes: optional(values.notes),
    ...checklist,
  };
}
