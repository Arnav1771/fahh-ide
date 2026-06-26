import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fahh: {
          bg: "#1e1e2e",
          sidebar: "#181825",
          surface: "#313244",
          accent: "#cba6f7",
          text: "#cdd6f4",
          muted: "#6c7086",
          error: "#f38ba8",
          warn: "#fab387",
          success: "#a6e3a1",
          info: "#89b4fa",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
