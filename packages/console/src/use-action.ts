import { useState } from "react";
import { ApiError } from "./api.js";
import { en } from "./i18n/en.js";
import { useWords } from "./i18n/index.js";

// A change a page makes: run it, keep what went wrong for the page, and say while it is busy.
// Shared by the compositions, so that every page says the same thing the same way.

/** What a failure says to a person: the server's words, or the language's own for the rest. */
export function errorWords(
  error: unknown,
  fallback: string = en.common.somethingWentWrong,
): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return fallback;
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
      setError(errorWords(failure, words.common.somethingWentWrong));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, act };
}
