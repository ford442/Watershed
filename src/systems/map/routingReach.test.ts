import { describe, expect, it } from 'vitest';
import { buildRoutingReach, getRoutingReach, routingChainIndex } from './routingReach';
import { getMapDefinition } from '../../maps/registry';

describe('routingReach — the campaign chain as the routing sees it', () => {
  const reach = getRoutingReach();

  it('walks glacial → lumber → meander → hydro → delta, head first', () => {
    expect(reach.mapIds).toEqual(['glacial', 'lumber', 'meander', 'hydro', 'delta']);
    const order = reach.segments.map((s) => reach.mapIds.indexOf(s.mapId));
    for (let k = 1; k < order.length; k += 1) expect(order[k]).toBeGreaterThanOrEqual(order[k - 1]);
  });

  it('has one routed segment per authored segment of every map', () => {
    for (const mapId of reach.mapIds) {
      const def = getMapDefinition(mapId);
      const last = Math.max(def.startIndex, ...def.levelData.segments.map((s) => s.index));
      const routed = reach.segments.filter((s) => s.mapId === mapId).map((s) => s.index);
      expect(routed[0]).toBe(def.startIndex);
      expect(routed.at(-1)).toBe(last);
      expect(routed.length).toBe(last - def.startIndex + 1);
    }
    expect(reach.lengths.length).toBe(reach.segments.length);
  });

  it('gives every segment a physical length, a downhill slope and a width', () => {
    for (let k = 0; k < reach.segments.length; k += 1) {
      expect(reach.lengths[k]).toBeGreaterThan(40);
      expect(reach.lengths[k]).toBeLessThan(250);
      // The centreline never climbs (generateSegmentPath clamps upward slope).
      expect(reach.slopes[k]).toBeGreaterThan(0);
      expect(reach.widths[k]).toBeGreaterThan(0);
    }
  });

  it('is deterministic and launch-hour independent', () => {
    const again = buildRoutingReach();
    expect(Array.from(again.lengths)).toEqual(Array.from(reach.lengths));
    expect(Array.from(again.slopes)).toEqual(Array.from(reach.slopes));
    expect(Array.from(again.widths)).toEqual(Array.from(reach.widths));
  });

  it('maps a treadmill segment to its chain position, clamping the procedural tail', () => {
    const first = reach.segments.findIndex((s) => s.mapId === 'hydro');
    const last = reach.segments.length - 1 - [...reach.segments].reverse().findIndex((s) => s.mapId === 'hydro');
    expect(routingChainIndex(reach, 'hydro', reach.segments[first].index)).toBe(first);
    expect(routingChainIndex(reach, 'hydro', 4)).toBe(first + 4 - reach.segments[first].index);
    expect(routingChainIndex(reach, 'hydro', 999)).toBe(last);
    expect(routingChainIndex(reach, 'hydro', -999)).toBe(first);
    // Downstream maps sit further down the chain.
    expect(routingChainIndex(reach, 'delta', 0)!).toBeGreaterThan(last);
  });
});
