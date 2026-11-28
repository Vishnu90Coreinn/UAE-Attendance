import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, expect, it } from "vitest";
import { restoreViewport } from "../test-viewport";
import { Arrive, Draw, Mark, PageEnter } from "./motion";

// Its own file: the library reads the "reduce motion" setting once, the first time anything asks.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterAll(restoreViewport);

it("renders everything at rest when the device asks for reduced motion", () => {
  render(
    <PageEnter>
      <Arrive>
        <p>Total balance</p>
      </Arrive>
      <Draw aria-label="share" role="img" style={{ width: "40%" }} />
    </PageEnter>,
  );
  // No hidden or half-drawn starting frame, not even for the first paint.
  expect(screen.getByText("Total balance").parentElement!.style.opacity).not.toBe("0");
  expect(screen.getByRole("img", { name: "share" }).style.clipPath).toBe("");
  expect(screen.getByRole("img", { name: "share" }).style.width).toBe("40%");
});

it("does not underline a changed figure", () => {
  const { container, rerender } = render(<Mark value={1}>1</Mark>);
  rerender(<Mark value={2}>2</Mark>);
  expect(container.querySelector("[data-mark]")).toBeNull();
});
