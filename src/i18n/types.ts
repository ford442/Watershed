/**
 * i18n types (#566). The English catalog (`en.ts`) is the key source: its keys
 * are `MessageKey`, and a message's `{placeholders}` are the params `t()` asks for.
 */

/** A message that varies by count, keyed by `Intl.PluralRules` category; `other` is required. */
export interface PluralMessage {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type Message = string | PluralMessage;

/** `'a {x} b {y}'` → `'x' | 'y'`. */
type PlaceholdersOf<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | PlaceholdersOf<Rest>
  : never;

/** The params a message takes. A plural message always takes `count`. */
export type MessageParamNames<M> = M extends string
  ? PlaceholdersOf<M>
  : M extends PluralMessage
    ? PlaceholdersOf<Extract<M[keyof M], string>> | 'count'
    : never;

export type ParamValue = string | number;

/** The locales that ship. `en` is in the entry; the rest are lazy chunks. */
export const LOCALES = ['en', 'es', 'fr'] as const;
export type LocaleId = (typeof LOCALES)[number];

/** The Options choice: `system` follows `navigator.languages`. */
export type LocalePref = 'system' | LocaleId;

export const isLocaleId = (value: unknown): value is LocaleId =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
