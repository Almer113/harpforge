// Accounts: made by their owners on the sign-up page, kept as one file each in
// data/accounts/ (the password only as a scrypt hash); signed-in browsers hold a session
// (a random token in a cookie scripts can't read; on disk only its hash), good for 30 days
// and renewed as it's used. One file per account and per session: the deployed server and
// the dev server can share data/ without overwriting each other.

import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { link, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeFileAtomic, writeJson } from './files.ts';
import { isDeviceName } from './library.ts';

export interface Account {
  name: string;
  key: string;
  salt: string;
  hash: string;
  createdAt: number;
}

export interface User {
  name: string;
  /** The account's folder name (data/users/<key>), its name made safe: unique, case-insensitive. */
  key: string;
}

interface Session {
  user: string;
  expires: number;
}

export const SESSION_DAYS = 30;
const DAY = 86400000;
const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** An error the client is shown (with its HTTP status). */
export class UserError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// (Names Windows won't have as a folder.)

/** A name as shown ("Almer") and its key ("almer"), or why it can't be used. */
export function checkName(raw: unknown): { name: string; key: string } {
  const name = typeof raw === 'string' ? raw.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 32) throw new UserError(400, 'A name is 2 to 32 characters.');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) throw new UserError(400, 'A name can have letters, numbers, spaces, dots, dashes and underscores (and starts with a letter or number).');
  const key = name.toLowerCase().replace(/ /g, '-').replace(/\.+$/, '');
  if (isDeviceName(key)) throw new UserError(400, 'That name can’t be used. Try another.');
  return { name, key };
}

export function checkPassword(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < 6) throw new UserError(400, 'A password is at least 6 characters.');
  if (raw.length > 200) throw new UserError(400, 'That password is too long (200 characters at most).');
  return raw;
}

// At most two passwords hashed at once (the rest wait their turn): a flood of sign-ins
// can't take all of Node's worker threads, which file reads and writes need too.
let hashing = 0;
const waiting: (() => void)[] = [];

async function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  // (A slot is taken, or handed over by the one finishing: never more than two at once.)
  if (hashing >= 2) await new Promise<void>((r) => waiting.push(r));
  else hashing++;
  try {
    return await new Promise((resolve, reject) => scrypt(password.normalize('NFC'), salt, 64, SCRYPT, (e, key) => (e ? reject(e) : resolve(key))));
  } finally {
    const next = waiting.shift();
    if (next) next();
    else hashing--;
  }
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createAccounts(dataDir: string) {
  const accountsDir = path.join(dataDir, 'accounts');
  const sessionsDir = path.join(dataDir, 'sessions');
  const accountFile = (key: string) => path.join(accountsDir, `${key}.json`);
  const sessionFile = (token: string) => path.join(sessionsDir, `${tokenHash(token)}.json`);

  async function account(key: string): Promise<Account | null> {
    try {
      return await readJson<Account | null>(accountFile(key), null);
    } catch {
      return null;
    }
  }

  /** Makes an account (its name not taken by anyone, whatever the capitals). */
  async function signUp(rawName: unknown, rawPassword: unknown): Promise<User> {
    const { name, key } = checkName(rawName);
    const password = checkPassword(rawPassword);
    const salt = randomBytes(16);
    const hash = await hashPassword(password, salt);
    const record: Account = { name, key, salt: salt.toString('base64'), hash: hash.toString('base64'), createdAt: Date.now() };
    await mkdir(accountsDir, { recursive: true });
    // Written whole to a temporary file, then linked in under its name: the link fails if the
    // name is taken — even by a sign-up at the same moment in the other server.
    const tmp = `${accountFile(key)}.${randomBytes(4).toString('hex')}.tmp`;
    const text = `${JSON.stringify(record, null, 2)}\n`;
    await writeFileAtomic(tmp, text);
    try {
      await link(tmp, accountFile(key)).catch(async (e: NodeJS.ErrnoException) => {
        if (e.code === 'EEXIST') throw e;
        // (A drive without links — FAT, exFAT: created only if it isn't there, the same way.)
        await writeFile(accountFile(key), text, { flag: 'wx' });
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new UserError(409, 'That name is taken. Try another, or sign in.');
      throw e;
    } finally {
      await rm(tmp, { force: true });
    }
    await mkdir(path.join(dataDir, 'users', key), { recursive: true });
    return { name, key };
  }

  /** The account, if the name and password are right. */
  async function verify(rawName: unknown, rawPassword: unknown): Promise<User | null> {
    let key: string;
    try {
      key = checkName(rawName).key;
    } catch {
      return null;
    }
    const found = await account(key);
    const password = typeof rawPassword === 'string' ? rawPassword.slice(0, 200) : '';
    // (The same work whether or not the account exists: how long it takes tells nothing.)
    const salt = found ? Buffer.from(found.salt, 'base64') : randomBytes(16);
    const hash = await hashPassword(password, salt);
    if (!found) return null;
    const want = Buffer.from(found.hash, 'base64');
    return want.length === hash.length && timingSafeEqual(want, hash) ? { name: found.name, key: found.key } : null;
  }

  /** A new session for an account: its token (for the cookie). */
  async function startSession(user: User): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await writeJson(sessionFile(token), { user: user.key, expires: Date.now() + SESSION_DAYS * DAY } satisfies Session);
    void sweep().catch(() => undefined);
    return token;
  }

  /** The account a session token is for (null: none, ended, or the account's gone); renews it as it's used. */
  async function sessionUser(token: string | undefined): Promise<{ user: User; renewed: boolean } | null> {
    if (!token || !/^[\w-]{20,100}$/.test(token)) return null;
    const file = sessionFile(token);
    const s = await readJson<Session | null>(file, null).catch(() => null);
    if (!s || s.expires < Date.now()) return null;
    const found = await account(s.user);
    if (!found) return null;
    // (Used again: another 30 days from now — written at most once a day.)
    const renewed = s.expires - Date.now() < (SESSION_DAYS - 1) * DAY;
    if (renewed) await writeJson(file, { ...s, expires: Date.now() + SESSION_DAYS * DAY }).catch(() => undefined);
    return { user: { name: found.name, key: found.key }, renewed };
  }

  async function endSession(token: string | undefined) {
    if (token && /^[\w-]{20,100}$/.test(token)) await rm(sessionFile(token), { force: true });
  }

  // Ended sessions' files cleared away now and then.
  let swept = 0;
  async function sweep() {
    if (Date.now() - swept < 6 * 3600 * 1000) return;
    swept = Date.now();
    for (const f of await readdir(sessionsDir).catch(() => [] as string[])) {
      // (Only sessions: not a session being written right now, in either server.)
      if (!/^[0-9a-f]{64}\.json$/.test(f)) continue;
      const file = path.join(sessionsDir, f);
      const s = await readJson<Session | null>(file, null).catch(() => null);
      if (!s || s.expires < Date.now()) await rm(file, { force: true });
    }
  }

  return { signUp, verify, startSession, sessionUser, endSession };
}

export type Accounts = ReturnType<typeof createAccounts>;

/**
 * Who's asking, for the limits: an IPv4 address, or an IPv6 one's network (its first half —
 * one device can have any number of addresses in it).
 */
export function clientKey(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1];
  const full = ip.includes('::') ? expand(ip) : ip.split(':');
  return full.slice(0, 4).join(':').toLowerCase();
}

