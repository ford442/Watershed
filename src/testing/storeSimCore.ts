/**
 * storeSimCore — a SimCore whose `ctx.game` is the Zustand store (tests, #556 A).
 *
 * A fresh SimCore holds a plain run state; the browser binds the store in
 * SimCoreTick. Tests that stage the run through `useGameStore.setState` step
 * a core built here, so the systems read the same state the game's do.
 */
import { SimCore } from '../sim/core/SimCore';
import { storeSimGame } from '../experience/simGameBinding';

export function createStoreSimCore(): SimCore {
  const core = new SimCore();
  core.ctx.game = storeSimGame;
  return core;
}
