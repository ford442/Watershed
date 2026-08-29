import { describe, expect, it } from 'vitest';
import { FLOW_FORECAST_STATES } from './flowForecast';
import { applyForecastToCacheSlots, applyForecastToPortageRoutes } from './forecastCachePlacement';

describe('forecastCachePlacement', () => {
  it('leaves authored positions alone in Normal flow', () => {
    const slots = [
      { id: 'a', segmentIndex: 10, label: 'rim', retrievalBonus: 1, position: [18, -14, -235] as [number, number, number] },
    ];
    expect(applyForecastToCacheSlots(slots, FLOW_FORECAST_STATES.NORMAL)[0].position).toEqual([18, -14, -235]);
  });

  it('shifts spatial caches toward high ground when flooded', () => {
    const slots = [
      { id: 'a', segmentIndex: 10, label: 'rim', retrievalBonus: 1, position: [18, -14, -235] as [number, number, number] },
    ];
    expect(applyForecastToCacheSlots(slots, FLOW_FORECAST_STATES.FLOODED)[0].position).toEqual([22, -14, -235]);
  });

  it('does not invent waypoints for segment-scoped routes', () => {
    const routes = [{ segmentIndex: 11, label: 'line' }];
    expect(applyForecastToPortageRoutes(routes, FLOW_FORECAST_STATES.WASHED_OUT)[0].position).toBeUndefined();
  });
});
