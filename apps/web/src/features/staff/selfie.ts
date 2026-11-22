/** Longest side of a stored selfie. A face is recognisable at this size and the file stays small. */
export const SELFIE_MAX_SIDE = 640;

/** Draws the current video frame to a canvas and returns it as base64 JPEG (no data: prefix). */
export function captureFrame(video: HTMLVideoElement): string | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, SELFIE_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.7);
  const comma = url.indexOf(",");
  return comma === -1 ? null : url.slice(comma + 1);
}

export interface Place {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export type PlaceResult = { ok: true; place: Place } | { ok: false; reason: string };

/** The device's position, or why there is none. A missing position never blocks signing in. */
export function getPlace(timeoutMs = 12000): Promise<PlaceResult> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ ok: false, reason: "This device cannot share its location." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          place: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          },
        }),
      (error) =>
        resolve({
          ok: false,
          reason:
            error.code === error.PERMISSION_DENIED
              ? "Location is blocked. Allow location access in your browser to record where you signed in."
              : "Your location could not be found.",
        }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/** True when the page may use the camera (a secure address, or localhost). */
export function cameraAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}
