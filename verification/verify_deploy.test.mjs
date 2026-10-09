import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkDirectoryDocuments,
  checkHtaccess,
  checkIsolationHeaders,
  decodeHtml,
  parseAssetRefs,
  parseBuildIdMeta,
  parseContentType,
  parseEntryScript,
  parseTitle,
} from './verify_deploy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// The 729 bytes https://test.1ink.us/watershed/ served on 2026-10-04: UTF-8, no BOM,
// labelled `text/html; charset=utf-16`, which Chrome decodes as UTF-16LE (zero scripts).
const LIVE_BODY = fs.readFileSync(path.join(here, 'fixtures', 'live-dir-2026-10-04.html'));
const LIVE_TEXT = LIVE_BODY.toString('utf8');
const UTF8 = 'text/html; charset=utf-8';
const UTF16 = 'text/html; charset=utf-16';

describe('verify_deploy predicates', () => {
  it('flags UTF-16LE BOM as not utf-8', () => {
    const buf = Buffer.from([0xff, 0xfe, 0x3c, 0x00, 0x68, 0x00]);
    const dec = decodeHtml(buf);
    expect(dec.encoding).toBe('utf-16le');
    expect(dec.encoding === 'utf-8').toBe(false);
    expect(dec.ok).toBe(false);
  });

  it('reads utf-8 HTML labelled charset=utf-8 as utf-8', () => {
    const buf = Buffer.from('<!DOCTYPE html><meta name="build-id" content="abc" />', 'utf8');
    const dec = decodeHtml(buf, UTF8);
    expect(dec.encoding).toBe('utf-8');
    expect(dec.source).toBe('transport');
    expect(parseBuildIdMeta(dec.text)).toBe('abc');
  });

  it('extracts module entry and asset refs', () => {
    const html = `<script type="module" crossorigin src="./assets/index-8Gl23hpQ.js"></script>
<link rel="stylesheet" href="./assets/index-oyc_X4uC.css">`;
    expect(parseEntryScript(html)).toBe('./assets/index-8Gl23hpQ.js');
    expect(parseAssetRefs(html)).toEqual([
      './assets/index-8Gl23hpQ.js',
      './assets/index-oyc_X4uC.css',
    ]);
  });

  it('missing build-id meta is null', () => {
    expect(parseBuildIdMeta('<title>WATERSHED</title>')).toBeNull();
  });

  it('reads the title', () => {
    expect(parseTitle(LIVE_TEXT)).toBe('WATERSHED');
    expect(parseTitle('<html></html>')).toBeNull();
  });
});

describe('decodeHtml follows browser order (BOM, Content-Type, <meta charset>)', () => {
  it('the live body under charset=utf-16 is a failure, not UTF-8 text', () => {
    expect(LIVE_BODY.length).toBe(729);
    const dec = decodeHtml(LIVE_BODY, UTF16);
    expect(dec.ok).toBe(false);
    expect(dec.encoding).toBe('utf-16le');
    expect(dec.source).toBe('transport');
    expect(dec.text).not.toContain('<!DOCTYPE');
    expect(dec.text).not.toBe(LIVE_TEXT);
    expect(dec.problems.join('\n')).toMatch(/utf-16/i);
  });

  it('a BOM-less UTF-8 body under charset=utf-8 passes', () => {
    const dec = decodeHtml(LIVE_BODY, UTF8);
    expect(dec.ok).toBe(true);
    expect(dec.encoding).toBe('utf-8');
    expect(dec.problems).toEqual([]);
    expect(dec.text).toBe(LIVE_TEXT);
  });

  it('a UTF-8 BOM wins over a utf-16 label, but the label is still reported', () => {
    const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), LIVE_BODY]);
    const dec = decodeHtml(body, UTF16);
    expect(dec.encoding).toBe('utf-8');
    expect(dec.source).toBe('bom');
    expect(dec.text).toBe(LIVE_TEXT);
    expect(dec.ok).toBe(false);
    expect(dec.problems.join('\n')).toMatch(/charset=utf-16/);
  });

  it('the pre-2026-09-26 shadow (UTF-16LE + BOM, charset=utf-16) is not UTF-8', () => {
    const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(LIVE_TEXT, 'utf16le')]);
    const dec = decodeHtml(body, UTF16);
    expect(dec.encoding).toBe('utf-16le');
    expect(dec.source).toBe('bom');
    expect(dec.text).toBe(LIVE_TEXT);
    expect(dec.ok).toBe(false);
  });

  it('with no charset header, <meta charset> decides', () => {
    const dec = decodeHtml(LIVE_BODY, 'text/html');
    expect(dec.source).toBe('meta');
    expect(dec.encoding).toBe('utf-8');
    expect(dec.ok).toBe(true);
  });

  it('with no charset anywhere the browser default (windows-1252) is not UTF-8', () => {
    const dec = decodeHtml(Buffer.from('<!DOCTYPE html><title>x</title>'), 'text/html');
    expect(dec.source).toBe('default');
    expect(dec.encoding).toBe('windows-1252');
    expect(dec.ok).toBe(false);
  });

  it('a non-UTF-8 transport label fails even when the meta tag says utf-8', () => {
    const dec = decodeHtml(LIVE_BODY, 'text/html; charset=iso-8859-1');
    expect(dec.ok).toBe(false);
    expect(dec.encoding).toBe('windows-1252');
  });

  it('parses Content-Type parameters (first charset wins, quotes allowed)', () => {
    expect(parseContentType('Text/HTML; Charset="UTF-16"')).toEqual({ essence: 'text/html', charset: 'UTF-16' });
    expect(parseContentType('text/html; charset=utf-8; charset=utf-16').charset).toBe('utf-8');
    expect(parseContentType('text/html').charset).toBeNull();
    expect(parseContentType(undefined)).toEqual({ essence: '', charset: null });
  });
});

