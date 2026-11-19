// @vitest-environment node
/**
 * hydroContrast — the hazard release case (#578 A.3).
 *
 * The hydro dam's 14:00 release (`hazards[]` in hydro_dam.json) reaches the
 * solver only through the routed upstream edge: its discharge joins the chain at
 * the stilling basin's reach (`RiverRouter.setRelease`). So the #397 gate is
 * held on the edge: with the gates open the basin's window must move in the
 * mesh and in the hull by the same margins an authored disk must, against the
 * 06:00 river.
 *
 * The telegraph draws its band at the release's authored `stage`; this pins
 * that number to the router's own rating at every hour the hazard is live, so
 * the band shows where the water will actually reach. Runs on the committed
 * pair, so `pnpm test` checks the binary that ships.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import hydro from '../../maps/hydro_dam.json';
import delta from '../../maps/delta_rapids.json';
import glacial from '../../maps/glacial_source.json';
import lumber from '../../maps/lumber_flume.json';
import meander from '../../maps/meander_to_waterfall.json';
import { loadNativeFromDisk } from '../../testing/nativeFromDisk';
import { parseHazards } from '../hazards/parseHazards';
import { isHazardLiveAtHour } from '../hazards/hazardHours';
import { parseHydroEvents } from './hydroEvents';
import {
  HYDRO_CONTRAST_MARGINS,
  measureEdgeStageContrastWith,
  routedEdgeEtaAt,
  routedReleaseEdgeEtaAt,
  type HydroEdgeStepper,
} from './hydroContrast';
import { createWasmSweSim } from './sweSim';
import type { WatershedNativeModule } from './wasmAbi';
import type { MapRegistryId } from '../../maps/registry';

/** How far the band may sit from the routed plateau (m): a third of the still depth's 10 %. */
const STAGE_PIN_TOLERANCE = 0.1;

const MAPS: ReadonlyArray<{ id: MapRegistryId; data: { hazards?: unknown; hydroEvents?: unknown } }> = [
  { id: 'glacial', data: glacial },
  { id: 'lumber', data: lumber },
  { id: 'meander', data: meander },
  { id: 'hydro', data: hydro },
  { id: 'delta', data: delta },
];

/** Every authored hazard with a release, with the hours it is live. */
const RELEASES = MAPS.flatMap(({ id, data }) => {
  const events = parseHydroEvents(data.hydroEvents);
  return parseHazards(data.hazards)
    .filter((h) => h.release)
    .map((hazard) => ({
      mapId: id,
      hazard,
      hours: Array.from({ length: 24 }, (_, h) => h).filter((h) => isHazardLiveAtHour(hazard, h, events)),
    }));
});

let wasm: WatershedNativeModule;

beforeAll(async () => {
  wasm = await loadNativeFromDisk();
});

/** stepShallowWaterInflow on a contrast grid — no hydroEvents, only the edge. */
const wasmEdgeStep: HydroEdgeStepper = (grid, edgeEta, steps, dt) => {
  const sim = createWasmSweSim(wasm, grid.width, grid.height, grid.cellSize);
  sim.h.set(grid.h);
  sim.u.set(grid.u);
  sim.w.set(grid.w);
  sim.b.set(grid.b);
  for (let s = 0; s < steps; s += 1) {
    sim.step({ dt, g: 9.80665, H: grid.stillDepth, originX: grid.originX, originZ: grid.originZ, events: [], edgeEta });
  }
  grid.h.set(sim.h);
  grid.u.set(sim.u);
  grid.w.set(sim.w);
  grid.b.set(sim.b);
  sim.dispose();
};

describe('hydroContrast — the hazard release (#578 A)', () => {
  it('the shipped maps author the hydro dam release', () => {
    const dam = RELEASES.find((r) => r.hazard.id === 'hydro-dam-release');
    expect(dam?.mapId).toBe('hydro');
    expect(dam?.hours).toEqual([14]);
  });

  it.each(RELEASES.map((r) => [r.hazard.id, r] as const))(
    '%s draws its band at the routed stage, at every hour it is live',
    (_id, { mapId, hazard, hours }) => {
      expect(hours.length).toBeGreaterThan(0);
      for (const hour of hours) {
        const routed = routedReleaseEdgeEtaAt(wasm, mapId, hazard.segmentIndex, hour, hazard.release!.discharge);
        expect(Math.abs(routed - hazard.release!.stage), `${hazard.id} at ${hour}:00 routes to ${routed.toFixed(3)} m`).toBeLessThan(
          STAGE_PIN_TOLERANCE,
        );
      }
    },
  );

  it.each(RELEASES.map((r) => [r.hazard.id, r] as const))(
    '%s moves the edge, the mesh and the hull against the 06:00 river',
    async (_id, { mapId, hazard, hours }) => {
      const scout = routedEdgeEtaAt(wasm, mapId, hazard.segmentIndex, 6);
      const open = routedReleaseEdgeEtaAt(wasm, mapId, hazard.segmentIndex, hours[0]!, hazard.release!.discharge);
      // And against its own hour with the gates shut: the release, not the hour, is what is measured.
      const shut = routedEdgeEtaAt(wasm, mapId, hazard.segmentIndex, hours[0]!);
      expect(open).toBeGreaterThan(shut + HYDRO_CONTRAST_MARGINS.minEtaDelta);

      for (const base of [scout, shut]) {
        const contrast = await measureEdgeStageContrastWith(wasmEdgeStep, base, open);
        expect(contrast.edgeStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
        expect(contrast.maxEtaDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
        expect(contrast.hullStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
        expect(contrast.hullDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minHullDelta);
      }
    },
  );
});
