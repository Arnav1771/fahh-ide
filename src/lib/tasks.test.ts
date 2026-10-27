import { describe, it, expect } from "vitest";
import { readTasks, TASKS_TEMPLATE } from "./tasks";

describe("tasks.json", () => {
  it("builds command lines, quoting arguments with spaces", () => {
    const text = `{
      // comment
      "tasks": [
        { "label": "build", "type": "shell", "command": "npm run build" },
        { "label": "say", "command": "echo", "args": ["two words", "x"] },
        { "label": "broken" },
        { "command": "ls" },
      ]
    }`;
    expect(readTasks(text)).toEqual([
      { label: "build", commandLine: "npm run build" },
      { label: "say", commandLine: 'echo "two words" x' },
      { label: "ls", commandLine: "ls" },
    ]);
  });

  it("is empty for a missing or broken file", () => {
    expect(readTasks("")).toEqual([]);
    expect(readTasks("{")).toEqual([]);
    expect(readTasks("{}")).toEqual([]);
  });

  it("the template has a runnable task", () => {
    expect(readTasks(TASKS_TEMPLATE)).toEqual([{ label: "echo", commandLine: 'echo "Hello from tasks.json"' }]);
  });
});
