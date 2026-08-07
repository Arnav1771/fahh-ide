import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so the Tauri build config stays untouched.
// Everything under test is pure TypeScript (stores, wrappers, parsers), so the
// default Node environment is enough — no jsdom, no React renderer.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    clearMocks: true,
  },
});
