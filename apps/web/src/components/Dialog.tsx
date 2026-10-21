import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  /** Called for Esc and for the browser's own close request; the parent then sets `open` to false. */
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Element to focus when the dialog opens. Defaults to the first focusable element inside it. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Id of an element inside the dialog that describes it (read out after the title). */
  descriptionId?: string;
}

/**
 * Modal built on the native <dialog>: showModal() gives the focus trap and an inert page behind it.
 * The parent owns `open`. Children are mounted only while it is open, so every opening starts with
 * fresh state, and focus goes back to whatever opened the dialog when it closes.
 */
export function Dialog({ open, onClose, title, children, initialFocusRef, descriptionId }: DialogProps) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open) {
      if (!dialog.hasAttribute("open")) {
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      (initialFocusRef?.current ?? dialog.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    } else if (dialog.hasAttribute("open")) {
      dialog.close();
      openerRef.current?.focus();
      openerRef.current = null;
    }
  }, [open, initialFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  // The browser's own close request (for example the Android back gesture) arrives as `cancel`.
  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      aria-describedby={open ? descriptionId : undefined}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border border-gray-200 bg-white p-6 text-gray-800 shadow-sm backdrop:bg-slate-900/60"
    >
      <h2 id={headingId} className="text-2xl font-bold text-gray-800">
        {title}
      </h2>
      {open && children}
    </dialog>
  );
}
