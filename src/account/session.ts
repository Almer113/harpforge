// Whose library this is. At startup the server is asked who's signed in here: signed in, the
// library is the account's (on the server); not, it's this browser's (a guest) — after the
// start screen, until you've chosen to go on as a guest in this browser. The library waits
// for the answer before it's first read.
//
// Changing library (signing in, out, or to another account) keeps the song that's open
// open: it just isn't linked to a library any more (save it to put it in the new one).

import { browserLibrary, exportLibrary, importLibrary, libraryWaitsFor, ownSongs, readBackup, seedDemos, setLibraryBackend, undoImport } from '../storage/library';
import { accountBackend, onSignedOut } from '../storage/remote';
import { isDirty, useApp } from '../state/store';
import { libraryChanged } from '../state/trash';
import { bringBrowserData, accountData, browserData } from '../storage/userData';
import { currentAccount, signIn, signOut, signUp, type AccountAnswer } from './client';

/** Chosen once in this browser: go on as a guest (the start screen isn't shown again). */
const GUEST_KEY = 'harpforge:guest';
/** This browser's songs were offered to an account (once each). */
const offeredKey = (name: string) => `harpforge:offered:${name.toLowerCase()}`;

function remembered(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}
function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** The server says the session ended (signed out elsewhere, or a month unused): sign in again. */
onSignedOut(() => {
  const { account } = useApp.getState();
  if (account.status !== 'signed-in') return;
  useApp.setState({ account: { status: 'signed-out', name: account.name }, accountGate: 'signin' });
});

/** Whose library a song's id belongs to, as the working copy keeps it. */
export const ownerOf = (name: string | null) => (name ? `account:${name.toLowerCase()}` : 'browser');

/** The library in use now belongs to `owner`: the open song, if it's from another, is unlinked. */
function nowIn(owner: string) {
  if (useApp.getState().libraryOwner !== owner) unlinkOpenSong();
  useApp.setState({ libraryOwner: owner });
}

export function startAccount(): Promise<void> {
  useApp.setState({ account: { status: 'checking' } });
  const decided = currentAccount().then(async (a) => {
    if (a.ok && a.user) {
      setLibraryBackend(accountBackend());
      await accountData();
      useApp.setState({ account: { status: 'signed-in', name: a.user.name } });
      // (Reopened in another account's library — or a guest's song left open: not this library's.)
      nowIn(ownerOf(a.user.name));
      return;
    }
    setLibraryBackend(null);
    browserData();
    nowIn('browser');
    // (No server answering: accounts aren't available, only this browser's library.)
    if (!a.ok) return useApp.setState({ account: { status: 'offline' } });
    useApp.setState({ account: { status: 'guest' }, accountGate: remembered(GUEST_KEY) ? null : 'signin' });
  });
  libraryWaitsFor(decided);
  return decided;
}

/** The open song stays open, no longer linked to the library it came from (unsaved if it was changed). */
function unlinkOpenSong() {
  const s = useApp.getState();
  if (!s.docId) return;
  useApp.setState({ docId: null, savedText: isDirty(s) ? null : s.text, inTrash: false });
}

/** Into an account's library (just signed in or up): and, once, the offer to bring this browser's songs. */
async function enter(name: string) {
  const { account } = useApp.getState();
  // (Signed in again as the one whose session ended: the same library, the song still linked.)
  const same = account.status === 'signed-out' && account.name?.toLowerCase() === name.toLowerCase();
  if (!same) unlinkOpenSong();
  setLibraryBackend(accountBackend());
  await accountData();
  useApp.setState({ account: { status: 'signed-in', name }, accountGate: null, libraryOwner: ownerOf(name) });
  libraryChanged();
  if (remembered(offeredKey(name))) return;
  const songs = await ownSongs(browserLibrary()).catch(() => 0);
  if (songs > 0) useApp.setState({ bringOffer: { name, songs } });
  else remember(offeredKey(name), 'none');
}

/** Signs in (and goes into that account's library). The server's answer, for the form to show. */
export async function signInAs(name: string, password: string): Promise<AccountAnswer> {
  const a = await signIn(name, password);
  if (a.ok && a.user) await enter(a.user.name);
  return a;
}

/** Makes an account (and goes into its library, new and empty but for the demos). */
export async function createAccount(name: string, password: string): Promise<AccountAnswer> {
  const a = await signUp(name, password);
  if (a.ok && a.user) await enter(a.user.name);
  return a;
}

/** Goes on as a guest: this browser's library (and the start screen isn't shown again here). */
export function continueAsGuest() {
  remember(GUEST_KEY, '1');
  const { account } = useApp.getState();
  if (account.status === 'signed-out') {
    // (The account's session ended and you chose this browser's library instead.)
    unlinkOpenSong();
    setLibraryBackend(null);
    browserData();
    useApp.setState({ account: { status: 'guest' }, libraryOwner: 'browser' });
    libraryChanged();
  }
  useApp.setState({ accountGate: null });
}

/** Signs out: back to this browser's library, and the start screen (to sign in as someone else, or not). */
export async function signOutNow(then: 'signin' | null = 'signin') {
  await signOut();
  unlinkOpenSong();
  setLibraryBackend(null);
  browserData();
  useApp.setState({ libraryOwner: 'browser' });
  // (Signing out isn't choosing to be a guest: the start screen asks again.)
  remember(GUEST_KEY, null);
  useApp.setState({ account: { status: 'guest' }, accountGate: then, bringOffer: null });
  libraryChanged();
}

/** Brings this browser's songs (with their history and the trash) into the account's library. */
export async function bringSongs() {
  const offer = useApp.getState().bringOffer;
  if (!offer) return;
  useApp.setState({ bringOffer: null });
  remember(offeredKey(offer.name), 'done');
  try {
    // (The account's own demos first — then only your songs come over, not this browser's copies of them.)
    await seedDemos().catch(() => undefined);
    const zip = await exportLibrary({ full: true, from: browserLibrary(), ownOnly: true });
    const r = await importLibrary(readBackup(zip));
    // (Their practice history and your syllable fixes come too.)
    await bringBrowserData().catch(() => undefined);
    libraryChanged();
    const n = r.added;
    useApp.getState().notify(
      n
        ? `Brought ${n === 1 ? '1 song' : `${n} songs`} into ${offer.name}’s library ✓ (${n === 1 ? 'it’s' : 'they’re'} still in this browser too)`
        : 'They’re all in your library already ✓',
      n || r.versions
        ? {
            label: 'Undo',
            run: () =>
              void undoImport(r)
                .then(libraryChanged)
                .catch((e: Error) => useApp.getState().notify(`Couldn’t undo: ${e.message}`)),
          }
        : undefined,
    );
  } catch (e) {
    remember(offeredKey(offer.name), null);
    useApp.getState().notify(`Couldn’t bring them over: ${(e as Error).message}. Nothing was added — try again from the account menu.`);
  }
}

/** Not now: not offered again on its own (the account menu still has it). */
export function declineSongs() {
  const offer = useApp.getState().bringOffer;
  if (offer) remember(offeredKey(offer.name), 'no');
  useApp.setState({ bringOffer: null });
}

/** The offer again, from the account menu. */
export async function offerSongs() {
  const { account } = useApp.getState();
  if (account.status !== 'signed-in' || !account.name) return;
  const songs = await ownSongs(browserLibrary()).catch(() => 0);
  if (songs > 0) useApp.setState({ bringOffer: { name: account.name, songs } });
  else useApp.getState().notify('This browser’s library has no songs of yours to bring over.');
}
