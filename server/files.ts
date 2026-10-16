// Files written whole or not at all: to a temporary file first, then renamed over the old
// one, so a crash or a full disk never leaves half a song.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data);
    // (Windows may hold the file a moment — an editor, antivirus, the search indexer: tried again.)
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        break;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e;
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
      }
    }
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** A JSON file's contents; `fallback` if it isn't there (any other trouble throws). */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
  return JSON.parse(text) as T;
}

export function writeJson(file: string, value: unknown): Promise<void> {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}
