export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MAX_FILES = 5;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png"];
/** Phone photos are shrunk to this longest side: still readable, far smaller to upload. */
const MAX_SIDE = 2000;

/** Null when the file can be attached, otherwise what is wrong with it. */
export function receiptProblem(file: File): string | null {
  if (!ALLOWED.includes(file.type)) return `${file.name}: attach a PDF, JPEG or PNG file.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  if (file.size > RECEIPT_MAX_BYTES) return `${file.name}: each file must be 5 MB or smaller.`;
  return null;
}

/** Re-encodes a large photo as a smaller JPEG. Anything else, or any failure, returns the file untouched. */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1024 * 1024 || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
