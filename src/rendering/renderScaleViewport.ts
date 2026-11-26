/** Viewport units accepted by the renderer while a render target is bound. */
export type RenderScaleViewportUnits = 'legacy-webgl-logical' | 'render-target-pixels';

export interface RenderScaleViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute a top-left anchored viewport covering `scale` of a target.
 *
 * Width and height are physical target pixels. On WebGL through r186,
 * setViewport/setScissor still multiply arguments by the renderer pixel ratio,
 * even with a target bound, so the returned dimensions are converted back to
 * logical units. On newer WebGL and WebGPU the target-bound API uses pixels.
 * The represented target rectangle is integer-sized in either case.
 */
export function renderScaleViewport(
  width: number,
  height: number,
  scale: number,
  out: RenderScaleViewportRect,
  units: RenderScaleViewportUnits,
  pixelRatio = 1,
): RenderScaleViewportRect {
  const safeScale = Number.isFinite(scale) ? Math.min(1, Math.max(0, scale)) : 1;
  const targetWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const targetHeight = Number.isFinite(height) ? Math.max(1, Math.floor(height)) : 1;
  const pixelWidth = Math.max(1, Math.floor(targetWidth * safeScale));
  const pixelHeight = Math.max(1, Math.floor(targetHeight * safeScale));
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;

  out.x = 0;
  out.y = 0;
  out.width = units === 'legacy-webgl-logical' ? pixelWidth / ratio : pixelWidth;
  out.height = units === 'legacy-webgl-logical' ? pixelHeight / ratio : pixelHeight;
  return out;
}

/** Match three's target-bound viewport units; keep the version rule here. */
export function renderScaleViewportUnits(
  revision: number,
  isWebGPU: boolean,
): RenderScaleViewportUnits {
  return isWebGPU || revision >= 187
    ? 'render-target-pixels'
    : 'legacy-webgl-logical';
}
