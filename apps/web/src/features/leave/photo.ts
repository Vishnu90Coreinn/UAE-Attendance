const QUALITY = 0.8;

interface PhotoOptions {
  /** Longest side of the result in pixels. */
  maxSide?: number;
  /** Width / height to centre-crop to, for example 3 / 4 for a portrait; omitted keeps the original shape. */
  aspect?: number;
}

/**
 * Shrinks a camera or gallery image to a JPEG, so a phone photo of several megabytes uploads as a few hundred
 * kilobytes. Returns the JPEG as base64 plus a preview URL the caller must revoke.
 */
export async function preparePhoto(
  file: File,
  { maxSide = 1600, aspect }: PhotoOptions = {},
): Promise<{ base64: string; previewUrl: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;
    if (aspect) {
      if (sw / sh > aspect) {
        sw = Math.round(sh * aspect);
        sx = Math.round((bitmap.width - sw) / 2);
      } else {
        sh = Math.round(sw / aspect);
        sy = Math.round((bitmap.height - sh) / 2);
      }
    }
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new Error("The image could not be converted.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(binary), previewUrl: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}
