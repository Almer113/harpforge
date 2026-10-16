// Phase 14b: the app's side of accounts — answers, refusals, and no server at all.

import { afterEach, expect, it, vi } from 'vitest';
import { currentAccount, signIn, signUp } from './client';

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

it('who’s signed in: the account, or no one', async () => {
  vi.stubGlobal('fetch', answer(200, { user: { name: 'Almer' } }));
  expect(await currentAccount()).toEqual({ ok: true, user: { name: 'Almer' } });
  vi.stubGlobal('fetch', answer(200, { user: null }));
  expect(await currentAccount()).toEqual({ ok: true, user: null });
});

it('a refusal says why (and when to try again)', async () => {
  vi.stubGlobal('fetch', answer(409, { error: 'That name is taken. Try another, or sign in.' }));
  expect(await signUp('Budi', 'secret1')).toMatchObject({ ok: false, reason: 'refused', message: 'That name is taken. Try another, or sign in.' });
  vi.stubGlobal('fetch', answer(429, { error: 'Too many wrong passwords. Try again in 4 s.', retryAfter: 4 }));
  expect(await signIn('Budi', 'x')).toMatchObject({ ok: false, reason: 'refused', retryAfter: 4 });
});

it('no server (or something else answering): accounts aren’t available', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
  expect(await currentAccount()).toMatchObject({ ok: false, reason: 'offline' });
  // (A plain web server: the app's page where the API would be.)
  vi.stubGlobal('fetch', answer(200, '<!doctype html><title>HarpForge</title>'));
  expect(await currentAccount()).toMatchObject({ ok: false, reason: 'offline' });
  vi.stubGlobal('fetch', answer(404, '<html>Not found</html>'));
  expect(await currentAccount()).toMatchObject({ ok: false, reason: 'offline' });
});
