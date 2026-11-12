/**
 * simGameBinding — SimCore's run-state port onto the Zustand store (#556 A).
 *
 * `ctx.game.state()` is `useGameStore.getState()`: the very object the sim
 * read before the port existed, so the browser's sim is unchanged. GameState
 * satisfies `SimGameView` structurally; the assignment below is the check.
 */
import type { SimGamePort, SimGameView } from '../sim/core/simGame';
import type { SimDebugSink } from '../sim/core/SimCore';
import { setDebugTap } from '../debug/debugTaps';
import type { PhysicsDebugSnapshot } from '../vehicles/RunnerVehicle/constants';
import { useGameStore } from '../systems/GameState';

export const storeSimGame: SimGamePort = {
  state: (): SimGameView => useGameStore.getState(),
};

/** SimCore's diagnostics port onto the harness taps (#556 A.1): what the step used to set directly. */
export const tapSimDebug: SimDebugSink = {
  physicsDebug: (snapshot) => setDebugTap('physicsDebug', snapshot as PhysicsDebugSnapshot),
};
