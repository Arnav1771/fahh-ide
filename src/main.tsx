import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
// Configure Monaco to use the locally-bundled core + workers (no CDN) so the
// editor renders in the packaged desktop app and offline. Must run before the
// first <Editor> mounts.
import "./lib/monaco-setup";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="Fahh Editor" full>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
