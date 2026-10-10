import { createContext, useContext } from "react";
import { en, type Messages } from "./en.js";
import { ko } from "./ko.js";

// The languages the pages speak (ADR-0012): a pack is a tag, a label and every word the
// default console shows; the components take their words from a context, with English where
// there is none above them; the person's choice, else the browser's languages, else English.

export type { Messages } from "./en.js";

export interface LanguagePack {
  /** The language's tag, as the browser and the person's choice name it: `en`, `ko`. */
  readonly tag: string;
  /** What the language is called, in itself. */
  readonly label: string;
  readonly messages: Messages;
}

export const ENGLISH: LanguagePack = { tag: en.tag, label: en.label, messages: en };
export const KOREAN: LanguagePack = { tag: ko.tag, label: ko.label, messages: ko };

/** The packs the package ships, English first: what the default console speaks. */
export const DEFAULT_LANGUAGES: readonly LanguagePack[] = [ENGLISH, KOREAN];

export const LanguageContext = createContext<LanguagePack>(ENGLISH);

/** The language the page is in. */
export function useLanguage(): LanguagePack {
  return useContext(LanguageContext);
}

/** The words of the language the page is in. */
export function useWords(): Messages {
  return useContext(LanguageContext).messages;
}

/** The language part of a tag: `ko` of `ko-KR`. */
const languageOf = (tag: string): string => tag.toLowerCase().split("-")[0] ?? "";

/** The pack a tag names, by the tag itself or by its language part, or nothing. */
export function packFor(
  tag: string | null | undefined,
  packs: readonly LanguagePack[],
): LanguagePack | undefined {
  if (tag === null || tag === undefined || tag.length === 0) {
    return undefined;
  }
  const wanted = tag.toLowerCase();
  return (
    packs.find((pack) => pack.tag.toLowerCase() === wanted) ??
    packs.find((pack) => languageOf(pack.tag) === languageOf(wanted))
  );
}

/**
 * The language to speak: the person's choice when it names a pack, else the first of the
 * browser's languages that does, else the first pack.
 */
export function chooseLanguage(
  chosen: string | null | undefined,
  browser: readonly string[],
  packs: readonly LanguagePack[] = DEFAULT_LANGUAGES,
): LanguagePack {
  const first = packs[0] ?? ENGLISH;
  const own = packFor(chosen, packs);
  if (own !== undefined) {
    return own;
  }
  for (const tag of browser) {
    const found = packFor(tag, packs);
    if (found !== undefined) {
      return found;
    }
  }
  return first;
}
