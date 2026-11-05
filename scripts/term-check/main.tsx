import ReactDOM from "react-dom/client";
import "../../src/index.css";
import { TerminalPanel } from "../../src/components/Terminal/TerminalPanel";
import { useTerminalStore } from "../../src/store/terminalStore";

// The docked terminal panel on its own, against the fake backend in index.html.
useTerminalStore.getState().setCwd("/home/me/agent-proj");
const el = document.getElementById("root")!;
let root: ReactDOM.Root | null = null;
const w = window as unknown as Record<string, unknown>;
w.mount = () => {
  root = ReactDOM.createRoot(el);
  root.render(<TerminalPanel />);
};
w.unmount = () => {
  root?.unmount();
  root = null;
};
w.termStore = useTerminalStore;
(w.mount as () => void)();
