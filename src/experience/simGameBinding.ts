/**
 * simGameBinding — SimCore's run-state port onto the Zustand store (#556 A).
 *
 * `ctx.game.state()` is `useGameStore.getState()`: the very object the sim
 * read before the port existed, so the browser's sim is unchanged. GameState
 * satisfies `SimGameView` structurally; the assignment below is the check.
 */
import type { SimGamePort, SimGameView } from '../sim/core/simGame';
import { useGameStore } from '../systems/GameState';

export const storeSimGame: SimGamePort = {
  state: (): SimGameView => useGameStore.getState(),
};
