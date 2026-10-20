import type { WorkerInput } from "../../api/workers";

export type WorkerField = "workerCode" | "fullName" | "designation" | "hourlyRate";

/** Form order, which is also the order errors are listed and the first invalid field is focused. */
export const FIELD_ORDER: readonly WorkerField[] = ["workerCode", "fullName", "designation", "hourlyRate"];

export type WorkerFormValues = Record<WorkerField, string>;
export type FieldMessages = Partial<Record<WorkerField, string>>;

const MAX_CODE = 20;
const MAX_NAME = 120;
const MAX_DESIGNATION = 80;
const MAX_RATE = 999.99;

const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d+)$/;

/** The API's validation keys (camelCase, compared case-insensitively) mapped to form fields. */
export function fieldForServerKey(key: string): WorkerField | undefined {
  return FIELD_ORDER.find((field) => field.toLowerCase() === key.toLowerCase());
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
  return errors;
}

/** Only call this for values that passed validateWorker. */
export function toWorkerInput(values: WorkerFormValues): WorkerInput {
  return {
    workerCode: values.workerCode.trim(),
    fullName: values.fullName.trim(),
    designation: values.designation.trim(),
    hourlyRate: Number(values.hourlyRate.trim()),
  };
}
