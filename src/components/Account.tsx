// Accounts on screen: the start screen (sign in, create an account, or go on as a guest),
// the account menu in the top bar, and the offer to bring this browser's songs into an
// account.

import { useState, type FormEvent } from 'react';
import { bringSongs, continueAsGuest, createAccount, declineSongs, offerSongs, postponeSongs, signInAs, signOutNow, startAccount } from '../account/session';
import { useApp } from '../state/store';
import { setTheme, THEME_NAMES, useSystemTheme, useThemeChoice, type ThemeChoice } from '../state/theme';
import { Dialog } from './Dialog';
import { Menu } from './Menu';

/** The start screen: shown until you sign in or choose to go on as a guest in this browser. */
export function AccountGate() {
  const mode = useApp((s) => s.accountGate);
  const ended = useApp((s) => s.account.status === 'signed-out');
  if (!mode) return null;
  // (Closed without choosing — Escape, a click outside: a guest for this visit, asked again next time.)
  return (
    <Dialog label={ended ? 'Sign in again' : mode === 'signup' ? 'Create your account' : 'Sign in to HarpForge'} className="account-modal" onClose={() => useApp.setState({ accountGate: null })}>
      <GateBody mode={mode} />
    </Dialog>
  );
}

function GateBody({ mode }: { mode: 'signin' | 'signup' }) {
  const account = useApp((s) => s.account);
  const ended = account.status === 'signed-out';
  const [name, setName] = useState(ended ? (account.name ?? '') : '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === 'signup';
  const setMode = (m: 'signin' | 'signup') => {
    setError(null);
    useApp.setState({ accountGate: m });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const a = signup ? await createAccount(name, password) : await signInAs(name, password);
    setBusy(false);
    if (!a.ok) setError(a.message);
    else useApp.getState().notify(signup ? `Welcome, ${a.user?.name}! Your songs are now kept in your account ✓` : `Signed in as ${a.user?.name} ✓`);
  };

  return (
    <>
      <div className="account-head">
        <h2>{ended ? 'Sign in again' : signup ? 'Create your account' : 'Welcome to HarpForge'}</h2>
        <p className="muted small">
          {ended
            ? `You were signed out. Sign in again to keep using ${account.name ? `${account.name}’s` : 'your'} library.`
            : 'With an account, your songs are kept on the computer running HarpForge — open them from any device on your network.'}
        </p>
      </div>
      {!ended && (
        <div className="seg account-seg" role="group" aria-label="Sign in or create an account">
          <button type="button" className={!signup ? 'on' : ''} aria-pressed={!signup} onClick={() => setMode('signin')}>Sign in</button>
          <button type="button" className={signup ? 'on' : ''} aria-pressed={signup} onClick={() => setMode('signup')}>Create account</button>
        </div>
      )}
      <form className="account-form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            maxLength={32}
            required
            placeholder={signup ? 'What to call you (2–32 letters)' : undefined}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'}
            maxLength={200}
            required
            placeholder={signup ? 'At least 6 characters' : undefined}
          />
        </label>
        <label className="check small">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show the password
        </label>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? (signup ? 'Creating…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
        </button>
        <p className="muted small">You stay signed in on this device for 30 days (each visit counts from then).</p>
      </form>
      <div className="account-or">
        <span>or</span>
      </div>
      <div className="account-guest">
        <button className="btn ghost" type="button" onClick={continueAsGuest}>
          {ended ? 'Use this browser’s library instead' : 'Continue as guest'}
        </button>
        <span className="muted small">Your songs stay in this browser only (as before).</span>
      </div>
    </>
  );
}

/** Who's here, in the top bar: the account's name (or Guest) and its menu. */
export function AccountMenu() {
  const account = useApp((s) => s.account);
  const theme = useThemeChoice();
  const system = useSystemTheme();
  if (account.status === 'checking') return null;
  const signedIn = account.status === 'signed-in';
  const label = signedIn ? account.name! : account.status === 'signed-out' ? `${account.name} (signed out)` : account.status === 'offline' ? 'Guest (offline)' : 'Guest';
  const items =
    account.status === 'offline'
      ? [
          {
            label: 'Try again',
            hint: 'The HarpForge server isn’t answering here (is it running? npm run deploy:status). Meanwhile your songs are this browser’s.',
            onClick: () => void startAccount(),
          },
        ]
      : signedIn
        ? [
            { label: 'Bring this browser’s songs…', hint: 'Copy the songs you have as a guest here into your account', onClick: () => void offerSongs() },
            { label: 'Sign out', hint: 'Back to this browser’s own library (or sign in as someone else)', onClick: () => void signOutNow() },
          ]
        : account.status === 'signed-out'
          ? [{ label: 'Sign in again…', onClick: () => useApp.setState({ accountGate: 'signin' }) }]
          : [
              { label: 'Sign in…', hint: 'Keep your songs in your account, on the HarpForge computer', onClick: () => useApp.setState({ accountGate: 'signin' }) },
              { label: 'Create an account…', onClick: () => useApp.setState({ accountGate: 'signup' }) },
            ];
  // The theme is this device's, whoever is signed in.
  const themes = (['dark', 'light', 'paper', 'system'] as ThemeChoice[]).map((t, k) => ({
    label: THEME_NAMES[t],
    hint: t === 'system' ? `Dark or Light, as this computer is set (now ${THEME_NAMES[system]})` : t === 'paper' ? 'Cream and ink, like the printed sheet' : undefined,
    checked: theme === t,
    heading: k === 0 ? 'Theme (this device)' : undefined,
    onClick: () => setTheme(t),
  }));
  return (
    <Menu
      label={
        <span className="account-chip">
          <span className={`account-avatar ${signedIn ? '' : 'guest'}`} aria-hidden>
            {signedIn ? account.name!.slice(0, 1).toUpperCase() : '?'}
          </span>
          <span className="account-name">{label}</span>
        </span>
      }
      className="btn small ghost account-btn"
      title={
        signedIn
          ? `Signed in as ${account.name}: your songs are kept in your account`
          : account.status === 'signed-out'
            ? `Signed out of ${account.name}’s account: sign in again to use its library`
            : account.status === 'offline'
              ? 'The HarpForge server isn’t answering: songs are kept in this browser for now'
              : 'A guest: songs are kept in this browser only'
      }
      items={[...items, ...themes]}
    />
  );
}

/** Once, on signing in: bring this browser's songs into the account? */
export function BringSongsOffer() {
  const offer = useApp((s) => s.bringOffer);
  if (!offer) return null;
  const one = offer.songs + offer.trashed === 1;
  const count = (n: number) => `${n} song${n === 1 ? '' : 's'}`;
  return (
    <Dialog label="Bring your songs into your account" className="account-modal" onClose={postponeSongs}>
      <div className="account-head">
        <h2>Bring your songs along?</h2>
        <p>
          This browser has <b>{count(offer.songs + offer.trashed)}</b> of yours from before you signed in
          {offer.trashed ? ` (${offer.trashed} of them in its trash)` : ''}. Copy {one ? 'it' : 'them'} into <b>{offer.name}’s</b> library, with{' '}
          {one ? 'its' : 'their'} history, practice and your syllable fixes?
        </p>
        <p className="muted small">They stay in this browser too. You can do this later from the account menu.</p>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={declineSongs}>Not now</button>
        <button className="btn primary" autoFocus onClick={() => void bringSongs()}>
          Bring {one ? 'it' : 'them'} over
        </button>
      </div>
    </Dialog>
  );
}
