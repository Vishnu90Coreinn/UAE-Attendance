export function downloadPdf(blob: Blob, period: string): void {
  saveBlob(blob, `Payroll_${period}.pdf`);
}

export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Let the browser start consuming the URL before releasing its backing storage.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
