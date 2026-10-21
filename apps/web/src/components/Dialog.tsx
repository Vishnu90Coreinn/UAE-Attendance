import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { X } from "lucide-react";

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
  /** "sheet" slides up from the bottom edge of a phone screen; the default is a centred modal. */
  variant?: "center" | "sheet";
}

const CENTER_CLASS =
  "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border border-gray-200 bg-white p-6 text-gray-800 shadow-sm backdrop:bg-slate-900/60";
const SHEET_CLASS =
  "mx-0 mb-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-b-none rounded-t-2xl border border-gray-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-gray-800 shadow-lg backdrop:bg-slate-900/60";

/**
 * Modal built on the native <dialog>: showModal() gives the focus trap and an inert page behind it.
 * The parent owns `open`. Children are mounted only while it is open, so every opening starts with
 * fresh state, and focus goes back to whatever opened the dialog when it closes.
 */
export function Dialog({ open, onClose, title, children, initialFocusRef, descriptionId, variant = "center" }: DialogProps) {
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

  // A tap on the dimmed area outside a sheet closes it; the click lands on the dialog element itself.
  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (variant === "sheet" && event.target === event.currentTarget) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      aria-describedby={open ? descriptionId : undefined}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      className={variant === "sheet" ? SHEET_CLASS : CENTER_CLASS}
    >
      {variant === "sheet" ? (
        <div className="flex items-center justify-between gap-3">
          <h2 id={headingId} className="text-lg font-bold text-gray-800">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
      ) : (
        <h2 id={headingId} className="text-2xl font-bold text-gray-800">
          {title}
        </h2>
      )}
      {open && children}
    </dialog>
  );
}
