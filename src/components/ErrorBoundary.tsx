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
    // Going to another page tries again (guarded: it only runs once, after the key changes).
    // oxlint-disable-next-line react/no-did-update-set-state
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // A page whose code couldn't be downloaded (offline, or the app was updated) needs a reload.
    const loadFailed = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(this.state.error.message);
    return (
      <section className="page">
        <div className="crash">
          <h2>{loadFailed ? 'This page couldn’t be loaded' : 'Something went wrong on this page'}</h2>
          <p className="muted">
            Your tab is safe — it's kept separately. {loadFailed ? 'Check your connection, then reload.' : 'Try another page, or reload.'}
          </p>
          <pre className="crash-detail">{this.state.error.message}</pre>
          <div className="tb-group">
            {!loadFailed && <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>}
            <button className="btn ghost" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </section>
    );
  }
}
