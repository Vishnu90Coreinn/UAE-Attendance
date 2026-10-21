import { afterEach, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { registerServiceWorker } from "./registerServiceWorker";

const manifestFiles = import.meta.glob("../public/manifest.webmanifest", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const publicIcons = Object.keys(import.meta.glob("../public/icons/*.png", { query: "?url", eager: true }));

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

function manifest() {
  const text = manifestFiles["../public/manifest.webmanifest"];
  expect(text, "public/manifest.webmanifest exists").toBeTruthy();
  return JSON.parse(text) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: ManifestIcon[];
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

it("describes an installable standalone app", () => {
  const m = manifest();
  expect(m.name).toBe("HR & Payroll");
  expect(m.short_name).toBeTruthy();
  expect(m.short_name.length).toBeLessThanOrEqual(12);
  expect(m.start_url).toBe("/");
  expect(m.scope).toBe("/");
  expect(m.display).toBe("standalone");
  expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
});

it("lists 192 and 512 icons, including a maskable one, that exist on disk", () => {
  const { icons } = manifest();
  expect(icons.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
  expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
  expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  for (const icon of icons) {
    expect(icon.type).toBe("image/png");
    expect(publicIcons, `${icon.src} is missing from public/icons`).toContain(`../public${icon.src}`);
  }
});

it("links the manifest, theme colour and home-screen icons from the page", () => {
  expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest"');
  expect(indexHtml).toContain(`<meta name="theme-color" content="${manifest().theme_color}"`);
  expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
  expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
  expect(publicIcons).toContain("../public/icons/apple-touch-icon.png");
});

it("does not register the service worker outside production builds", () => {
  const register = vi.fn().mockResolvedValue({});
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
  vi.stubEnv("PROD", false);

  registerServiceWorker();
  window.dispatchEvent(new Event("load"));

  expect(register).not.toHaveBeenCalled();
});

it("registers /sw.js once the page has loaded in production", () => {
  const register = vi.fn().mockResolvedValue({});
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
  vi.stubEnv("PROD", true);

  registerServiceWorker();
  expect(register).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("load"));

  expect(register).toHaveBeenCalledWith("/sw.js");
});

it("keeps working when the browser has no service worker support", () => {
  vi.stubEnv("PROD", true);
  expect(() => {
    registerServiceWorker();
    window.dispatchEvent(new Event("load"));
  }).not.toThrow();
});

it("ignores a failed registration", async () => {
  const register = vi.fn().mockRejectedValue(new Error("blocked"));
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
  vi.stubEnv("PROD", true);
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);

  registerServiceWorker();
  window.dispatchEvent(new Event("load"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  process.off("unhandledRejection", unhandled);
  expect(register).toHaveBeenCalled();
  expect(unhandled).not.toHaveBeenCalled();
});
