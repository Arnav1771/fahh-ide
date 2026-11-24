import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
// Fonts ship with the app (no Google Fonts request): the CSP allows only self, and it works offline.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/architects-daughter/400.css";
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
