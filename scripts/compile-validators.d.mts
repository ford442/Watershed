// Types for the one import of this script from TypeScript (src/formats/validators.drift.test.ts),
// so the repo needs no `allowJs` (#535 A).
export declare const VALIDATORS: readonly string[];
export declare function schemaPath(name: string): string;
export declare function outputPaths(name: string): { ts: string };
export declare function generateValidator(name: string, schemaText?: string): { ts: string };
