// Whose library this is: at startup the server is asked who's signed in here. Signed in, the
// library is the account's (on the server); not, it's this browser's (a guest). The library
// waits for the answer before it's first read.

import { setLibraryBackend, libraryWaitsFor } from '../storage/library';
import { accountBackend } from '../storage/remote';
import { useApp } from '../state/store';
import { currentAccount } from './client';

export function startAccount(): Promise<void> {
  useApp.setState({ account: { status: 'checking' } });
  const decided = currentAccount().then((a) => {
    if (a.ok && a.user) {
      setLibraryBackend(accountBackend());
      useApp.setState({ account: { status: 'signed-in', name: a.user.name } });
    } else {
      setLibraryBackend(null);
      // (No server answering: accounts aren't available, only this browser's library.)
      useApp.setState({ account: { status: a.ok ? 'guest' : 'offline' } });
    }
  });
  libraryWaitsFor(decided);
  return decided;
}
