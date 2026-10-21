import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameEvents } from './GameEvents';

afterEach(() => gameEvents.clear());

describe('gameEvents', () => {
  it('delivers the typed detail synchronously and unsubscribes', () => {
    const seen: number[] = [];
    const off = gameEvents.on('player-near-miss', ({ speed }) => seen.push(speed));
    gameEvents.emit('player-near-miss', { speed: 12 });
    off();
    gameEvents.emit('player-near-miss', { speed: 30 });
    expect(seen).toEqual([12]);
  });

  it('does not touch window', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    gameEvents.emit('camera-rumble', { intensity: 0.3 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('GameEventMap coverage (#503 C)', () => {
  const source = readFileSync('src/systems/events/GameEvents.ts', 'utf8');
  const body = source.match(/export interface GameEventMap \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const mapKeys = [...body.matchAll(/^\s+'?([\w-]+)'?:/gm)].map((m) => m[1]).sort();

  const files = (readdirSync('src', { recursive: true }) as string[])
    .map((f) => join('src', f))
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.includes('__tests__'));
  const listened = new Set<string>();
  const emitted = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/gameEvents\.on\(\s*'([\w-]+)'/g)) listened.add(m[1]);
    for (const m of text.matchAll(/gameEvents\.emit\(\s*'([\w-]+)'/g)) emitted.add(m[1]);
  }

  it('parses the map', () => {
    expect(mapKeys.length).toBeGreaterThan(10);
  });

  it('every event has a listener (or it does not exist)', () => {
    expect(mapKeys.filter((k) => !listened.has(k))).toEqual([]);
  });

  it('every event is emitted somewhere', () => {
    expect(mapKeys.filter((k) => !emitted.has(k))).toEqual([]);
  });

  it('nothing outside the map is emitted or listened to', () => {
    const known = new Set(mapKeys);
    expect([...emitted, ...listened].filter((k) => !known.has(k))).toEqual([]);
  });
});