function expand(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  return [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
}

/**
 * Wrong passwords, slowed: after 5 from one address — counting tries still being checked,
 * so sending many at once doesn't get round it — each try waits longer (1 s, 2 s, 4 s … up
 * to a minute). Forgotten after 15 minutes without one, or a right one. Sign-ups are
 * limited too: 20 an hour from one address, 60 an hour in all.
 */
export function createLimits(now = () => Date.now()) {
  const fails = new Map<string, { count: number; last: number }>();
  const pending = new Map<string, number>();
  const signups = new Map<string, number[]>();
  let allSignups: number[] = [];
  let pruned = now();

  /** Old entries cleared now and then (the maps don't grow without end). */
  function prune() {
    if (now() - pruned < 10 * 60000) return;
    pruned = now();
    for (const [k, f] of fails) if (now() - f.last > 15 * 60000) fails.delete(k);
    for (const [k, list] of signups) {
      const recent = list.filter((t) => now() - t < 3600000);
      if (recent.length) signups.set(k, recent);
      else signups.delete(k);
    }
  }

  function waitFor(key: string): number {
    const f = fails.get(key);
    if (!f) return 0;
    if (now() - f.last > 15 * 60000) {
      fails.delete(key);
      return 0;
    }
    if (f.count < 5) return 0;
    const wait = Math.min(60000, 1000 * 2 ** (f.count - 5));
    return Math.max(0, f.last + wait - now());
  }

  const done = (key: string) => {
    const n = (pending.get(key) ?? 1) - 1;
    if (n > 0) pending.set(key, n);
    else pending.delete(key);
  };

  return {
    /** A sign-in starts (throws 429 if this address must wait); then `failed` or `succeeded`. */
    checkSignIn(ip: string) {
      prune();
      const key = clientKey(ip);
      const wait = waitFor(key);
      if (wait > 0) throw new UserError(429, `Too many wrong passwords. Try again in ${Math.ceil(wait / 1000)} s.`, { retryAfter: Math.ceil(wait / 1000) });
      const inFlight = pending.get(key) ?? 0;
      if (inFlight > 0 && (fails.get(key)?.count ?? 0) + inFlight >= 5) throw new UserError(429, 'Too many tries at once. Try again in a moment.', { retryAfter: 2 });
      pending.set(key, inFlight + 1);
    },
    failed(ip: string) {
      const key = clientKey(ip);
      done(key);
      const f = fails.get(key);
      fails.set(key, { count: (f && now() - f.last <= 15 * 60000 ? f.count : 0) + 1, last: now() });
    },
    succeeded(ip: string) {
      const key = clientKey(ip);
      done(key);
      fails.delete(key);
    },
    /** A sign-in that couldn't be checked (the server's own trouble): not counted either way. */
    cancelled(ip: string) {
      done(clientKey(ip));
    },
    checkSignUp(ip: string) {
      prune();
      const key = clientKey(ip);
      const recent = (signups.get(key) ?? []).filter((t) => now() - t < 3600000);
      allSignups = allSignups.filter((t) => now() - t < 3600000);
      if (recent.length >= 20) throw new UserError(429, 'Too many new accounts from here. Try again later.');
      if (allSignups.length >= 60) throw new UserError(429, 'Too many new accounts just now. Try again later.');
    },
    /** An account was made (only those count toward the limits). */
    signedUp(ip: string) {
      const key = clientKey(ip);
      signups.set(key, [...(signups.get(key) ?? []).filter((t) => now() - t < 3600000), now()]);
      allSignups.push(now());
    },
  };
}
