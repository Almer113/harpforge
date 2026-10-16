// A tab's history: its saved versions, newest first. Each can be looked at, compared (with
// the one before it, or with the tab as it is now), brought back, kept as a copy, or named.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseHtab } from '../core/htab/parser';
import { describeChange, diffLines, type DiffLine } from '../core/lineDiff';
import { restoreVersion, saveVersionAsCopy, whenLabel } from '../state/history';
import { libraryChanged } from '../state/trash';
import { useApp } from '../state/store';
import { listVersions, nameVersion, type TabVersion, type VersionKind } from '../storage/library';
import { Dialog } from './Dialog';
import { SimpleTabPreview } from './SimpleTabView';

const KIND: Record<VersionKind, string> = { save: '', demo: 'Demo update', import: 'From a backup', recover: 'Recovered' };

export function HistoryDialog() {
  const tabId = useApp((s) => s.historyFor);
  if (!tabId) return null;
  const close = () => useApp.setState({ historyFor: null });
  return (
    <Dialog label="History" className="history-modal" onClose={close}>
      <HistoryBody tabId={tabId} close={close} />
    </Dialog>
  );
}

type View = 'preview' | 'changes' | 'now';

function HistoryBody({ tabId, close }: { tabId: string; close: () => void }) {
  const [versions, setVersions] = useState<TabVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The version looked at (by id: a save while this is open adds one at the top). None: the newest.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('preview');
  const [naming, setNaming] = useState<string | null>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  // The tab as it is now: the editor's text if it's the open tab (unsaved edits too), else as saved.
  const openText = useApp((s) => (s.docId === tabId ? s.text : null));
  // Read again when the library changes (Ctrl+S while this is open, a name kept).
  useEffect(() => {
    let live = true;
    const read = () =>
      listVersions(tabId)
        .then((v) => live && setVersions(v))
        .catch((e: Error) => live && setError(e?.message || 'storage unavailable'));
    void read();
    const off = useApp.subscribe((s, prev) => {
      if (s.libraryRev !== prev.libraryRev) void read();
    });
    return () => {
      live = false;
      off();
    };
  }, [tabId]);
  // What each save changed, worked out once per list (not on every keystroke in the name).
  const changes = useMemo(() => (versions ?? []).map((x, i, all) => (i === all.length - 1 ? null : describeChange(all[i + 1].text, x.text))), [versions]);

  if (error) return <Body close={close} title="History"><p className="muted">Couldn’t read the history ({error}).</p></Body>;
  if (!versions) return <Body close={close} title="History"><p className="muted">Loading…</p></Body>;
  if (!versions.length) return <Body close={close} title="History"><p className="muted">No saved versions yet. Each time you save, the tab as saved is kept here.</p></Body>;

  const v = versions.find((x) => x.id === pickedId) ?? versions[0];
  const latest = versions[0];
  const now = openText ?? latest.text;
  const before = versions[versions.indexOf(v) + 1];
  const unsaved = openText !== null && openText !== latest.text;

  /** The name field closed: the keyboard back on its button. */
  const endNaming = () => {
    setNaming(null);
    requestAnimationFrame(() => nameButton.current?.focus());
  };
  const rename = async (name: string) => {
    endNaming();
    try {
      await nameVersion(v.id, name);
    } catch (e) {
      useApp.getState().notify(`Couldn’t name it: ${(e as Error).message}`);
    }
    libraryChanged();
  };

  return (
    <Body close={close} title={`History: ${latest.title}`}>
      <div className="history-grid">
        <ol className="history-list" aria-label="Saved versions, newest first">
          {versions.map((x, i) => (
            <li key={x.id}>
              <button
                className={`history-item ${x === v ? 'on' : ''}`}
                aria-current={x === v}
                // (The keyboard starts on the version shown.)
                autoFocus={x === v}
                onClick={() => {
                  setPickedId(x.id);
                  setNaming(null);
                }}
              >
                <span className="hi-main">{x.name ?? whenLabel(x.at)}</span>
                <span className="hi-sub muted small">
                  {[x.name ? whenLabel(x.at) : '', i === 0 ? (unsaved ? 'Last saved' : 'Current') : '', KIND[x.kind], changes[i] ?? 'Oldest kept']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="history-detail">
          <div className="history-bar">
            <div className="seg" role="group" aria-label="Show">
              <button className={view === 'preview' ? 'on' : ''} aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
              <button className={view === 'changes' ? 'on' : ''} aria-pressed={view === 'changes'} onClick={() => setView('changes')} disabled={!before} title={before ? 'Changes since the version before it' : 'The oldest version kept: nothing before it'}>
                What changed
              </button>
              <button className={view === 'now' ? 'on' : ''} aria-pressed={view === 'now'} onClick={() => setView('now')} title="How the tab is now differs from this version">
                Compared with now
              </button>
            </div>
            {naming === null ? (
              <button ref={nameButton} className="btn small ghost" onClick={() => setNaming(v.name ?? '')} title="Name this version: named ones are kept for good">
                {v.name ? 'Rename…' : 'Name…'}
              </button>
            ) : (
              <form
                className="history-name"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename(naming);
                }}
              >
                <input
                  autoFocus
                  value={naming}
                  maxLength={80}
                  placeholder="e.g. before the new chorus"
                  aria-label="Version name"
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => {
                    // (Escape leaves the name, not the dialog.)
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      endNaming();
                    }
                  }}
                />
                <button className="btn small" type="submit">Keep</button>
              </form>
            )}
          </div>
          <div className="history-view">
            {view === 'preview' && <Preview text={v.text} />}
            {view === 'changes' && (before ? <Changes lines={diffLines(before.text, v.text)} /> : <p className="muted">The oldest version kept: nothing before it.</p>)}
            {view === 'now' && <Changes lines={diffLines(v.text, now)} same="This version is the same as the tab now." />}
          </div>
          <div className="modal-actions">
            <button className="btn small ghost" onClick={() => void saveVersionAsCopy(v)} title="Keep this version as a tab of its own">
              Save as a copy
            </button>
            <button
              className="btn small primary"
              disabled={v.text === now}
              title={v.text === now ? 'The tab is already like this' : 'Bring this version back into the tab (Ctrl+Z takes it back; save to keep it)'}
              onClick={() => {
                void restoreVersion(v).then((done) => done && close());
              }}
            >
              Bring this version back
            </button>
          </div>
        </div>
      </div>
    </Body>
  );
}

