import a from './en-1.json';
import b from './en-2.json';
import c from './en-3.json';

/** English UI strings keyed by the Spanish source text. */
export const en: Record<string, string> = { ...a, ...b, ...c };
