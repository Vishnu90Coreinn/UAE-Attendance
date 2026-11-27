import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { ConfirmDialog } from "./ConfirmDialog";

/** Mounted by the application route, which runs within a data router. */
export function UnsavedChangesGuard({
  dirty,
  pending,
  subject = "attendance edits",
  cancelLabel,
}: {
  dirty: boolean;
  pending: boolean;
  /** What would be lost, in the sentence "Your ... have not been saved." */
  subject?: string;
  cancelLabel?: string;
}) {
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state === "blocked" && !dirty && !pending) blocker.proceed();
  }, [blocker, dirty, pending]);
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      title="Discard unsaved changes?"
      message={`Your ${subject} have not been saved. Leaving this page will discard them.`}
      confirmLabel="Discard changes"
      cancelLabel={cancelLabel}
      pending={pending}
      onCancel={() => blocker.state === "blocked" && blocker.reset()}
      onConfirm={() => blocker.state === "blocked" && blocker.proceed()}
    />
  );
}
