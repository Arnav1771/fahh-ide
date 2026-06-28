import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fahh: {
          bg: "var(--fahh-bg)",
          sidebar: "var(--fahh-sidebar)",
          surface: "var(--fahh-surface)",
          accent: "var(--fahh-accent)",
          text: "var(--fahh-text)",
          muted: "var(--fahh-muted)",
          error: "var(--fahh-error)",
          warn: "var(--fahh-warn)",
          success: "var(--fahh-success)",
          info: "var(--fahh-info)",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
