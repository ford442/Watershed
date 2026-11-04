/** Test helpers: serve the committed public/packs/ tree through a fetch stub. */
import fs from 'node:fs';
import path from 'node:path';

export const PACKS_DIR = path.resolve(__dirname, '../../../public/packs');

export function readCommittedManifest(pack: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(PACKS_DIR, pack, 'manifest.json'), 'utf8'));
}

/** A fetch that answers `/packs/<pack>/<file>[?v=…]` from disk and records every URL. */
export function diskFetch(urls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const match = /packs\/([^/]+)\/([^?]+)/.exec(url);
    const file = match ? path.join(PACKS_DIR, match[1] as string, match[2] as string) : null;
    if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    const bytes = fs.readFileSync(file);
    return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
      status: 200,
    });
  }) as typeof fetch;
}
