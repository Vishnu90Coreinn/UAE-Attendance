import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import { useIsDesktop } from "../utils/useIsDesktop";

/**
 * Results of actions, said once in the corner the eye can find without scrolling back up the page. Field errors and
 * anything that stops the user carrying on stay inline, next to what they are about.
 */
export const notify = {
  /** Goes away by itself; the record it speaks of is on the page. */
  success(message: string) {
    toast.success(message, { duration: 6000 });
  },
  /** A failure with no better place on the page. Stays until dismissed, and a repeat does not stack. */
  error(message: string) {
    toast.error(message, { id: message, duration: Infinity });
  },
};

/** The one toaster, mounted by App. On a phone it floats above the tab bar. */
export function AppToaster() {
  const desktop = useIsDesktop();
  const offset = desktop ? { bottom: "1.5rem", right: "1.5rem" } : { bottom: "calc(4.75rem + env(safe-area-inset-bottom))", left: "1rem", right: "1rem" };
  return (
    <Toaster
      position={desktop ? "bottom-right" : "bottom-center"}
      offset={offset}
      mobileOffset={offset}
      closeButton
      visibleToasts={3}
      icons={{
        success: <CircleCheck aria-hidden="true" size={18} />,
        error: <CircleAlert aria-hidden="true" size={18} />,
        loading: <Loader2 aria-hidden="true" size={18} className="animate-spin" />,
      }}
      toastOptions={{ closeButtonAriaLabel: "Dismiss" }}
    />
  );
}
