// What a plugin writes on the board in every language of the workspace (ADR-0058): a text with
// its translations beside it, shown to each reader in their own. The server answers the field
// in the reader's language already; the pages read the map again with the language they speak,
// since a browser's language may differ from the one the person kept.

/** A text per language tag, as the manifest's language maps are keyed: `{ en, ko }`. */
export type Translations = Readonly<Record<string, string>>;

/**
 * The text in the language given: the exact tag, else its language part (`ko` of `ko-KR`), else
 * what was stored as the text itself.
 */
export function textIn(
  translations: Translations | null | undefined,
  text: string,
  language: string | null | undefined,
): string {
  if (
    translations === null ||
    translations === undefined ||
    language === null ||
    language === undefined
  ) {
    return text;
  }
  const exact = translations[language];
  if (typeof exact === "string" && exact.length > 0) {
    return exact;
  }
  const part = language.toLowerCase().split("-")[0] ?? language;
  const byPart =
    translations[part] ??
    Object.entries(translations).find(([tag]) => tag.toLowerCase().split("-")[0] === part)?.[1];
  return typeof byPart === "string" && byPart.length > 0 ? byPart : text;
}

/**
 * The text a map is stored as, where the board keeps one text beside the map: English where the
 * map has it, else the first of the console's languages it has, else the first text at all.
 */
export function storedText(translations: Translations, languages: readonly string[]): string {
  for (const language of ["en", ...languages]) {
    const text = translations[language];
    if (typeof text === "string" && text.length > 0) {
      return text;
    }
  }
  return Object.values(translations).find((text) => text.length > 0) ?? "";
}
