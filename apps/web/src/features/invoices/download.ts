import { saveBlob } from "../payroll/downloadPdf";

/** Saves a downloaded file (PDF or CSV) under the given name. */
export function downloadFile(blob: Blob, fileName: string): void {
  saveBlob(blob, fileName);
}
