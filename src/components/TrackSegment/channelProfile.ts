import { clamp } from '../../math/scalar';
import type { ChannelProfileSample } from './types';
import { smoothNoise } from './utils';

/**
 * A segment's channel profile: width, asymmetry, riffles and pools sampled
 * every ~2 m along the path, a smooth function of the world arc (segment id +
 * t) so neighbouring segments meet. Pure; TrackSegment memoises it.
 */
export function buildChannelProfile(opts: {
  segmentId: number;
  pathLength: number;
  waterWidth: number;
  segmentType: string;
  isSlotCanyon: boolean;
}): ChannelProfileSample[] {
  const { segmentId, pathLength, waterWidth, segmentType, isSlotCanyon } = opts;
  if (!(pathLength > 0)) return [];

  const sampleCount = Math.max(8, Math.floor(pathLength / 2));
  const corridorHalfWidth = Math.max(3.2, Math.min(waterWidth * 0.35, waterWidth * 0.5 - 1.2));
  const widthAmplitude = segmentType === 'pond' ? 0.06 : isSlotCanyon ? 0.12 : 0.18;
  const asymmetryAmplitude = isSlotCanyon ? 0.22 : 0.14;

  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const t = sampleCount === 0 ? 0 : index / sampleCount;
    const worldArc = segmentId + t;
    const baseWidth = waterWidth * 0.5;
    const widthNoise = smoothNoise(worldArc * 2.1 + 0.17) * 0.6 + smoothNoise(worldArc * 4.4 - 0.33) * 0.4;
    const riffleWave = Math.sin(worldArc * Math.PI * 1.35 + segmentId * 0.21);
    const riffleNoise = smoothNoise(worldArc * 3.2 + 1.7) * 0.35;
    const riffleStrength = clamp(riffleWave * 0.65 + riffleNoise, -1, 1);
    const poolDepth = clamp(Math.max(0, -riffleStrength), 0, 1);
    const riffleAmount = clamp(Math.max(0, riffleStrength), 0, 1);
    const widthScale = 1 + widthNoise * widthAmplitude + poolDepth * 0.16 - riffleAmount * 0.1;
    const asymmetry = smoothNoise(worldArc * 1.5 - 2.4) * asymmetryAmplitude;
    const leftHalfWidth = Math.max(corridorHalfWidth + 0.8, baseWidth * widthScale * (1 + asymmetry));
    const rightHalfWidth = Math.max(corridorHalfWidth + 0.8, baseWidth * widthScale * (1 - asymmetry));
    const floorDepth = poolDepth * (isSlotCanyon ? 1.4 : 1.1) - riffleAmount * 0.35;
    const floorWave = smoothNoise(worldArc * 6.4 + 0.8) * 0.18 + Math.sin(worldArc * Math.PI * 3.1) * 0.08;

    return {
      t,
      worldArc,
      leftHalfWidth,
      rightHalfWidth,
      corridorHalfWidth,
      floorDepth,
      floorWave,
      riffleStrength,
      gravelBarSide: asymmetry > 0 ? (1 as const) : (-1 as const),
      undercutSide: asymmetry > 0 ? (-1 as const) : (1 as const),
      flowScale: 1 + riffleAmount * 0.18 - poolDepth * 0.12,
    };
  });
}
