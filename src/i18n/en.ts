/**
 * The English catalog (#566) — the key source, split by where it renders.
 *
 * - `en` (this object) is what rides the entry: the parts the boot path renders
 *   (start menu, HUD, loader, crash / graphics screens, shared formats).
 * - `en/lazy/*.ts` are the parts only a lazy chunk renders (Options, pause,
 *   results, touch, the river cards). Each chunk imports its part and calls
 *   `registerEnglish` at module load, so its English travels with it. Their
 *   keys are still `MessageKey`s: `EnglishCatalog` joins them by type only.
 *
 * Every other locale (`locales/<id>.ts`) holds all keys, boot and lazy
 * (`satisfies LocaleCatalog`). Messages: `{name}` interpolates a param (a number
 * is locale-formatted); an object `{ one, other, … }` is a plural on `count`.
 * Keys are namespaced (`hud.*`, `menu.*`, …) and unique across parts
 * (locales.test.ts); a lazy part's keys are used only by its chunk (lazyParts.test.ts).
 */

import { common } from './en/common';
import { hud } from './en/hud';
import { menu } from './en/menu';
import { settings } from './en/settings';
import type { LazyEnglish } from './enLazy';

export const en = {
  ...common,
  ...menu,
  ...hud,
  ...settings,
} as const;

/** Every English message, boot and lazy — the type `MessageKey` is drawn from. */
export type EnglishCatalog = typeof en & LazyEnglish;
