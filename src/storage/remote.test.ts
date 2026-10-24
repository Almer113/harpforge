// Phase 14c: an account's library — the library's own code, against a real HarpForge
// server, its songs kept as files in data/users/<name>/.

import { strToU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as lib from './library';
import { accountBackend } from './remote';

// (Node's own modules and the server, loaded by name: the app's type-check doesn't cover them.)
const load = (name: string) => import(/* @vite-ignore */ name);
type Fs = { readFile(p: string, e: string): Promise<string>; readdir(p: string): Promise<string[]>; mkdtemp(p: string): Promise<string>; rm(p: string, o: object): Promise<void> };
let fs: Fs;
let dir: string;
let server: { close(cb: () => void): void };
let base: string;
let cookie: string;

const tab = (title: string, body = '4 5 6 |') => `---\ntitle: ${title}\n---\n${body}\n`;
const file = (p: string) => fs.readFile(`${dir}/users/ayu/${p}`, 'utf8');
const ls = (p: string) => fs.readdir(`${dir}/users/ayu/${p}`).catch(() => [] as string[]);

beforeAll(async () => {
  fs = await load('node:fs/promises');
  const os = await load('node:os');
  const http = await load('node:http');
  dir = await fs.mkdtemp(`${os.tmpdir()}/harpforge-lib-`);
  const { createApi } = await load('../../server/api.ts');
  const api = createApi({ dataDir: dir });
  const s = http.createServer((req: unknown, res: { writeHead(n: number): { end(): void } }) => void api(req, res).then((h: boolean) => h || res.writeHead(404).end()));
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  server = s;
  base = `http://127.0.0.1:${s.address().port}`;
  const signup = await fetch(`${base}/api/account/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ayu', password: 'harmonica' }) });
  cookie = /hf_session=[^;]+/.exec(signup.headers.get('set-cookie') ?? '')![0];
  lib.setLibraryBackend(accountBackend({ base, headers: { Cookie: cookie } }));
});

afterAll(async () => {
  lib.setLibraryBackend(null);
  await new Promise<void>((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('an account’s library', () => {
  it('is the account’s', async () => {
    expect(await lib.libraryKind()).toBe('account');
  });

  it('the demos come in once; then a song saved is a .htab file named by its title', async () => {
    await lib.seedDemos();
    const demos = (await lib.listTabs()).length;
    expect(demos).toBeGreaterThan(0);
    const id = await lib.saveTab(tab('Bengawan Solo', '4 5 6 |'));
    expect(await file('tabs/Bengawan Solo.htab')).toBe(tab('Bengawan Solo', '4 5 6 |'));
    const index = JSON.parse(await file('library.json'));
    expect(index.tabs.find((t: { id: string }) => t.id === id)).toMatchObject({ title: 'Bengawan Solo', file: 'tabs/Bengawan Solo.htab' });
    expect(index.meta.seeded).toBeDefined();
    expect((await lib.listTabs()).length).toBe(demos + 1);
  });

  it('each save is a version; a new title renames the file; two with one title get (2)', async () => {
    const id = await lib.saveTab(tab('Rasa Sayange', '4 |'));
    await lib.saveTab(tab('Rasa Sayange', '5 |'), id);
    expect((await lib.listVersions(id)).map((v) => v.text)).toEqual([tab('Rasa Sayange', '5 |'), tab('Rasa Sayange', '4 |')]);
    await lib.saveTab(tab('Rasa Sayang-e: Remix?', '5 |'), id);
    expect(await ls('tabs')).toContain('Rasa Sayang-e- Remix-.htab');
    expect(await ls('tabs')).not.toContain('Rasa Sayange.htab');
    const twin = await lib.saveTab(tab('Bengawan Solo', '7 |'));
    expect(await ls('tabs')).toContain('Bengawan Solo (2).htab');
    expect(JSON.parse(await file(`history/${id}.json`))).toHaveLength(3);
    await lib.deleteTab(twin);
  });

  it('trash: the file moves to trash/ and back; deleted for good, it and its history go', async () => {
    const id = await lib.saveTab(tab('Gundul Pacul'));
    await lib.trashTab(id);
    expect(await ls('trash')).toContain('Gundul Pacul.htab');
    expect(await ls('tabs')).not.toContain('Gundul Pacul.htab');
    expect((await lib.listTrash()).map((t) => t.id)).toContain(id);
    await lib.untrashTab(id);
    expect(await ls('tabs')).toContain('Gundul Pacul.htab');
    await lib.trashTab(id);
    await lib.emptyTrash();
    expect(await ls('trash')).toEqual([]);
    expect(await ls('history')).not.toContain(`${id}.json`);
    expect(await lib.tabStatus(id)).toBe('deleted');
  });

  it('saved from somewhere else in between: the server refuses (a clash), even past the window’s own check', async () => {
    const id = await lib.saveTab(tab('Ampar', '4 |'));
    // Another device saves it…
    const other = accountBackend({ base, headers: { Cookie: cookie } });
    const now = (await other.tabs.get(id))!;
    await other.tabs.put({ ...now, text: tab('Ampar', '6 |') }, now.text);
    // …and this window, which had "4 |", saves its own.
    await expect(lib.saveTab(tab('Ampar', '5 |'), id, { expect: tab('Ampar', '4 |') })).rejects.toBeInstanceOf(lib.SaveClash);
    // A write over text that changed after it was read is refused by the server itself.
    await expect(other.tabs.put({ ...now, text: tab('Ampar', '7 |') }, tab('Ampar', '4 |'))).rejects.toThrow('changed since it was read');
    expect((await lib.getTab(id))?.text).toBe(tab('Ampar', '6 |'));
  });

  it('names a version; a full backup restores into it with history; undo takes it out', async () => {
    const id = await lib.saveTab(tab('Kicir', '4 |'));
    await lib.saveTab(tab('Kicir', '5 |'), id);
    const [v] = await lib.listVersions(id);
    await lib.nameVersion(v.id, 'before the bridge');
    expect((await lib.listVersions(id))[0].name).toBe('before the bridge');
    const zip = lib.readBackup(await lib.exportLibrary({ full: true }));
    await lib.deleteTab(id);
    const r = await lib.importLibrary(zip);
    expect(r.added).toBe(1);
    expect((await lib.listVersions(id)).map((x) => x.name ?? null)).toEqual(['before the bridge', null]);
    await lib.undoImport(r);
    expect(await lib.getTab(id)).toBeUndefined();
    const plain = await lib.importLibrary({ 'x.htab': strToU8(tab('From a zip')) });
    expect(plain.added).toBe(1);
  });

  it('size, and nothing left to recover from the browser (the account’s isn’t cleared by it)', async () => {
    const s = await lib.libraryStats();
    expect(s.tabs).toBe((await lib.listTabs()).length);
    expect(s.versions).toBeGreaterThanOrEqual(s.tabs);
    expect(await lib.recoverableTabs()).toEqual([]);
  });

  it('signed out (or someone else): the library isn’t there for them', async () => {
    const nobody = accountBackend({ base });
    await expect(nobody.tabs.all()).rejects.toThrow(/signed out/);
    const evil = await fetch(`${base}/api/library/tabs/x`, { method: 'DELETE', headers: { Cookie: cookie, Origin: 'http://evil.example' } });
    expect(evil.status).toBe(403);
    const sneaky = await fetch(`${base}/api/library/versions?tab=..%2F..%2Faccounts%2Fayu`, { headers: { Cookie: cookie } });
    expect(sneaky.status).toBe(400);
  });
});
