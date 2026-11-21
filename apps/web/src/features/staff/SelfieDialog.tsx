import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, MapPin, MapPinOff } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { Button } from "../../ui";
import { ActionFailure } from "../workers/WorkersFeedback";
import { captureFrame, cameraAvailable, getPlace, type PlaceResult } from "./selfie";

interface Props {
  kind: "In" | "Out";
  onCancel: () => void;
  /** Called with the selfie and where the employee is; the caller sends it and closes the dialog. */
  onConfirm: (selfieBase64: string, place: PlaceResult) => Promise<void>;
}

/** Opens the front camera and the location together, and returns a live selfie. There is no way to pick a file. */
export function SelfieDialog({ kind, onCancel, onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!cameraAvailable()) {
      setCameraError("The camera needs a secure (HTTPS) address. Open the app from its https:// link.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 960 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setCameraError("The camera is blocked. Allow camera access for this site, then try again.");
      });
    void getPlace().then((result) => {
      if (!cancelled) setPlace(result);
    });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function confirm() {
    const video = videoRef.current;
    const frame = video ? captureFrame(video) : null;
    if (!frame) {
      setFailure("The camera is not ready yet. Wait a moment and try again.");
      return;
    }
    setSending(true);
    setFailure(null);
    try {
      await onConfirm(frame, place ?? (await getPlace(4000)));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setSending(false);
    }
  }

  const label = kind === "In" ? "Sign in" : "Sign out";
  return (
    <Dialog open onClose={sending ? () => undefined : onCancel} title={`${label}: take a selfie`}>
      <p className="mt-1 text-sm text-ink-600">
        A live photo is taken at every sign-in and sign-out, and your location is recorded with it.
      </p>
      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-ink-900">
        {cameraError ? (
          <p role="alert" className="p-6 text-sm text-white">
            {cameraError}
          </p>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Camera preview"
            onPlaying={() => setReady(true)}
            className="aspect-square w-full -scale-x-100 object-cover"
          />
        )}
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-ink-700" role="status">
        {place === null ? (
          <>
            <Loader2 aria-hidden="true" size={16} className="animate-spin" /> Finding your location...
          </>
        ) : place.ok ? (
          <>
            <MapPin aria-hidden="true" size={16} className="text-green-700" /> Location recorded (within {Math.round(place.place.accuracyMeters)} m).
          </>
        ) : (
          <>
            <MapPinOff aria-hidden="true" size={16} className="shrink-0 text-amber-700" /> {place.reason} You can still continue; your manager will see it was not recorded.
          </>
        )}
      </p>
      {failure && (
        <div className="mt-3">
          <ActionFailure message={failure} />
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        <Button icon={sending ? Loader2 : Camera} onClick={confirm} disabled={sending || !ready || !!cameraError}>
          {sending ? "Saving..." : `Take selfie and ${label.toLowerCase()}`}
        </Button>
      </div>
    </Dialog>
  );
}
