/**
 * canonicalJson.ts — JSON with object keys in sorted order and no whitespace.
 *
 * Two copies of the same river (a file, the editor's export, a shared link
 * decoded on another machine) must give the same text however their keys were
 * ordered, so the content hash that keys a river's bests and its ghosts'
 * fairness (`hashUserRiverLevel`) and the share link (`riverShare.ts`) both
 * hash / encode this form. Arrays keep their order; `undefined` members are
 * dropped exactly as `JSON.stringify` drops them.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = src[key];
    return out;
  });
}
