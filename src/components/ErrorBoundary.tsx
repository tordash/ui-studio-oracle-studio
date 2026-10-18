import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** When this changes (e.g. the route path) a shown error is cleared. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/** Catches a page crash and shows a small error card + reload button instead of a white screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-[480px] mx-auto my-16 px-6">
        <div className="bg-bg-card border border-border rounded-xl p-6 text-center">
          <h2 className="text-lg font-semibold text-text-primary mb-2">This page hit an error</h2>
          <p className="text-sm text-text-muted font-mono break-words mb-5">
            {this.state.error.message || String(this.state.error)}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-accent border-none text-white px-6 py-2.5 rounded-lg text-sm font-medium cursor-pointer hover:bg-accent-hover"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
