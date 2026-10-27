import { useEffect, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { ApiError } from "../../api/client";
import { getLeaveAttachment, type LeaveRequest } from "../../api/leave";
import { ActionFailure } from "../workers/WorkersFeedback";

interface Props {
  row: LeaveRequest;
  onClose: () => void;
}

/** Shows the photo attached to a leave request, fetched with the sign-in token and shown from a temporary blob URL. */
export function LeavePhotoDialog({ row, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    getLeaveAttachment(row.id)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof ApiError ? reason.message : "The photo could not be loaded.");
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [row.id]);
  return (
    <Dialog open title="Leave document" onClose={onClose} size="wide">
      <p className="mt-1 text-sm text-gray-600">
        {row.workerName} · {row.leaveType} · {row.startDate} to {row.endDate}
      </p>
      <div className="mt-4">
        {error ? (
          <ActionFailure message={error} />
        ) : url ? (
          <img
            src={url}
            alt={`Photo attached to ${row.workerName}'s ${row.leaveType} request`}
            className="mx-auto max-h-[70dvh] max-w-full rounded-lg border border-gray-200 object-contain"
          />
        ) : (
          <p role="status" className="py-8 text-center text-gray-600">Loading photo...</p>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-lg border border-gray-300 px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Close
        </button>
      </div>
    </Dialog>
  );
}
