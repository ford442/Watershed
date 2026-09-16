import { describe, expect, it } from 'vitest';
import {
  decodeHtml,
  parseAssetRefs,
  parseBuildIdMeta,
  parseEntryScript,
} from './verify_deploy.mjs';

describe('verify_deploy predicates', () => {
  it('flags UTF-16LE BOM as not utf-8', () => {
    const buf = Buffer.from([0xff, 0xfe, 0x3c, 0x00, 0x68, 0x00]);
    const dec = decodeHtml(buf);
    expect(dec.encoding).toBe('utf-16le');
    expect(dec.encoding === 'utf-8').toBe(false);
  });

  it('reads utf-8 HTML as utf-8', () => {
    const buf = Buffer.from('<!DOCTYPE html><meta name="build-id" content="abc" />', 'utf8');
    expect(decodeHtml(buf).encoding).toBe('utf-8');
    expect(parseBuildIdMeta(decodeHtml(buf).text)).toBe('abc');
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
});
