// @vitest-environment node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUND_DEFS, PRELOAD_SOUNDS, isSoundAlias, resolveSoundFile } from './soundDefs';

const SOUNDS_DIR = path.resolve(__dirname, '../../../public/sounds');

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(path.join(SOUNDS_DIR, file))).digest('hex');
}

const fileEntries = Object.entries(SOUND_DEFS).filter(([, def]) => !isSoundAlias(def)) as Array<
  [string, { file: string }]
>;

describe('SOUND_DEFS ↔ public/sounds', () => {
  it('every file entry has a payload on disk', () => {
    for (const [name, def] of fileEntries) {
      expect(fs.existsSync(path.join(SOUNDS_DIR, def.file)), `${name} → ${def.file}`).toBe(true);
    }
  });

  it('no two file entries point at the same file', () => {
    const files = fileEntries.map(([, def]) => def.file);
    expect(new Set(files).size).toBe(files.length);
  });

  // BUILD_HYGIENE.md §6.3: 23 files used to carry 6 payloads. Two *different*
  // names may only share bytes through a declared `aliasOf`.
  it('no two file entries share a SHA-256', () => {
    const byHash = new Map<string, string[]>();
    for (const [name, def] of fileEntries) {
      const hash = sha256(def.file);
      byHash.set(hash, [...(byHash.get(hash) ?? []), name]);
    }
    const shared = [...byHash.values()].filter((names) => names.length > 1);
    expect(shared).toEqual([]);
  });

  it('every shipped .mp3 is distinct and referenced', () => {
    const onDisk = fs.readdirSync(SOUNDS_DIR).filter((f) => f.endsWith('.mp3'));
    const hashes = new Set(onDisk.map(sha256));
    expect(hashes.size).toBe(onDisk.length);

    const referenced = new Set(fileEntries.map(([, def]) => def.file));
    expect(onDisk.filter((f) => !referenced.has(f))).toEqual([]);
  });

  it('is real audio, not the 17,180-byte sine stubs', () => {
    for (const [, def] of fileEntries) {
      const size = fs.statSync(path.join(SOUNDS_DIR, def.file)).size;
      expect(size, def.file).not.toBe(17180);
    }
  });

  it('aliases resolve to a file entry, never to another alias', () => {
    for (const [name, def] of Object.entries(SOUND_DEFS)) {
      if (!isSoundAlias(def)) continue;
      const target = SOUND_DEFS[def.aliasOf];
      expect(target, `${name} → ${def.aliasOf}`).toBeDefined();
      expect(isSoundAlias(target!), `${name} → ${def.aliasOf} is itself an alias`).toBe(false);
      expect(resolveSoundFile(name)).toBe(target);
    }
  });

  it('speed-wind never borrows the biome wind payload', () => {
    // The speed layer is synthesized; nothing in the library may stand in for it.
    expect(Object.keys(SOUND_DEFS).some((n) => /speed.?wind/i.test(n))).toBe(false);
  });

  it('preload list names real sounds', () => {
    for (const name of PRELOAD_SOUNDS) expect(resolveSoundFile(name), name).not.toBeNull();
  });
});
