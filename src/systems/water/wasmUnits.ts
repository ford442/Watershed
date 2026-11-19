/**
 * wasmUnits.ts — the brands on the watershed_native ABI's parameters (#575).
 *
 * emscripten/abi.def gives every parameter a kind, and gen-abi.mjs types each
 * one in wasmAbi.generated.ts with the brand below. A brand is an optional
 * phantom property on `number`, so it is erased (zero cost, nothing at
 * runtime) and a plain number still passes. What it buys: a value typed
 * `Seconds` passed where `Metres` is declared — two locals swapped at a call
 * site, say `dt` and `dx` — is a tsc error, and so is a `Ptr<ParticleSoA>`
 * handed to a grid export. Brand a local where it is made (`const dt: Seconds
 * = …`) and the call sites that pass it are checked.
 */

declare const unit: unique symbol;
declare const pointee: unique symbol;

/** A float in `U`. Arithmetic on it gives a plain number again; re-brand where it matters. */
export type Unit<U extends string> = number & { readonly [unit]?: U };

/** Heap element types a pointer can address. */
export type F32 = 'f32';
export type U32 = 'u32';
export type U8 = 'u8';
/** A PARTICLE_SOA_PLANES-plane particle block (allocateParticleSoA). */
export type ParticleSoA = 'particle-soa';

/** A WASM heap byte offset to `T` elements (allocateGrid / allocateParticleSoA; 0 = none). */
export type Ptr<T extends string> = number & { readonly [pointee]?: T };

export type Seconds = Unit<'s'>;
export type Metres = Unit<'m'>;
export type MetresPerSecond = Unit<'m/s'>;
export type MetresPerSecondSquared = Unit<'m/s²'>;
export type CubicMetresPerSecond = Unit<'m³/s'>;
export type Kilograms = Unit<'kg'>;
export type CubicMetres = Unit<'m³'>;
export type SquareMetres = Unit<'m²'>;
export type PerSecond = Unit<'1/s'>;
export type Radians = Unit<'rad'>;
/** A grid extent or shift, in cells. */
export type Cells = Unit<'cells'>;

/** An export's int status: WS_OK / WS_REJECTED / WS_PARTIAL / WS_BAD_ARG (wasmAbi.generated.ts). */
export type WsStatus = number;
