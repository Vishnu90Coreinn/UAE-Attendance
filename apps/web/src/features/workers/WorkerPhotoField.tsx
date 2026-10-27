import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImagePlus, Trash2, User } from "lucide-react";
import { getWorkerPhoto, type Worker } from "../../api/workers";
import { preparePhoto } from "../leave/photo";

export interface PhotoChange {
  /** A new JPEG portrait, base64 encoded. */
  photoBase64?: string;
  /** True when the stored photo should be cleared. */
  removePhoto?: boolean;
}

interface Props {
  worker: Worker | null;
  disabled: boolean;
  onChange: (change: PhotoChange) => void;
}

const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600";

/** Portrait (3:4) picker: camera or gallery, cropped and shrunk in the browser before it is sent. */
export function WorkerPhotoField({ worker, disabled, onChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  urlRef.current = url;

  // Show the stored photo when editing a worker who has one.
  useEffect(() => {
    if (!worker?.hasPhoto) return;
    let cancelled = false;
    getWorkerPhoto(worker.id)
      .then((blob) => {
        if (!cancelled) setUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (!cancelled) setError("The saved photo could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [worker]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const next = await preparePhoto(file, { maxSide: 800, aspect: 3 / 4 });
      if (url) URL.revokeObjectURL(url);
      setUrl(next.previewUrl);
      onChange({ photoBase64: next.base64 });
    } catch {
      setError("That image could not be read. Try another photo.");
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    setError(null);
    onChange({ removePhoto: true });
  }

  return (
    <fieldset disabled={disabled} className="flex items-start gap-4">
      <legend className="sr-only">Worker photo</legend>
      <div className="flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-300 bg-gray-50 text-gray-400">
        {url ? (
          <img src={url} alt="Worker photo preview" className="h-full w-full object-cover" />
        ) : (
          <User aria-hidden="true" size={40} />
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium text-gray-800">
          Worker photo <span className="font-normal text-gray-600">(optional)</span>
        </p>
        <p className="text-xs text-gray-600">Printed on the employee record PDF. Cropped to a portrait.</p>
        <div className="flex flex-wrap gap-2">
          <label className={`${buttonClass} cursor-pointer`}>
            <Camera aria-hidden="true" size={16} />
            Take photo
            <input type="file" accept="image/*" capture="user" className="sr-only" disabled={busy} onChange={pick} />
          </label>
          <label className={`${buttonClass} cursor-pointer`}>
            <ImagePlus aria-hidden="true" size={16} />
            Upload
            <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={pick} />
          </label>
          {url && (
            <button type="button" onClick={remove} className={buttonClass}>
              <Trash2 aria-hidden="true" size={16} />
              Remove
            </button>
          )}
        </div>
        {busy && (
          <p role="status" className="text-sm text-gray-600">
            Preparing photo...
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </fieldset>
  );
}
