// The hyphenation library has no types of its own: what HarpForge uses of it.
declare module 'hyphen/en-us' {
  export function hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number; exceptions?: string[] }): string;
}
