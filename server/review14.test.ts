// The Phase 14 review's server cases: a title's capitals changed, titles cut mid-emoji,
// sign-in guesses sent all at once, other names for this server, odd keys in merges.

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SavedTab } from '../src/storage/types.ts';
import { clientKey, createLimits } from './accounts.ts';
import { fileTitle, userLibrary } from './library.ts';
import { allowedHost } from './hosts.ts';
import { mergePractice, mergeSyllables } from './userdata.ts';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'harpforge-rev-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const tab = (id: string, title: string, text = '4 |'): SavedTab => ({ id, title, harmonica: 'C', text: `---\ntitle: ${title}\n---\n${text}\n`, createdAt: 1, updatedAt: 1 });

describe('song files', () => {
  it('only the capitals of a title changed: the song stays (one file, the same one)', async () => {
    const lib = userLibrary(dir, 'caps');
    await lib.putTab(tab('a1', 'ode to joy'));
    await lib.putTab(tab('a1', 'Ode To Joy', '5 |'));
    expect((await lib.getTab('a1'))?.text).toContain('5 |');
    expect(await readdir(path.join(dir, 'users', 'caps', 'tabs'))).toHaveLength(1);
  });

  it('two long titles that differ only after a cut mid-emoji: two files', async () => {
    const lib = userLibrary(dir, 'emoji');
    const a = `${'x'.repeat(79)}😀`;
    const b = `${'x'.repeat(79)}${String.fromCodePoint(0x20000)}`;
    expect(fileTitle(a)).not.toContain('�');
    await lib.putTab(tab('e1', a, 'first'));
    await lib.putTab(tab('e2', b, 'second'));
    expect((await lib.getTab('e1'))?.text).toContain('first');
    expect((await lib.getTab('e2'))?.text).toContain('second');
  });
});

describe('sign-in limits', () => {
  it('guesses sent all at once: only a few are checked before the wait starts', () => {
    const lim = createLimits(() => 0);
    let allowed = 0;
    for (let i = 0; i < 200; i++) {
      try {
        lim.checkSignIn('10.0.0.9');
        allowed++;
      } catch {
        /* refused */
      }
    }
    expect(allowed).toBe(5);
  });

  it('an IPv6 device counts as its network (any address in it); IPv4 as itself', () => {
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe(clientKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(clientKey('::ffff:192.168.1.20')).toBe('192.168.1.20');
    expect(clientKey('192.168.1.20')).not.toBe(clientKey('192.168.1.21'));
  });
});

describe('this server’s names', () => {
  it('localhost and this computer’s addresses; not another site’s name', () => {
    expect(allowedHost('localhost:5280')).toBe(true);
    expect(allowedHost('127.0.0.1:5280')).toBe(true);
    expect(allowedHost('[::1]:5280')).toBe(true);
    expect(allowedHost('evil.example:5280')).toBe(false);
    expect(allowedHost(undefined)).toBe(false);
  });
});

describe('merges', () => {
  it('a song or word called "constructor" is just one', () => {
    expect(mergePractice({}, { constructor: [{ at: 1 }] })['constructor' as string].map((e) => e.at)).toEqual([1]);
    expect(mergeSyllables({}, { en: { constructor: 'con-struc-tor' } }).en.constructor).toBe('con-struc-tor');
  });

  it('bringing a browser’s fixes in: the account’s own stay', () => {
    expect(mergeSyllables({ en: { every: 'ev-er-y' } }, { en: { every: 'ev-ery', river: 'riv-er' } }, 'had').en).toEqual({ every: 'ev-er-y', river: 'riv-er' });
  });
});

describe('the runtime test’s cases', () => {
  it('Windows device names — with anything after a dot, or a superscript digit — never become files or accounts', async () => {
    const { checkName } = await import('./accounts.ts');
    for (const t of ['nul.txt', 'aux.song', 'COM¹', 'conin$', 'CONOUT$', 'lpt1.x', 'con .x', 'Clock$', 'CON']) expect(fileTitle(t).startsWith('_')).toBe(true);
    expect(fileTitle('Console')).toBe('Console');
    for (const n of ['nul.a', 'con.x', 'com¹', 'lpt²']) expect(() => checkName(n)).toThrow(/can’t be used/);
    expect(checkName('Connie').key).toBe('connie');
  });

  it('only accounts actually made count toward the sign-up limit', () => {
    const lim = createLimits(() => 0);
    for (let i = 0; i < 50; i++) lim.checkSignUp('10.1.1.1');
    for (let i = 0; i < 20; i++) lim.signedUp('10.1.1.1');
    expect(() => lim.checkSignUp('10.1.1.1')).toThrow(/Too many/);
  });

  it('versions: counted without sending them; one looked for, or deleted, in its tab’s history only', async () => {
    const lib = userLibrary(dir, 'stats');
    const v = (id: string, tabId: string, text: string) => ({ id, tabId, at: 1, text, title: 'T', kind: 'save' as const });
    await lib.addVersions([v('v1', 't1', 'abc'), v('v2', 't1', 'de'), v('v3', 't2', 'f')]);
    expect(await lib.versionStats()).toEqual({ versions: 3, bytes: 6 });
    expect((await lib.getVersion('v3', 't2'))?.text).toBe('f');
    expect(await lib.getVersion('v3', 't1')).toBeNull();
    await lib.deleteVersions(['v1', 'v3'], 't1');
    expect((await lib.allVersions()).map((x) => x.id).sort()).toEqual(['v2', 'v3']);
  });

  it('a lock kept by a long change: others wait (it isn’t taken from it), then go on', async () => {
    const { withLock } = await import('./library.ts');
    const d = path.join(dir, 'users', 'long');
    const order: string[] = [];
    const first = withLock(d, async () => {
      order.push('a start');
      await new Promise((r) => setTimeout(r, 300));
      order.push('a end');
    });
    await new Promise((r) => setTimeout(r, 20));
    const second = withLock(d, async () => void order.push('b'));
    await Promise.all([first, second]);
    expect(order).toEqual(['a start', 'a end', 'b']);
    expect(await readdir(d)).toEqual([]);
  });
});
