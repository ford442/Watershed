/**
 * SWEBedDebugOverlay — `?sweDebug=1` false-color view of the SWE bed.
 *
 * Blue is deep water, cyan/green is shallow, tan/white is dry bank. A slot
 * canyon should read as a narrow blue thalweg between dry banks; a delta or
 * pond should read as broad shallow water across the same grid.
 */

import { useEffect, useRef, useState } from 'react';
import { SWE_MEAN_DEPTH } from '../systems/water/SWEHeightField';
import {
  subscribeSWEBedSnapshot,
  wetFraction,
  type SWEBedSnapshot,
} from '../systems/water/sweBedDebug';

const CELL_PX = 4;

/** True when the URL opts into the bed overlay. */
export function isSWEDebugEnabled(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  const raw = new URLSearchParams(search).get('sweDebug');
  return raw === '1' || raw === 'true';
}

/** Depth (H − b) → RGB. Dry cells fade to bank tan rather than clamping to black. */
export function bedColor(bed: number): [number, number, number] {
  const depth = SWE_MEAN_DEPTH - bed;
  if (depth <= 1e-4) {
    // Dry: lighter the higher the bank stands above the water line.
    const dryness = Math.min(1, -depth / (SWE_MEAN_DEPTH * 2));
    return [120 + dryness * 110, 100 + dryness * 100, 78 + dryness * 82];
  }
  const t = Math.min(1, depth / (SWE_MEAN_DEPTH * 1.5));
  // shallow (cyan-green) → deep (dark blue)
  return [Math.round(40 * (1 - t)), Math.round(210 - 130 * t), Math.round(150 + 90 * t)];
}

function paint(canvas: HTMLCanvasElement, snapshot: SWEBedSnapshot): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height, bed } = snapshot;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * CELL_PX}px`;
  canvas.style.height = `${height * CELL_PX}px`;
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b] = bedColor(bed[i]);
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export function SWEBedDebugOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [snapshot, setSnapshot] = useState<SWEBedSnapshot | null>(null);

  useEffect(() => subscribeSWEBedSnapshot(setSnapshot), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && snapshot) paint(canvas, snapshot);
  }, [snapshot]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 20000,
        padding: 8,
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(10,10,16,0.85)',
        color: '#ccc',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 10,
        pointerEvents: 'none',
      }}
    >
      <div style={{ marginBottom: 4 }}>SWE bed (#374 Phase 2)</div>
      {snapshot ? (
        <>
          <canvas ref={canvasRef} style={{ imageRendering: 'pixelated', display: 'block' }} />
          <div style={{ marginTop: 4 }}>
            {snapshot.width}×{snapshot.height} @ {snapshot.cellSize.toFixed(2)}m ·{' '}
            {snapshot.sourceCount} seg · wet {(wetFraction(snapshot) * 100).toFixed(0)}%
          </div>
        </>
      ) : (
        <div>no bed sampled (SWE off or WASM unavailable)</div>
      )}
    </div>
  );
}

export default SWEBedDebugOverlay;
