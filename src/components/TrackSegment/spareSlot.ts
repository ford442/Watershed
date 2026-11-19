/**
 * spareSlot.ts — the segment id of a treadmill slot that holds no segment (#577 A.3).
 *
 * TrackManager renders the pool's 10 slots for 7 live segments. The 3 spare
 * slots used to pass no `segmentId`, TrackSegment defaulted it to 0, and their
 * bed effect (no meshes → no bed) ran `unregisterSegmentBathymetry(0)`: the SWE
 * field had no bed under segment 0, ever, on a fresh pool. Segment ids run
 * negative too (meander's lead-in is −3…−1), so the spare id is one no segment
 * can have, and the registries ignore it.
 */
export const SPARE_SLOT_SEGMENT_ID = Number.MIN_SAFE_INTEGER;

/** True for a slot with no segment: it publishes and withdraws nothing. */
export const isSpareSlot = (segmentId: number): boolean => segmentId === SPARE_SLOT_SEGMENT_ID;
