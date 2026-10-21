import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { ConfirmDialog } from "../../components/ConfirmDialog";

/** Mounted by the application route, which runs within a data router. */
export function AttendanceNavigationGuard({
  dirty,
  pending,
}: {
  dirty: boolean;
  pending: boolean;
}) {
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state === "blocked" && !dirty && !pending) blocker.proceed();
  }, [blocker, dirty, pending]);
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      title="Discard unsaved changes?"
      message="Your attendance edits have not been saved. Leaving this page will discard them."
      confirmLabel="Discard changes"
      pending={pending}
      onCancel={() => blocker.state === "blocked" && blocker.reset()}
      onConfirm={() => blocker.state === "blocked" && blocker.proceed()}
    />
  );
}
