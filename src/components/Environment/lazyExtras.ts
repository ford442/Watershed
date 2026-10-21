/**
 * lazyExtras — Suspense-ready handles for the decorations in `extras.ts`.
 *
 * Every handle shares one dynamic import, so they are one chunk. Render each inside a
 * `<Suspense fallback={null}>`; `preloadEnvironmentExtras()` (called at idle once the app is
 * up) means a segment mounting later finds the chunk loaded and renders them in the same
 * commit. Before that — a deep-linked boot straight into a run — they appear a frame or two
 * after the rest of the segment, which is the cost of keeping them out of the entry.
 */
import type { ComponentProps, ComponentType } from 'react';
import { lazyComponent } from '../../utils/lazyComponent';
import { lazyModule } from '../../utils/lazyModule';

type Extras = typeof import('./extras');

const extras = lazyModule(() => import('./extras'));

function lazyExtra<K extends keyof Extras>(key: K) {
  type P = ComponentProps<Extras[K]>;
  return lazyComponent<P>(() => extras.load().then((m) => ({ default: m[key] as ComponentType<P> }))).Component;
}

export const Birds = lazyExtra('Birds');
export const Bats = lazyExtra('Bats');
export const Fish = lazyExtra('Fish');
export const Dragonflies = lazyExtra('Dragonflies');
export const Fireflies = lazyExtra('Fireflies');
export const WaterLilies = lazyExtra('WaterLilies');
export const Cactus = lazyExtra('Cactus');
export const DesertSage = lazyExtra('DesertSage');
export const CanyonGrass = lazyExtra('CanyonGrass');
export const CanyonDust = lazyExtra('CanyonDust');
export const CanyonBackground = lazyExtra('CanyonBackground');
export const IceSpray = lazyExtra('IceSpray');
export const Icicles = lazyExtra('Icicles');
export const IceSheets = lazyExtra('IceSheets');
export const WaterfallParticles = lazyExtra('WaterfallParticles');
export const WaterfallSheet = lazyExtra('WaterfallSheet');
export const WaterfallImpactZone = lazyExtra('WaterfallImpactZone');
export const Rainbow = lazyExtra('Rainbow');
export const LumberProps = lazyExtra('LumberProps');
export const IndustrialProps = lazyExtra('IndustrialProps');

/** Start fetching the extras chunk. A failed fetch is retried by the next render that needs one. */
export function preloadEnvironmentExtras(): void {
  void extras.load().catch(() => {});
}
