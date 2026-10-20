import { defineConfig } from "vitest/config";
import pkg from "./package.json";

// Kept separate from vite.config.ts so the Tauri build config stays untouched.
// Everything under test is pure TypeScript (stores, wrappers, parsers), so the
// default Node environment is enough — no jsdom, no React renderer.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    clearMocks: true,
  },
});
