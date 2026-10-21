import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

// jsdom has no ResizeObserver, which the chart library uses to size itself.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
});
