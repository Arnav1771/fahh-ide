import type { Config } from "tailwindcss";

/**
 * A theme colour from its CSS variable. As a function, so opacity modifiers work:
 * Tailwind cannot put an alpha on a plain var(), and silently dropped every bg-fahh-accent/90
 * (white text on no background in Fahh Light). color-mix gives the same result for any theme.
 */
const themed =
  (name: string) =>
  ({ opacityValue }: { opacityValue?: string }) =>
    // A plain class (bg-fahh-accent) stays a plain var(), so it works even where color-mix does not.
    !(Number(opacityValue) < 1)
      ? `var(--fahh-${name})`
      : `color-mix(in srgb, var(--fahh-${name}) calc(${opacityValue} * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fahh: Object.fromEntries(
          ["bg", "sidebar", "surface", "accent", "text", "muted", "error", "warn", "success", "info"].map((n) => [n, themed(n)])
        ),
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
