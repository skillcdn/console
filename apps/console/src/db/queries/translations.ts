/**
 * A record's texts in several languages (ADR-0058) without those a person wrote over: their words
 * are the text now, in every language, where the map would go on answering what was there.
 */
export function withoutWrittenOver<T extends object>(
  translations: T | null | undefined,
  fields: readonly string[],
): T | null {
  const kept = Object.entries(translations ?? {}).filter(([field]) => !fields.includes(field));
  return kept.length === 0 ? null : (Object.fromEntries(kept) as T);
}
