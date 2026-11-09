// What is typed at a hidden prompt, read key by key from a terminal in raw mode: the characters
// of the secret, Backspace taking one back, Enter or Ctrl-D ending it, Ctrl-C giving it up; and
// nothing of what a terminal sends for a key that types nothing. Pure, for the tests: the
// terminal itself is `terminal.ts`'s.

/** Where a prompt stands after what the terminal sent: still reading, done, or given up. */
export type SecretKeysState = "reading" | "done" | "interrupted";

export interface SecretKeys {
  /** Takes what the terminal sent; once done or given up, takes nothing more. */
  take(chunk: string): SecretKeysState;
  /** What was typed so far. */
  readonly typed: string;
}

export function secretKeys(): SecretKeys {
  let typed = "";
  let state: SecretKeysState = "reading";
  // What a terminal sends for an arrow, Delete, Home, a function key, or around a paste, begins
  // with an escape: `ESC [` and parameters up to a final byte, `ESC O` and one more, or `ESC`
  // and one more for a key held with Alt. None of it is the secret; a paste between its marks is.
  let control: "none" | "begun" | "sequence" | "one" = "none";
  return {
    get typed() {
      return typed;
    },
    take(chunk) {
      for (const character of chunk) {
        if (state !== "reading") {
          break;
        }
        if (control === "begun") {
          control = character === "[" ? "sequence" : character === "O" ? "one" : "none";
          continue;
        }
        if (control === "one") {
          control = "none";
          continue;
        }
        if (control === "sequence") {
          if (character >= "@" && character <= "~") {
            control = "none";
          }
          continue;
        }
        switch (character) {
          case "\u001b":
            control = "begun";
            break;
          case "\u0003":
            state = "interrupted";
            break;
          case "\r":
          case "\n":
          case "\u0004":
            state = "done";
            break;
          case "\u007f":
          case "\b":
            typed = Array.from(typed).slice(0, -1).join("");
            break;
          default:
            typed += character;
        }
      }
      return state;
    },
  };
}
