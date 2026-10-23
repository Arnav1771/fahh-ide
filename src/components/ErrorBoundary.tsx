import React from "react";

/** Keys that make the next launch reopen what crashed: the saved dock layouts and the recent list's head. */
export function resetSession(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("fahh-layout:")) localStorage.removeItem(k);
    localStorage.setItem("fahh-skip-restore", "1");
  } catch {}
}

type Props = { children: React.ReactNode; label: string; full?: boolean };
type State = { error: Error | null };

/**
 * A crash inside one view used to unmount the whole app (blank window, and session
 * restore reopened the same crash on every launch). This keeps it to the view that
 * failed and offers a way out.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.label}] crashed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className={`flex ${this.props.full ? "h-screen w-screen" : "h-full w-full"} flex-col items-center justify-center gap-3 bg-fahh-bg p-6 text-center text-fahh-text`}>
        <p className="text-sm font-semibold">{this.props.label} stopped working</p>
        <p className="max-w-md break-words font-mono text-xs opacity-70">{error.message}</p>
        <div className="flex gap-2">
          <button className="rounded border border-fahh-surface px-3 py-1 text-xs hover:bg-fahh-surface" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button
            className="rounded border border-fahh-surface px-3 py-1 text-xs hover:bg-fahh-surface"
            onClick={() => {
              resetSession();
              location.reload();
            }}
          >
            Reset session and reload
          </button>
        </div>
      </div>
    );
  }
}
