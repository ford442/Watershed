// Types for the one import of this script from TypeScript (src/systems/water/wasmAbi.generated.test.ts),
// so the repo needs no `allowJs` (as compile-validators.d.mts).
export declare function checkAbi(): string[];
export declare function parseDef(text: string): {
  version: number;
  constants: { type: 'int' | 'float'; name: string; value: number; doc: string }[];
  fns: { name: string; returns: string; header: string; args: { kind: string; name: string }[] }[];
};
export declare function checkImplementations(
  model: ReturnType<typeof parseDef>,
  readHeader?: (header: string) => string,
): string[];
