/**
 * i18n runtime (#566) — `t()` over typed catalogs, no framework.
 *
 * - English is the fallback for every key, so `t()` is synchronous and never
 *   blank: a lazy locale that has not landed yet reads English. The boot path's
 *   English (`en`) is in the entry; a lazy screen's rides its chunk and is
 *   registered with `registerEnglish` when that chunk loads (en.ts).
 * - Other locales are typed modules (`locales/<id>.ts`, `satisfies LocaleCatalog`)
 *   fetched as lazy chunks by `setLocale`; tsc catches a missing or extra key and
 *   a wrong plural shape, locales.test.ts the placeholders.
 * - `{name}` placeholders interpolate; a number param is formatted with the
 *   locale's cached `Intl.NumberFormat`. A plural message picks its form with a
 *   cached `Intl.PluralRules` on the `count` param.
 * - Each (locale, key, form) template is split into parts once; a call walks
 *   the parts — no per-call regex.
 * - Pure TS, no React: modules call `t()` directly; components use `useT()`
 *   (useT.ts), which re-renders on a locale change.
 */

import { en, type EnglishCatalog } from './en';
import type { LocaleId, Message, MessageParamNames, ParamValue, PluralMessage } from './types';

export type MessageKey = keyof EnglishCatalog;

/**
 * A translated catalog: every English key, a string where English has a string
 * and a plural object where English has one.
 */
export type LocaleCatalog = {
  readonly [K in MessageKey]: EnglishCatalog[K] extends string ? string : PluralMessage;
};

/** `t(key)` for a message with no placeholders, `t(key, params)` otherwise. */
export type TArgs<K extends MessageKey> = [MessageParamNames<EnglishCatalog[K]>] extends [never]
  ? []
  : [params: Record<MessageParamNames<EnglishCatalog[K]>, ParamValue>];

export type TFunction = <K extends MessageKey>(key: K, ...args: TArgs<K>) => string;

/** The keys that take no params — the type for a table of labels (`Record<Id, PlainKey>`). */
export type PlainKey = { [K in MessageKey]: TArgs<K> extends [] ? K : never }[MessageKey];

const LOADERS: Record<Exclude<LocaleId, 'en'>, () => Promise<LocaleCatalog>> = {
  es: () => import('./locales/es').then((m) => m.es),
  fr: () => import('./locales/fr').then((m) => m.fr),
};

let currentLocale: LocaleId = 'en';
let catalog: Partial<Record<MessageKey, Message>> = {};
let version = 0;
let pending: LocaleId | null = null;
const listeners = new Set<() => void>();
/** English registered by lazy chunks (en.ts); the entry's `en` covers the rest. */
const lazyEnglish: Partial<Record<MessageKey, Message>> = {};

let pluralRules: Intl.PluralRules | null = null;
let numberFormat: Intl.NumberFormat | null = null;

/** A template split once: literal text, or a placeholder name in a 1-element array. */
type Part = string | readonly [name: string];
const partsCache = new Map<string, readonly Part[]>();
const warned = new Set<string>();

function notify(): void {
  version++;
  pluralRules = null;
  numberFormat = null;
  partsCache.clear();
  if (typeof document !== 'undefined') document.documentElement.lang = currentLocale;
  for (const listener of listeners) listener();
}

export const getLocale = (): LocaleId => currentLocale;

/** Bumped on every locale change; `useT` keys its re-render on it. */
export const getI18nVersion = (): number => version;

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Register a lazy chunk's English (en/lazy/*.ts). Call at the chunk's module
 * top level, so its keys exist before it first renders.
 */
export function registerEnglish(part: Partial<Record<MessageKey, Message>>): void {
  Object.assign(lazyEnglish, part);
}

/**
 * Switch the UI language. English applies at once; another locale applies when
 * its chunk lands, in one store update (a later call wins over one still loading).
 */
export async function setLocale(locale: LocaleId): Promise<void> {
  pending = locale;
  if (locale === 'en') {
    if (currentLocale === 'en') return;
    currentLocale = 'en';
    catalog = {};
    notify();
    return;
  }
  if (locale === currentLocale) return;
  const loaded = await LOADERS[locale]();
  if (pending !== locale) return; // superseded while loading
  currentLocale = locale;
  catalog = loaded;
  notify();
}

function split(text: string): readonly Part[] {
  const parts: Part[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    const close = open < 0 ? -1 : text.indexOf('}', open);
    if (open < 0 || close < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (open > i) parts.push(text.slice(i, open));
    parts.push([text.slice(open + 1, close)]);
    i = close + 1;
  }
  return parts;
}

function pluralForm(message: PluralMessage, count: number): keyof PluralMessage {
  if (count === 0 && message.zero !== undefined) return 'zero';
  pluralRules ??= new Intl.PluralRules(currentLocale);
  const category = pluralRules.select(count) as keyof PluralMessage;
  return message[category] !== undefined ? category : 'other';
}

function formatParam(value: ParamValue): string {
  if (typeof value === 'string') return value;
  numberFormat ??= new Intl.NumberFormat(currentLocale);
  return numberFormat.format(value);
}

function lookup(key: MessageKey): Message {
  const translated = catalog[key];
  if (translated !== undefined) return translated;
  const english = (en as Partial<Record<MessageKey, Message>>)[key] ?? lazyEnglish[key];
  if (import.meta.env.DEV && !warned.has(key) && (english === undefined || currentLocale !== 'en')) {
    warned.add(key);
    console.warn(
      english === undefined
        ? `[i18n] "${key}" has no English loaded (a lazy part not registered?)`
        : `[i18n] ${currentLocale} has no "${key}"; showing English`,
    );
  }
  // `?? key`: an unregistered lazy key or one from outside the types (a stale
  // stored id) shows itself, never throws.
  return english ?? key;
}

/** Translate `key` in the current locale (English when the locale lacks it). */
export const t: TFunction = (key, ...args) => {
  const params = args[0] as Record<string, ParamValue> | undefined;
  const message = lookup(key);
  let form = '';
  let text: string;
  if (typeof message === 'string') {
    text = message;
  } else {
    const picked = pluralForm(message, Number(params?.count ?? 0));
    form = picked;
    text = message[picked] ?? message.other;
  }
  const cacheKey = form ? `${key}\u0000${form}` : key;
  let parts = partsCache.get(cacheKey);
  if (!parts) {
    parts = split(text);
    partsCache.set(cacheKey, parts);
  }
  if (parts.length === 1 && typeof parts[0] === 'string') return parts[0];
  let out = '';
  for (const part of parts) {
    if (typeof part === 'string') out += part;
    else {
      const value = params?.[part[0]];
      out += value === undefined ? `{${part[0]}}` : formatParam(value);
    }
  }
  return out;
};

/** Test seam: back to English. */
export function resetI18nForTests(): void {
  currentLocale = 'en';
  catalog = {};
  pending = null;
  notify();
}
