import { useState } from "react";
import { ApiError } from "./api.js";
import { en, type Messages } from "./i18n/en.js";
import { useWords } from "./i18n/index.js";

// A change a page makes: run it, keep what went wrong for the page, and say while it is busy.
// Shared by the compositions, so that every page says the same thing the same way.

/** The pack's words for what the server answered, or nothing for a failure it has none for. */
export function wordsForFailure(error: unknown, pack: Messages): string | undefined {
  if (!(error instanceof ApiError) || !Object.hasOwn(pack.errors, error.code)) {
    return undefined;
  }
  return (pack.errors as Readonly<Record<string, string>>)[error.code];
}

/**
 * What a failure says to a person: the code the server answered read in their language, the
 * server's own message being English and for programs; `fallback` for the rest.
 */
export function errorWords(
  error: unknown,
  fallback: string = en.common.somethingWentWrong,
  pack: Messages = en,
): string {
  return wordsForFailure(error, pack) ?? fallback;
}

/** Runs a change, keeps what went wrong for the page, and says when it is busy. */
export function useAction() {
  const words = useWords();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(errorWords(failure, words.common.somethingWentWrong, words));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, act };
}
