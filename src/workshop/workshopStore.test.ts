import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import hydroLevel from '../maps/hydro_dam.json';
import {
  COALESCE_WINDOW_MS,
  HISTORY_LIMIT,
  resetWorkshopForTests,
  selectSegments,
  setWorkshopClockForTests,
  workshopStore,
} from './workshopStore';
import { levelToEditorSegments } from './editorSegments';
import { createBlankRiver } from './workshopTemplates';
import type { LevelData } from '../systems/map/MapSystem.types';

let clock = 0;
const s = () => workshopStore.getState();
const history = () => workshopStore.temporal.getState();

beforeEach(() => {
  clock = 0;
  setWorkshopClockForTests(() => clock);
  resetWorkshopForTests();
});
afterEach(() => setWorkshopClockForTests(null));

describe('workshopStore', () => {
  it('holds LevelData as the source of truth and derives the inspector rows', () => {
    s().loadLevel(createBlankRiver());
    const rows = selectSegments(s());
    expect(rows).toHaveLength(5);
    expect(selectSegments(s())).toBe(rows); // memoised per level object
    s().updateSegment(2, { difficulty: 0.9 });
    expect(s().level!.segments[2].difficulty).toBe(0.9);
    expect(selectSegments(s())[2].difficulty).toBe(0.9);
  });

  it('undo / redo cover every level edit, and load is one undoable step', () => {
    const blank = createBlankRiver();
    s().loadLevel(blank);
    s().updateSegment(0, { verticalBias: -2 });
    s().setWorldBiome('glacier');
    expect(s().level!.world.biome.baseType).toBe('glacier');
    s().undo();
    expect(s().level!.world.biome.baseType).toBe('canyonSummer');
    expect(s().level!.segments[0].verticalBias).toBe(-2);
    s().undo();
    expect(s().level!.segments[0].verticalBias).toBe(-0.5);
    s().undo();
    expect(s().level).toBeNull();
    s().redo();
    s().redo();
    s().redo();
    expect(s().level!.world.biome.baseType).toBe('glacier');
    expect(history().futureStates).toHaveLength(0);
  });

  it('selection, viewport and camera are not undo steps', () => {
    s().loadLevel(createBlankRiver());
    const steps = history().pastStates.length;
    s().selectSegment(3);
    s().setViewportMode('top');
    s().setCamera({ position: [1, 2, 3], target: [0, 0, 0] });
    expect(history().pastStates.length).toBe(steps);
  });

  it('coalesces one drag into one step, and the gesture end closes it', () => {
    s().loadLevel(createBlankRiver());
    const base = history().pastStates.length;
    for (let i = 1; i <= 20; i++) {
      clock += 16;
      s().updateSegment(1, { difficulty: i / 20 }, { coalesce: 'seg:1:difficulty' });
    }
    expect(history().pastStates.length).toBe(base + 1);
    expect(s().level!.segments[1].difficulty).toBe(1);
    s().endGesture();
    s().updateSegment(1, { difficulty: 0.5 }, { coalesce: 'seg:1:difficulty' });
    expect(history().pastStates.length).toBe(base + 2);
    s().undo();
    expect(s().level!.segments[1].difficulty).toBe(1);
    s().undo();
    expect(s().level!.segments[1].difficulty).toBe(0.3); // from before the drag
  });

  it('a different field, or a quiet gap, starts a new step', () => {
    s().loadLevel(createBlankRiver());
    const base = history().pastStates.length;
    s().updateSegment(1, { difficulty: 0.4 }, { coalesce: 'a' });
    s().updateSegment(1, { verticalBias: -1 }, { coalesce: 'b' });
    clock += COALESCE_WINDOW_MS + 1;
    s().updateSegment(1, { verticalBias: -1.5 }, { coalesce: 'b' });
    expect(history().pastStates.length).toBe(base + 3);
  });

  it('caps history', () => {
    s().loadLevel(createBlankRiver());
    for (let i = 0; i < HISTORY_LIMIT + 30; i++) s().updateSegment(0, { difficulty: (i % 10) / 10 + 0.01 });
    expect(history().pastStates.length).toBe(HISTORY_LIMIT);
  });

  it('history and the draft survive the Workshop unmounting (a Test run round trip)', () => {
    // The store is module state: nothing a mount owns. Simulate the round trip
    // as the host does it: the Workshop component goes away and comes back.
    s().loadLevel(createBlankRiver());
    s().updateSegment(4, { type: 'rapids' });
    s().setCamera({ position: [10, 20, 30], target: [1, 2, 3] });
    const before = { level: s().level, past: history().pastStates.length, camera: s().camera };
    // (no reset in between)
    expect(s().level).toBe(before.level);
    expect(history().pastStates.length).toBe(before.past);
    expect(s().camera).toEqual(before.camera);
    s().undo();
    expect(s().level!.segments[4].type).toBe('normal');
  });
});

describe('editorSegments round trip', () => {
  const hydro = hydroLevel as unknown as LevelData;

  it('opening a campaign map and editing nothing exports it unchanged', () => {
    s().loadLevel(structuredClone(hydro));
    expect(s().level).toEqual(hydro);
  });

  it('an inspector edit keeps every field it does not own (hazards, gameplay, hydro ids)', () => {
    s().loadLevel(structuredClone(hydro));
    const target = hydro.segments[1].index;
    s().updateSegment(target, { difficulty: 0.77, name: 'Renamed' });
    const out = s().level!;
    expect(out.segments[1].difficulty).toBe(0.77);
    expect(out.segments[1].name).toBe('Renamed');
    const strip = (l: LevelData) => ({ ...l, segments: l.segments.filter((_, i) => i !== 1) });
    expect(strip(out)).toEqual(strip(hydro));
    const { difficulty: _d, name: _n, ...restOut } = out.segments[1];
    const { difficulty: _d2, name: _n2, ...restIn } = hydro.segments[1];
    expect(restOut).toEqual(restIn);
  });

  it('edits a hydro event in place, keeping its authored id', () => {
    s().loadLevel(structuredClone(hydro));
    const rows = levelToEditorSegments(s().level!);
    const withHydro = rows.find((r) => r.hydroKind);
    expect(withHydro).toBeDefined();
    const before = (hydro.hydroEvents ?? []).find((e) => e.segmentIndex === withHydro!.index)!;
    s().updateSegment(withHydro!.index, { hydroHours: '14,15', hydroStrength: 2 });
    const after = (s().level!.hydroEvents ?? []).find((e) => e.segmentIndex === withHydro!.index)!;
    expect(after.id).toBe(before.id);
    expect(after.hours).toEqual([14, 15]);
    expect(after.strength).toBe(2);
    expect(s().level!.hydroEvents).toHaveLength(hydro.hydroEvents!.length);
    // Clearing the kind removes the event the inspector shows, and only that one.
    s().updateSegment(withHydro!.index, { hydroKind: '' });
    expect(s().level!.hydroEvents ?? []).toHaveLength(hydro.hydroEvents!.length - 1);
    expect((s().level!.hydroEvents ?? []).some((e) => e.id === before.id)).toBe(false);
  });

  it('apply-to-all clears overrides; a plain world biome change keeps them', () => {
    s().loadLevel(createBlankRiver());
    s().updateSegment(2, { biomeOverride: 'delta' });
    s().setWorldBiome('glacier');
    expect(selectSegments(s())[2].biome).toBe('delta');
    expect(selectSegments(s())[0].biome).toBe('glacier');
    s().setWorldBiome('glacier', { clearOverrides: true });
    expect(selectSegments(s())[2].biome).toBe('glacier');
  });
});
