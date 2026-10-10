import { useState } from "react";
import { ApiError } from "./api.js";

// A change a page makes: run it, keep what went wrong for the page, and say while it is busy.
// Shared by the compositions, so that every page says the same thing the same way.

export function errorWords(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Something went wrong. Try again.";
}

/** Runs a change, keeps what went wrong for the page, and says when it is busy. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(errorWords(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, act };
}
