import { beforeEach, describe, expect, it } from "vitest";
import { useComposerStore, buildContextSnippet } from "./composerStore";
import { useEditorStore } from "./editorStore";
import { useDiagnosticsStore } from "./diagnosticsStore";
import { useTerminalStore } from "./terminalStore";

beforeEach(() => {
  useComposerStore.getState().reset();
  useComposerStore.setState({
    isOpen: false,
    isExpanded: false,
    prompt: "",
    targetFiles: [],
    attachedContexts: [],
    status: "idle",
    timeline: [],
    fileDiffs: {},
    activeDiffFile: null,
  });
  useEditorStore.setState({
    openTabs: [],
    activeTab: "/src/main.ts",
    fileContents: {
      "/src/main.ts": "console.log('hello');",
    },
  });
});

const store = () => useComposerStore.getState();

describe("composerStore modal management", () => {
  it("opens composer with the active editor tab as default target", () => {
    store().openComposer();
    expect(store().isOpen).toBe(true);
    expect(store().targetFiles).toContain("/src/main.ts");
    expect(store().activeDiffFile).toBe("/src/main.ts");
  });

  it("opens composer with an explicit target file", () => {
    store().openComposer("/src/App.tsx");
    expect(store().isOpen).toBe(true);
    expect(store().targetFiles).toContain("/src/App.tsx");
  });

  it("closes and toggles composer visibility", () => {
    store().openComposer();
    expect(store().isOpen).toBe(true);

    store().closeComposer();
    expect(store().isOpen).toBe(false);

    store().toggleComposer();
    expect(store().isOpen).toBe(true);

    store().toggleComposer();
    expect(store().isOpen).toBe(false);
  });

  it("toggles expanded full-screen mode", () => {
    expect(store().isExpanded).toBe(false);
    store().toggleExpanded();
    expect(store().isExpanded).toBe(true);
    store().toggleExpanded();
    expect(store().isExpanded).toBe(false);
  });
});

describe("composerStore target files and context management", () => {
  it("adds unique target files and removes them", () => {
    store().addTargetFile("/src/utils.ts");
    expect(store().targetFiles).toContain("/src/utils.ts");

    // Duplicate add should be ignored
    store().addTargetFile("/src/utils.ts");
    expect(store().targetFiles.filter((f) => f === "/src/utils.ts")).toHaveLength(1);

    store().removeTargetFile("/src/utils.ts");
    expect(store().targetFiles).not.toContain("/src/utils.ts");
  });

  it("attaches context items and removes them", () => {
    const ctx = {
      id: "ctx-1",
      type: "problems" as const,
      label: "@problems",
    };
    store().attachContext(ctx);
    expect(store().attachedContexts).toHaveLength(1);

    // Duplicate attachment ignored
    store().attachContext(ctx);
    expect(store().attachedContexts).toHaveLength(1);

    store().removeContext("ctx-1");
    expect(store().attachedContexts).toHaveLength(0);
  });

  it("sets prompt text", () => {
    store().setPrompt("Add unit tests for auth");
    expect(store().prompt).toBe("Add unit tests for auth");
  });
});

describe("buildContextSnippet", () => {
  it("builds problems context snippet from diagnostics store", () => {
    useDiagnosticsStore.setState({
      diagnostics: [
        {
          id: "d1",
          path: "/src/main.ts",
          message: "Type error",
          severity: "error",
          line: 10,
        },
      ],
    });

    const snippet = buildContextSnippet("problems", "problems");
    expect(snippet.type).toBe("problems");
    expect(snippet.label).toContain("@problems");
    expect(snippet.content).toContain("Type error");
  });

  it("builds terminal context snippet from terminal store", () => {
    useTerminalStore.setState({
      lines: [
        { text: "vite ready on :5173", type: "stdout" },
      ],
    });

    const snippet = buildContextSnippet("terminal", "terminal");
    expect(snippet.type).toBe("terminal");
    expect(snippet.content).toContain("vite ready");
  });

  it("builds codebase context snippet", () => {
    const snippet = buildContextSnippet("codebase", "root");
    expect(snippet.type).toBe("codebase");
    expect(snippet.label).toBe("@codebase");
  });

  it("builds file context snippet from editorStore contents", () => {
    const snippet = buildContextSnippet("file", "/src/main.ts");
    expect(snippet.type).toBe("file");
    expect(snippet.label).toContain("main.ts");
    expect(snippet.content).toBe("console.log('hello');");
  });
});

describe("composerStore execution and diff resolution", () => {
  it("accepts and rejects individual file diffs", async () => {
    useComposerStore.setState({
      fileDiffs: {
        "/src/main.ts": {
          path: "/src/main.ts",
          original: "const a = 1;",
          modified: "const a = 2;",
          status: "pending",
        },
        "/src/App.tsx": {
          path: "/src/App.tsx",
          original: "export default App;",
          modified: "export default MainApp;",
          status: "pending",
        },
      },
      status: "review",
    });

    await store().acceptFile("/src/main.ts");
    expect(store().fileDiffs["/src/main.ts"].status).toBe("accepted");
    expect(useEditorStore.getState().fileContents["/src/main.ts"]).toBe("const a = 2;");
    // Not all done yet
    expect(store().status).toBe("review");

    store().rejectFile("/src/App.tsx");
    expect(store().fileDiffs["/src/App.tsx"].status).toBe("rejected");
    // Both resolved -> status transitions to done
    expect(store().status).toBe("done");
  });
});