describe('checkDirectoryDocuments', () => {
  const index = { buf: LIVE_BODY, contentType: 'text/html' };

  it('passes when the directory URL and index.html are the build document', () => {
    const dir = { buf: LIVE_BODY, contentType: UTF8 };
    const res = checkDirectoryDocuments({ dir, index, builtIndexText: LIVE_TEXT });
    expect(res.failures).toEqual([]);
  });

  it('fails the live 2026-10-04 state: directory labelled utf-16, index.html fine', () => {
    const dir = { buf: LIVE_BODY, contentType: UTF16 };
    const res = checkDirectoryDocuments({ dir, index, builtIndexText: LIVE_TEXT });
    expect(res.failures.length).toBeGreaterThan(0);
    expect(res.failures.some((f) => f.startsWith('directory URL:') && /utf-16/i.test(f))).toBe(true);
    expect(res.failures.some((f) => /different documents/.test(f))).toBe(true);
    expect(res.failures.some((f) => f.startsWith('index.html:'))).toBe(false);
  });

  it('fails when the directory URL and index.html decode to different documents', () => {
    const other = Buffer.from(LIVE_TEXT.replace('6dae9a5', 'beefcafe'), 'utf8');
    const dir = { buf: other, contentType: UTF8 };
    const res = checkDirectoryDocuments({ dir, index, builtIndexText: LIVE_TEXT });
    expect(res.failures.some((f) => /different documents/.test(f))).toBe(true);
    expect(res.failures.some((f) => f.startsWith('directory URL: decoded document is not build/index.html'))).toBe(true);
  });

  it('fails when both are the same UTF-8 document but not the build', () => {
    const dir = { buf: LIVE_BODY, contentType: UTF8 };
    const res = checkDirectoryDocuments({ dir, index, builtIndexText: LIVE_TEXT.replace('6dae9a5', 'beefcafe') });
    expect(res.failures).toHaveLength(2);
    expect(res.failures.every((f) => /not build\/index\.html/.test(f))).toBe(true);
  });
});

describe('checkIsolationHeaders', () => {
  it('fails on COEP and only notes COOP', () => {
    const res = checkIsolationHeaders('directory URL', { coep: 'require-corp', coop: 'same-origin' });
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toMatch(/require-corp/);
    expect(res.notes).toHaveLength(1);
  });

  it('passes with neither header', () => {
    expect(checkIsolationHeaders('index.html', { coep: null, coop: null })).toEqual({ failures: [], notes: [] });
  });
});

describe('checkHtaccess', () => {
  const shipped = fs.readFileSync(path.join(here, '..', 'public', '.htaccess'), 'utf8');

  it('accepts public/.htaccess', () => {
    expect(checkHtaccess(shipped)).toEqual([]);
  });

  it('rejects a file that sets COEP or COOP', () => {
    for (const header of ['Cross-Origin-Embedder-Policy "require-corp"', 'Cross-Origin-Opener-Policy "same-origin"']) {
      for (const verb of ['Header set', 'Header always set', 'Header always append']) {
        const failures = checkHtaccess(`${shipped}\n${verb} ${header}\n`);
        expect(failures.join('\n')).toMatch(/cross-origin isolation/);
      }
    }
  });

  it('ignores commented-out directives and accepts `unset`', () => {
    const text = `${shipped}\n# Header set Cross-Origin-Embedder-Policy "require-corp"\n`;
    expect(checkHtaccess(text)).toEqual([]);
    expect(shipped).toMatch(/Header always unset Cross-Origin-Embedder-Policy/);
  });

  it('rejects a file without DirectoryIndex or the UTF-8 charset lines', () => {
    expect(checkHtaccess(shipped.replace(/^\s*DirectoryIndex.*$/m, '')).join('\n')).toMatch(/DirectoryIndex/);
    expect(checkHtaccess(shipped.replace(/^\s*AddDefaultCharset.*$/m, '')).join('\n')).toMatch(/AddDefaultCharset/);
    expect(checkHtaccess(shipped.replace('.wasm', '')).join('\n')).toMatch(/\.wasm/);
  });

  it('guards every block with IfModule so a missing module is not an HTTP 500', () => {
    const opens = shipped.match(/<IfModule\s/g) ?? [];
    const closes = shipped.match(/<\/IfModule>/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(3);
    expect(opens.length).toBe(closes.length);
  });
});
