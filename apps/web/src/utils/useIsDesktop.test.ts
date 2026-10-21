import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { mockViewport, restoreViewport } from "../test-viewport";
import { useIsDesktop } from "./useIsDesktop";

afterEach(restoreViewport);

it("assumes desktop when the browser cannot report its width", () => {
  const { result } = renderHook(() => useIsDesktop());
  expect(result.current).toBe(true);
});

it("reports a phone below the desktop breakpoint", () => {
  mockViewport("phone");
  const { result } = renderHook(() => useIsDesktop());
  expect(result.current).toBe(false);
});

it("follows the window when it is resized across the breakpoint", () => {
  const viewport = mockViewport("phone");
  const { result } = renderHook(() => useIsDesktop());

  act(() => viewport.resize("desktop"));
  expect(result.current).toBe(true);

  act(() => viewport.resize("phone"));
  expect(result.current).toBe(false);
});
