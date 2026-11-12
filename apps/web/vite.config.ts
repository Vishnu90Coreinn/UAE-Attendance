import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      // Forward /api/* to the ASP.NET Core dev server so the browser sees one origin.
      "/api": { target: "http://localhost:5210", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Form tests type many characters through jsdom; under a parallel full run they can pass the 5 s default.
    testTimeout: 20000,
  },
});
