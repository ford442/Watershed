/**
 * qualityOverride — `?quality=low|medium|high|ultra` for harnesses.
 *
 * A software (SwiftShader) boot starts at Low, which turns the SWE field off;
 * the replay smoke needs the water on to checksum it. Session-only and
 * read-only like `?hour=`: it never writes the player's settings.
 */
import type { QualityPreset } from '../systems/GameState';

const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/** Parse `?quality=` from a query string; null when absent or not a preset. */
export function parseQualityOverride(search?: string): QualityPreset | null {
  const raw = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const value = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`).get('quality');
  return value && (PRESETS as readonly string[]).includes(value) ? (value as QualityPreset) : null;
}
