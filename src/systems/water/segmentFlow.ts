/**
 * segmentFlow — the current segment's flow multiplier and slipperiness (#535 C).
 *
 * TrackManager sets it on segment enter, a run reset puts it back to the defaults, and the
 * runner's shallow-water push reads it every physics step. It used to travel as
 * `window.__watershedFlowSpeed` / `__watershedSlipperiness`: gameplay state on a global,
 * readable only through a cast. Module state now; the harness's `window.__watershed.flowSpeed`
 * reads it for the verification scripts.
 */

let flowSpeed = 1;
let slipperiness = 0;

export function setSegmentFlow(nextFlowSpeed: number, nextSlipperiness: number): void {
  if (Number.isFinite(nextFlowSpeed)) flowSpeed = nextFlowSpeed;
  if (Number.isFinite(nextSlipperiness)) slipperiness = nextSlipperiness;
}

/** The entered segment's flow multiplier (1 before the first segment enter). */
export function getSegmentFlowSpeed(): number {
  return flowSpeed;
}

export function getSegmentSlipperiness(): number {
  return slipperiness;
}
