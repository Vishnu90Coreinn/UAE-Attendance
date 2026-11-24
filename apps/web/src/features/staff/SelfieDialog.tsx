import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, MapPin, MapPinOff, RotateCcw, WifiOff } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { phoneButton } from "../../components/phoneUi";
import { Button } from "../../ui";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { ActionFailure } from "../workers/WorkersFeedback";
import { useOnline } from "./staffKit";
import { captureFrame, cameraAvailable, getPlace, type PlaceResult } from "./selfie";

interface Props {
  kind: "In" | "Out";
  onCancel: () => void;
  /** Called with the selfie and where the employee is; the caller sends it and closes the dialog. */
  onConfirm: (selfieBase64: string, place: PlaceResult) => Promise<void>;
}

/**
 * Opens the front camera and the location together. The employee takes the photo, looks at it, and only then sends it,
 * so a thumb over the lens or a dark frame is retaken instead of becoming the record. There is no way to pick a file.
 */
export function SelfieDialog({ kind, onCancel, onConfirm }: Props) {
  const desktop = useIsDesktop();
  const online = useOnline();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const findPlace = useCallback(() => {
    setPlace(null);
    void getPlace().then((result) => {
      if (alive.current) setPlace(result);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setCameraError(null);
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
        if (!cancelled) setCameraError("The camera is blocked. Tap the lock beside the address, allow Camera, then try again.");
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    alive.current = true;
    findPlace();
    return () => {
      alive.current = false;
    };
  }, [findPlace]);

  function takePhoto() {
    const video = videoRef.current;
    const frame = video ? captureFrame(video) : null;
    if (!frame) {
      setFailure("The camera is not ready yet. Wait a moment and try again.");
      return;
    }
    setFailure(null);
    setShot(frame);
  }

  async function send() {
    if (!shot) return;
    setSending(true);
    setFailure(null);
    try {
      await onConfirm(shot, place ?? (await getPlace(4000)));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setSending(false);
    }
  }

  const label = kind === "In" ? "Sign in" : "Sign out";
  const frame = cameraError ? "w-full rounded-2xl" : desktop ? "aspect-square w-full rounded-lg" : "mx-auto aspect-square w-[min(72vw,17rem)] rounded-full";
  return (
    <Dialog open onClose={sending ? () => undefined : onCancel} title={`${label}: take a selfie`} variant={desktop ? "center" : "sheet"}>
      <p className="mt-1 text-sm text-ink-600">
        {shot ? "Is your face clear? If not, take it again." : "Face the camera in good light. Your location is recorded with the photo."}
      </p>
      <div className={`mt-4 overflow-hidden border border-line bg-ink-900 ${frame}`}>
        {cameraError ? (
          <div role="alert" className="flex min-h-44 flex-col items-center justify-center gap-3 p-5 text-center text-sm text-white">
            {cameraError}
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={phoneButton("secondary", "sm")}>
              <RotateCcw aria-hidden="true" size={16} /> Try again
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="Camera preview"
              onPlaying={() => setReady(true)}
              className={`size-full -scale-x-100 object-cover ${shot ? "hidden" : ""}`}
            />
            {shot && <img src={`data:image/jpeg;base64,${shot}`} alt="Your selfie" className="size-full object-cover" />}
          </>
        )}
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm text-ink-700" role="status">
        {place === null ? (
          <>
            <Loader2 aria-hidden="true" size={16} className="mt-0.5 shrink-0 animate-spin" /> Finding your location...
          </>
        ) : place.ok ? (
          <>
            <MapPin aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-green-700" /> Location recorded (within {Math.round(place.place.accuracyMeters)} m).
          </>
        ) : (
          <>
            <MapPinOff aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-amber-700" />
            <span>
              {place.reason} You can still continue; your manager will see it was not recorded.{" "}
              <button type="button" onClick={findPlace} className="font-semibold text-brand-700 underline underline-offset-2">
                Try location again
              </button>
            </span>
          </>
        )}
      </p>
      {!online && shot && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-800">
          <WifiOff aria-hidden="true" size={16} className="mt-0.5 shrink-0" /> No connection. Your photo is kept; reconnect, then send it.
        </p>
      )}
      {failure && (
        <div className="mt-3">
          <ActionFailure message={failure} />
        </div>
      )}
      {desktop ? (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {shot ? (
            <Button variant="secondary" onClick={() => setShot(null)} disabled={sending}>
              Retake
            </Button>
          ) : (
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {shot ? (
            <Button icon={sending ? Loader2 : Check} onClick={send} disabled={sending || !online}>
              {sending ? "Saving..." : `Use photo and ${label.toLowerCase()}`}
            </Button>
          ) : (
            <Button icon={Camera} onClick={takePhoto} disabled={!ready || !!cameraError}>
              Take photo
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {shot ? (
            <>
              <button type="button" onClick={send} disabled={sending || !online} className={phoneButton("primary", "lg", "w-full")}>
                {sending ? <Loader2 aria-hidden="true" size={20} className="animate-spin" /> : <Check aria-hidden="true" size={20} />}
                {sending ? "Saving..." : `Use photo and ${label.toLowerCase()}`}
              </button>
              <button type="button" onClick={() => setShot(null)} disabled={sending} className={phoneButton("secondary", "md", "w-full")}>
                <RotateCcw aria-hidden="true" size={18} /> Retake
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={takePhoto} disabled={!ready || !!cameraError} className={phoneButton("primary", "lg", "w-full")}>
                <Camera aria-hidden="true" size={20} />
                {ready || cameraError ? "Take photo" : "Starting camera..."}
              </button>
              <button type="button" onClick={onCancel} className={phoneButton("quiet", "md", "w-full")}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
