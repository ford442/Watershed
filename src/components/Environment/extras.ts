/**
 * extras — the decorations a segment only sometimes shows, as one lazy chunk.
 *
 * Fauna (birds, bats, fish, dragonflies, fireflies, lilies), biome-specific flora and props
 * (slot-canyon cactus / sage / grass / dust / backdrop, lumber and industrial props) and the
 * glacier and waterfall set pieces. None of them is in the first frame of a run, and most
 * biomes use only a few, so they stay out of the entry chunk (~90 kB pre-minify). See
 * `lazyExtras.ts` for the Suspense-ready handles and the preload.
 */
export { default as Birds } from './Birds';
export { default as Bats } from './Bats';
export { default as Fish } from './Fish';
export { default as Dragonflies } from './Dragonflies';
export { default as Fireflies } from './Fireflies';
export { default as WaterLilies } from './WaterLilies';
export { default as Cactus } from './Cactus';
export { default as DesertSage } from './DesertSage';
export { default as CanyonGrass } from './CanyonGrass';
export { default as CanyonDust } from './CanyonDust';
export { default as CanyonBackground } from './CanyonBackground';
export { default as IceSpray } from './IceSpray';
export { default as Icicles } from './Icicles';
export { default as IceSheets } from './IceSheets';
export { default as WaterfallParticles } from './WaterfallParticles';
export { default as WaterfallSheet } from './WaterfallSheet';
export { default as WaterfallImpactZone } from './WaterfallImpactZone';
export { default as Rainbow } from './Rainbow';
export { default as LumberProps } from '../LumberProps';
export { default as IndustrialProps } from '../IndustrialProps';
