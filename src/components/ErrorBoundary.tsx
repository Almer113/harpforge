import { Component, type ReactNode } from 'react';

/**
 * Catches a crash in one page so the whole app doesn't go blank. The tab itself lives
 * in the store (and the browser's storage), so nothing is lost: switching pages or
 * reloading brings everything back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    // Going to another page tries again.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="page">
        <div className="crash">
          <h2>Something went wrong on this page</h2>
          <p className="muted">Your tab is safe — it's kept separately. Try another page, or reload.</p>
          <pre className="crash-detail">{this.state.error.message}</pre>
          <div className="tb-group">
            <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
            <button className="btn ghost" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </section>
    );
  }
}
