import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches render-time crashes (including hook-order mismatches after a hot
 * reload) and shows a friendly screen instead of a blank page.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
    try {
      reportLovableError(error, { boundary: "app_error_boundary" });
    } catch {
      // reporting must never mask the original error
    }
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            System interrupted
          </p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-foreground">
            JARVIS hit a snag
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Something went wrong while drawing the screen. Your saved notes, tasks and
            appointments are safe.
          </p>
          <p className="mt-3 break-words font-mono text-[0.7rem] text-muted-foreground/70">
            {error.message}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
