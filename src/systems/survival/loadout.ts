/**
 * loadout.ts — Pre-run gear presets (mass vs insulation vs raft kit).
 *
 * Pure data + helpers; selection lives in StartMenu and runSession.
 */

export type LoadoutId = 'trail-light' | 'balanced' | 'expedition';

export interface LoadoutDefinition {
  id: LoadoutId;
  label: string;
  shortLabel: string;
  description: string;
  /** Multiplier on movement impulse (lower = heavier kit). */
  movementMultiplier: number;
  /** Insulation bonus subtracted from ambient cold stress (0–1 scale). */
  insulation: number;
  /** Base sprint stamina regen multiplier. */
  staminaRegenMultiplier: number;
  /** Base sprint stamina drain multiplier. */
  staminaDrainMultiplier: number;
}

export const LOADOUT_DEFINITIONS: Record<LoadoutId, LoadoutDefinition> = {
  'trail-light': {
    id: 'trail-light',
    label: 'Trail Light',
    shortLabel: 'LIGHT',
    description: 'Minimal kit — fast drying, weak cold protection.',
    movementMultiplier: 1.06,
    insulation: 0.05,
    staminaRegenMultiplier: 1.1,
    staminaDrainMultiplier: 1.0,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    shortLabel: 'BALANCED',
    description: 'Standard runner kit for mixed canyon biomes.',
    movementMultiplier: 1.0,
    insulation: 0.2,
    staminaRegenMultiplier: 1.0,
    staminaDrainMultiplier: 1.0,
  },
  expedition: {
    id: 'expedition',
    label: 'Expedition',
    shortLabel: 'EXPED',
    description: 'Insulated layers — slower but resists glacial cold.',
    movementMultiplier: 0.94,
    insulation: 0.45,
    staminaRegenMultiplier: 0.92,
    staminaDrainMultiplier: 0.88,
  },
};

export const DEFAULT_LOADOUT_ID: LoadoutId = 'balanced';

export const LOADOUT_LIST: LoadoutDefinition[] = Object.values(LOADOUT_DEFINITIONS);

export function isLoadoutId(value: string): value is LoadoutId {
  return value in LOADOUT_DEFINITIONS;
}

export function resolveLoadoutId(value: string | undefined): LoadoutId {
  if (value && isLoadoutId(value)) return value;
  return DEFAULT_LOADOUT_ID;
}

export function getLoadoutDefinition(id: LoadoutId): LoadoutDefinition {
  return LOADOUT_DEFINITIONS[id];
}
