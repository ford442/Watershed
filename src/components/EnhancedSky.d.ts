/**
 * Typed facade for `EnhancedSky.jsx`.
 *
 * WHY A FACADE INSTEAD OF A .tsx CONVERSION (issue #313, work item 3):
 * A straight `.jsx -> .tsx` rename produces 53 type errors in this file —
 * mostly bare `useRef()` handles (sky/cloud/star/moon materials and the fog
 * object) that are read and mutated every frame, plus implicit-any parameters
 * on the local star-field and sky-profile helpers. Typing those means editing
 * ~50 sites in a purely visual component with no unit coverage, so per the
 * brief the runtime module stays `.jsx` and this declaration carries the
 * contract.
 *
 * `tsconfig.typecheck.json`'s `src/**\/*.ts` include picks this file up, and TS
 * module resolution prefers it over the sibling `.jsx`, so TypeScript consumers
 * (currently `experience/InnerExperience.tsx`) are checked against it.
 *
 * KEEP IN SYNC with `EnhancedSky.jsx`. `shaderFacades.contract.test.ts` asserts the
 * runtime module still matches the shape declared here.
 */

import type * as React from 'react';

/**
 * EnhancedSky takes no props — it reads biome, time-of-day and transition
 * progress from `useBiome()`, and publishes the sun position through
 * `useSunPosition()`.
 */
export type EnhancedSkyProps = Record<string, never>;

declare const EnhancedSky: React.FC<EnhancedSkyProps>;
export default EnhancedSky;
