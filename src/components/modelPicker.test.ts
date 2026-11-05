import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const tsx = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".tsx")).map((f) => [f.replace(/\\/g, "/"), readFileSync(join(SRC, f), "utf8")] as const);

describe("one model picker everywhere", () => {
  it("binds the agent's Model and Fast model only through <ModelPicker>", () => {
    const strays = tsx.flatMap(([f, src]) =>
      src
        .split("\n")
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => /value=\{settings\.(model|fastModel)\}/.test(line) && !line.includes("<ModelPicker"))
        .map(([, n]) => `${f}:${n}`),
    );
    expect(strays).toEqual([]);
  });

  it("is used by settings (Model, Fast model), the panel header and the Welcome step", () => {
    const uses = (f: string) => tsx.find(([p]) => p === f)?.[1].match(/<ModelPicker\b/g)?.length ?? 0;
    expect(uses("components/AgentPanel/index.tsx")).toBe(3);
    expect(uses("components/Welcome/index.tsx")).toBe(1);
  });

  it("leaves no hardcoded model list behind", () => {
    const listed = tsx.filter(([, src]) => /<option[^>]*>\s*(meta\/llama|deepseek-ai|mistralai)/.test(src) || /Custom model name/.test(src));
    expect(listed.map(([f]) => f)).toEqual([]);
  });
});
