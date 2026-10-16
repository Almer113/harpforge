// Talking to the HarpForge server about accounts. When there's no server (the app opened
// some other way), accounts aren't available and guest mode is all there is.

export interface AccountUser {
  name: string;
}

/** What asking the server gave: the account, or why not. */
export type AccountAnswer =
  | { ok: true; user: AccountUser | null }
  | { ok: false; reason: 'offline' | 'refused'; message: string; retryAfter?: number };

const OFFLINE = 'Can’t reach the HarpForge server. Is it running? (npm run deploy, or npm run dev)';

async function ask(path: string, body?: unknown): Promise<AccountAnswer> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      // (A server that never answers isn't waited for forever.)
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, reason: 'offline', message: OFFLINE };
  }
  let data: { user?: AccountUser | null; error?: string; retryAfter?: number } | null = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  // (No JSON: not our server answering — a plain web server, or none behind a proxy.)
  if (!data || (res.ok && !('user' in data))) return { ok: false, reason: 'offline', message: OFFLINE };
  if (!res.ok) return { ok: false, reason: 'refused', message: data.error ?? `The server said no (${res.status}).`, retryAfter: data.retryAfter };
  return { ok: true, user: data.user ?? null };
}

/** Who's signed in in this browser (null: no one). */
export const currentAccount = () => ask('/api/account');
export const signUp = (name: string, password: string) => ask('/api/account/signup', { name, password });
export const signIn = (name: string, password: string) => ask('/api/account/signin', { name, password });
export const signOut = () => ask('/api/account/signout', {});