function Body({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <>
      <div className="modal-head">
        <h2>{title}</h2>
        <span className="muted small">Each save is kept: all from the last day, then one a day for a month, then one a week. Named versions are kept for good.</span>
        <button className="modal-x" onClick={close} aria-label="Close">×</button>
      </div>
      {children}
    </>
  );
}

function Preview({ text }: { text: string }) {
  const doc = useMemo(() => parseHtab(text).doc, [text]);
  return (
    <div className="history-preview">
      {doc.meta.artist && <p className="muted small">{doc.meta.artist}</p>}
      <SimpleTabPreview doc={doc} lines={Infinity} />
    </div>
  );
}

/** The lines compared: long unchanged stretches folded down to a little around the changes. */
function Changes({ lines, same = 'No changes.' }: { lines: DiffLine[]; same?: string }) {
  if (!lines.some((l) => l.op !== 'same')) return <p className="muted">{same}</p>;
  const AROUND = 2;
  const near = lines.map((_, i) => lines.slice(Math.max(0, i - AROUND), i + AROUND + 1).some((l) => l.op !== 'same'));
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!near[i]) {
      let j = i;
      while (j < lines.length && !near[j]) j++;
      out.push(
        <div key={i} className="diff-fold muted small">
          {j - i} unchanged line{j - i === 1 ? '' : 's'}
        </div>,
      );
      i = j - 1;
      continue;
    }
    const l = lines[i];
    out.push(
      <div key={i} className={`diff-line ${l.op}`}>
        <span className="diff-sign" aria-label={l.op === 'add' ? 'added' : l.op === 'del' ? 'removed' : undefined}>
          {l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}
        </span>
        {l.text || ' '}
      </div>,
    );
  }
  return <div className="diff">{out}</div>;
}
