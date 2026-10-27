/**
 * Run Task: `.vscode/tasks.json` (VS Code's format). Fahh runs a task by typing its
 * command into a new terminal, so the user sees it run and can answer prompts.
 */
import { parseJsonc } from "./launchConfig";

export interface Task {
  label: string;
  /** The full command line typed into the shell. */
  commandLine: string;
}

const quote = (a: string) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

/** The runnable tasks in a tasks.json text; [] when it is missing or broken. */
export function readTasks(text: string): Task[] {
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    return [];
  }
  const tasks = (json as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks)) return [];
  const out: Task[] = [];
  for (const t of tasks) {
    if (!t || typeof t !== "object") continue;
    const { label, command, args } = t as { label?: unknown; command?: unknown; args?: unknown };
    if (typeof command !== "string" || !command.trim()) continue;
    const argv = Array.isArray(args) ? args.filter((a): a is string => typeof a === "string").map(quote) : [];
    out.push({ label: typeof label === "string" && label ? label : command, commandLine: [command, ...argv].join(" ") });
  }
  return out;
}

export const TASKS_TEMPLATE = `{
  // Tasks for Terminal > Run Task, in VS Code's tasks.json format.
  "version": "2.0.0",
  "tasks": [
    {
      "label": "echo",
      "type": "shell",
      "command": "echo",
      "args": ["Hello from tasks.json"]
    }
  ]
}
`;
