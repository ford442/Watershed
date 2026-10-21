import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getMapAtmosphere } from '../../maps/atmosphere';
import {
  IDLE_SKY_HOUR,
  gameHourAt,
  getSkyClock,
  getSkyPhase,
  resetSkyClock,
  resetSkyClockForTests,
  setSkyAtmosphere,
  subscribeSkyPhase,
  tickSkyClock,
  type SkyPhase,
} from './skyClock';
import { updateFlowingWaterUniforms } from '../../components/waterUniforms';

afterEach(() => resetSkyClockForTests());

function snapshot(hour: number, mapId = 'glacial') {
  resetSkyClock(hour, getMapAtmosphere(mapId));
  const { sun, factors } = getSkyClock();
  return { sun: { ...sun }, factors: { ...factors } };
}

describe('gameHourAt', () => {
  it('runs ten game minutes per real minute by default', () => {
    expect(gameHourAt(6, 60, 10)).toBeCloseTo(6 + 10 / 60, 10);
    expect(gameHourAt(14, 0, 10)).toBe(14);
  });
});

describe('the run sky clock', () => {
  it('idles at the old mid-morning before any run', () => {
    expect(getSkyClock().hour).toBe(IDLE_SKY_HOUR);
    expect(getSkyClock().factors.night).toBe(0);
  });

  it('06:00 and 14:00 launches put the sun, the sky and the water in different places', () => {
    const dawn = snapshot(6);
    const afternoon = snapshot(14);
    // Sun: low in the east at dawn, high in the south-west after lunch.
    expect(dawn.sun.x).toBeGreaterThan(0.5);
    expect(afternoon.sun.x).toBeLessThan(0);
    expect(afternoon.sun.y).toBeGreaterThan(dawn.sun.y + 0.4);
    // Sky factors: a low (not yet golden) dawn, a full afternoon sun.
    expect(dawn.factors.elevation01).toBeLessThan(0.3);
    expect(afternoon.factors.elevation01).toBe(1);
    expect(dawn.factors.golden).toBe(0);
    // The golden hour is an evening thing.
    expect(snapshot(17).factors.golden).toBeGreaterThan(0.8);

    // Water: the same material frame takes a different sun direction.
    const sunDirAt = (hour: number) => {
      resetSkyClock(hour, getMapAtmosphere('glacial'));
      const uniforms = {
        time: { value: 0 },
        sunDir: { value: new THREE.Vector3() },
        timeOfDay: { value: -1 },
      };
      const mat = Object.assign(new THREE.ShaderMaterial(), { uniforms });
      updateFlowingWaterUniforms(mat as never, {
        elapsedTime: 0, delta: 0, cameraY: 0, biome: 'glacialMelt', isNight: false, flowMap: null,
        vehiclePos: null, vehicleVelocity: null, weatherRipple: 0, wetness: 0, slushiness: 0,
        sunWorldPosition: null, sunDirection: getSkyClock().sun, nightFactor: getSkyClock().factors.night,
        isPond: false, vortexCenter: null, vortexRadius: 0, vortexIntensity: 0,
      });
      return { dir: uniforms.sunDir.value.clone(), night: uniforms.timeOfDay.value };
    };
    const dawnWater = sunDirAt(6);
    const afternoonWater = sunDirAt(14);
    expect(dawnWater.dir.angleTo(afternoonWater.dir)).toBeGreaterThan(0.5);
    expect(sunDirAt(23).night).toBe(1);
    expect(afternoonWater.night).toBe(0);
  });

  it('moves the sun on sim time only, at the map speed-up', () => {
    resetSkyClock(6, getMapAtmosphere('glacial'));
    const start = getSkyClock().sun.elevation;
    for (let i = 0; i < 60 * 60; i += 1) tickSkyClock(1 / 60);
    expect(getSkyClock().hour).toBeCloseTo(6 + 10 / 60, 6);
    expect(getSkyClock().sun.elevation).toBeGreaterThan(start);
    tickSkyClock(0);
    tickSkyClock(Number.NaN);
    expect(getSkyClock().hour).toBeCloseTo(6 + 10 / 60, 6);
  });

  it('tells coarse readers about the phase only when it changes, and about nightfall', () => {
    resetSkyClock(17, getMapAtmosphere('meander'));
    const heard: SkyPhase[] = [];
    const off = subscribeSkyPhase((phase) => heard.push(phase));
    tickSkyClock(1 / 60);
    expect(heard).toHaveLength(0);
    // Two game hours at ×10 is twelve real minutes: dusk falls.
    for (let i = 0; i < 12 * 60; i += 1) tickSkyClock(1);
    expect(heard.length).toBeGreaterThan(10);
    expect(heard.length).toBeLessThan(200);
    expect(getSkyPhase().isNight).toBe(true);
    expect(heard.some((p) => p.isNight)).toBe(true);
    off();
  });

  it('keeps the hour across a journey handoff to a map with another sky', () => {
    resetSkyClock(9, getMapAtmosphere('glacial'));
    for (let i = 0; i < 360; i += 1) tickSkyClock(1);
    const hour = getSkyClock().hour;
    setSkyAtmosphere({ latitudeDeg: 30, dayOfYear: 172, timeSpeedup: 20 });
    expect(getSkyClock().hour).toBeCloseTo(hour, 10);
    tickSkyClock(180);
    expect(getSkyClock().hour).toBeCloseTo(hour + 1, 10);
  });
});
