// A short code a person reads off their agent's screen and types, or follows, on the console's
// own pages to connect the agent (ADR-0011): eight characters from an alphabet without
// look-alikes, in two groups of four. The server makes codes; everything else reads them.

/** The characters a code is made of: no `0`, `1`, `I` or `O`, which read alike. */
export const CONNECT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CONNECT_CODE_LENGTH = 8;

const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Whether the text is a code as it is written: upper case, a hyphen in the middle. */
export function isConnectCode(text: string): boolean {
  return CODE.test(text);
}

/**
 * The code as it is written, from what a person typed: any case, with or without the hyphen,
 * spaces around or between; or nothing for text that is not a code.
 */
export function normalizeConnectCode(text: string): string | undefined {
  const letters = text.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  if (letters.length !== CONNECT_CODE_LENGTH) {
    return undefined;
  }
  const code = `${letters.slice(0, 4)}-${letters.slice(4)}`;
  return CODE.test(code) ? code : undefined;
}
