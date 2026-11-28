import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { toast } from "sonner";
import { afterEach } from "vitest";

// Tests look at where things end up, not at the way there.
MotionGlobalConfig.skipAnimations = true;

// Screens are lazy-loaded, and the first import of each is compiled on demand, which can take over the 1s default
// when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });

// jsdom does not implement the modal parts of <dialog>. This minimal stand-in toggles the `open`
// attribute (which jsdom's default stylesheet uses for visibility) and fires `close`, which is
// enough for the dialog tests. Focus trapping and Esc handling are native-browser behaviour.
if (typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (this.hasAttribute("open")) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    }
  };
}

// jsdom has no pointer capture, which a toast takes when it is pressed (to be swiped away).
if (typeof Element !== "undefined" && typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

// jsdom has no ResizeObserver, which the chart library uses to size itself.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  // Sonner keeps its toasts outside React, so one test's message must not greet the next.
  toast.dismiss();
  cleanup();
});
