import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isTruthyFlag, parseQueryFlags, queryFlags } from './queryFlags';

describe('parseQueryFlags', () => {
  it('reads ?debug=1 and ?debug=true as the same flag', () => {
    expect(parseQueryFlags('?debug=1').debug).toBe(true);
    expect(parseQueryFlags('?debug=true').debug).toBe(true);
    expect(parseQueryFlags('debug=1&map=glacial').debug).toBe(true);
    for (const off of ['', '?debug', '?debug=0', '?debug=false', '?debug=yes', '?debugStages=a,b', '?nodebug=1']) {
      expect(parseQueryFlags(off).debug).toBe(false);
    }
  });

  it('reads the boolean flags', () => {
    const flags = parseQueryFlags('?no-pointer-lock&screenshot=1&safe=true');
    expect(flags.noPointerLock).toBe(true);
    expect(flags.screenshot).toBe(true);
    expect(flags.safe).toBe(true);
    expect(parseQueryFlags('?screenshot=0').screenshot).toBe(false);
    expect(parseQueryFlags('?x=1').noPointerLock).toBe(false);
    // The substring test the call sites always used.
    expect(parseQueryFlags('?no-pointer-lock=1').noPointerLock).toBe(true);
  });

  it('keeps the string flags raw, null when absent', () => {
    const flags = parseQueryFlags(
      '?map=glacial&vehicle=raft&material=tsl&renderer=webgpu&input=script:/a.json&replay=/g.wsghost' +
        '&simWorker=0&river=abc&level=x.json&levelUrl=https%3A%2F%2Fh%2Fl.json&reach=r1&reachId=r2&seed=42',
    );
    expect(flags).toMatchObject({
      map: 'glacial',
      vehicle: 'raft',
      material: 'tsl',
      renderer: 'webgpu',
      input: 'script:/a.json',
      replay: '/g.wsghost',
      simWorker: '0',
      river: 'abc',
      level: 'x.json',
      levelUrl: 'https://h/l.json',
      reach: 'r1',
      reachId: 'r2',
      seed: '42',
    });
    const none = parseQueryFlags('');
    for (const key of ['map', 'vehicle', 'material', 'renderer', 'input', 'replay', 'simWorker', 'river', 'level', 'levelUrl', 'reach', 'reachId', 'seed'] as const) {
      expect(none[key]).toBeNull();
    }
  });

  it('accepts a query string with or without its leading ?', () => {
    expect(parseQueryFlags('map=a')).toEqual(expect.objectContaining({ map: 'a' }));
    expect(parseQueryFlags('?map=a')).toEqual(expect.objectContaining({ map: 'a' }));
  });

  it('is frozen', () => {
    const flags = parseQueryFlags('?debug=1');
    expect(Object.isFrozen(flags)).toBe(true);
    expect(() => {
      (flags as { debug: boolean }).debug = false;
    }).toThrow(TypeError);
  });
});

describe('queryFlags (the page snapshot)', () => {
  it('is a frozen object parsed from the page\'s query string at load', () => {
    expect(Object.isFrozen(queryFlags)).toBe(true);
    expect(queryFlags.search).toBe(window.location.search);
    expect(queryFlags).toEqual(parseQueryFlags(window.location.search));
  });

  it('does not follow later URL changes (parsed once)', () => {
    const before = queryFlags.debug;
    window.history.replaceState({}, '', '/?debug=1');
    expect(queryFlags.debug).toBe(before);
    window.history.replaceState({}, '', '/');
  });
});

describe('isTruthyFlag', () => {
  it('is 1 or true, nothing else', () => {
    expect(isTruthyFlag('1')).toBe(true);
    expect(isTruthyFlag('true')).toBe(true);
    for (const v of ['', '0', 'false', 'TRUE', 'yes', null, undefined]) expect(isTruthyFlag(v as never)).toBe(false);
  });
});

describe('the former location.search.includes() call sites', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const sites = [
    '../Experience.tsx',
    '../experience/HeadlessSkySphere.tsx',
    '../vehicles/RunnerVehicle.tsx',
    '../vehicles/RunnerVehicle/hooks/RunnerPhysicsStep.ts',
  ];

  it('read the flag object, not the URL', () => {
    for (const path of sites) {
      const src = read(path);
      expect(src, path).not.toMatch(/location\.search/);
      expect(src, path).toMatch(/queryFlags\./);
    }
  });

  it('keep App and the experience hooks off the includes() form', () => {
    for (const path of ['../App.tsx', '../experience/hooks/useInnerExperience.ts', '../experience/hooks/useExperienceWorld.ts']) {
      expect(read(path), path).not.toMatch(/location\.search\.includes\(/);
    }
  });

  it('the per-frame runner step does not parse anything', () => {
    const src = read('../vehicles/RunnerVehicle/hooks/RunnerPhysicsStep.ts');
    expect(src).not.toMatch(/URLSearchParams|window\.location/);
  });
});
