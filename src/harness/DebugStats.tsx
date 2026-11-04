/**
 * DebugStats — drei's FPS panel, `?debug=1` only. Its own lazy chunk so
 * stats.js (and drei's wrapper) never ride the player's boot path (#466 audit D).
 */
import { Stats } from '@react-three/drei';

export default function DebugStats() {
  return <Stats />;
}
