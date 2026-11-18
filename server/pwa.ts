// Installing HarpForge as an app: a build step (a Vite plugin) that writes dist/sw.js, the
// service worker, from src/pwa/sw.js with this build's files and version filled in. (Here
// with the server because it's Node code, checked and tested with it.)

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const TEMPLATE = path.join(import.meta.dirname, '..', 'src', 'pwa', 'sw.js');

/** Every file under `dir`, as forward-slash paths relative to it. */
function filesIn(dir: string, prefix = ''): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

/** What the worker keeps: the page, the built files and public/'s, without notes and itself. */
export function precacheList(built: string[], publicFiles: string[]): string[] {
  const all = ['index.html', ...built, ...publicFiles].filter((f) => !/\.(md|map)$/i.test(f) && f !== 'sw.js' && !f.startsWith('.'));
  return [...new Set(all)].sort();
}

/**
 * The service worker's code for these files. Its version changes whenever their names or
 * `contents` do — public/'s files keep their names when they change (a new icon), so
 * their contents count too: a new version is what makes installed copies fetch them again.
 */
export function serviceWorkerSource(template: string, files: string[], contents: (string | Uint8Array)[] = []): string {
  const hash = createHash('sha256').update(files.join('\n'));
  for (const c of contents) hash.update('\0').update(c);
  const version = hash.digest('hex').slice(0, 12);
  return template.replace('self.HF_BUILD_FILES', JSON.stringify(files)).replace('HF_BUILD_VERSION', version);
}

/** The Vite plugin: on `vite build`, dist/sw.js. (Not in the dev server, which doesn't register it.) */
export function harpforgeServiceWorker() {
  let publicDir = '';
  return {
    name: 'harpforge-service-worker',
    apply: 'build' as const,
    configResolved(config: { publicDir: string }) {
      publicDir = config.publicDir;
    },
    generateBundle(
      this: { emitFile(f: { type: 'asset'; fileName: string; source: string }): void },
      _options: unknown,
      bundle: Record<string, unknown>,
    ) {
      const fromPublic = publicDir ? filesIn(publicDir) : [];
      const files = precacheList(Object.keys(bundle), fromPublic);
      const contents = [
        ...Object.keys(bundle)
          .sort()
          .map((name) => {
            const out = bundle[name] as { code?: string; source?: string | Uint8Array };
            return out.code ?? out.source ?? '';
          }),
        ...fromPublic.filter((f) => files.includes(f)).map((f) => readFileSync(path.join(publicDir, f))),
      ];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(readFileSync(TEMPLATE, 'utf8'), files, contents) });
    },
  };
}
