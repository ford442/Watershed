/**
 * composerPassModules — the JSM passes only some presets run, loaded on demand.
 *
 * `SSAOPass` is gated by `EffectPresence.ssao` (off on Low/Medium) and `SMAAPass` by the AA
 * tier (`aaTierFor`), so neither belongs in the entry chunk of a player whose preset never
 * builds it (SSAOPass + shader ~35 kB, SMAAPass + lookup textures ~65 kB pre-minify).
 * `createComposerDriver` asks for them from `apply()` the first time the frame wants them.
 */
import { lazyModule } from '../../utils/lazyModule';

export const ssaoPassModule = lazyModule(() => import('three/examples/jsm/postprocessing/SSAOPass.js'));
export const smaaPassModule = lazyModule(() => import('three/examples/jsm/postprocessing/SMAAPass.js'));
