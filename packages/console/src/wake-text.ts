import { MAX_SIGNAL_LENGTH } from "./limits.js";

// A wake as the one text a signal carries (ADR-0163, ADR-0166): the lines of whoever raised it,
// a wake source or the console itself, apart from what someone else wrote, so that no word of a
// message or of a comment ever reads as a line of the console's. Written here once, for the
// runner, which writes what its wake sources raise and reads every such text back, and for the
// console, which writes a wake of the board's that carries a member's words. Pure: no I/O.

/**
 * A part of a wake (ADR-0163): a line of the source's own, or what someone else wrote. The
 * runner hands the agent each line under the session's mark and the words in a block of their
 * own, so that nothing a message holds reads as a line of the source's. A line holds what the
 * source says itself, an id and a moment among it, and never a word someone else wrote.
 */
export type WakePart = { readonly says: string } | { readonly words: string };

/**
 * The first version whose runner reads a wake of the board's in parts (ADR-0166): the console's
 * lines under the session's mark, and what a member wrote, a comment say, in a block. A runner
 * of before prints such a text whole under its header, as the console's own words, so the
 * console writes one in parts only for an account whose runner last said this version or a
 * later one.
 */
export const BOARD_PARTS_FROM = "0.6.3";

/** A word of a header on one line, with nothing in it that ends the header early. */
export const inHeader = (text: string): string => text.replaceAll(/[[\]\r\n]+/g, " ").trim();

/**
 * What a line of a wake's text begins with, as the console keeps the text (ADR-0163): a line of
 * the wake source's own, and a line of someone else's words. Every line of someone's words is
 * begun so where the text is written, so that no word of theirs is ever a line of the source's.
 */
const SAYS = "#";
const WORDS = ">";
/** What a wake's text ends on where its parts came to more than a signal carries. */
const WAKE_CUT = "The wake came to more than a signal carries, and was cut here";

/** The first `most` characters of a text, never half of a character that takes two. */
function firstOf(text: string, most: number): string {
  const last = text.charCodeAt(most - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? most - 1 : most);
}

/**
 * What someone wrote, a line each behind `>`. A line break of any spelling ends a line, so that
 * none is left in one to end it for a reader.
 */
export function quotedLines(words: string): string[] {
  return words.split(/\r\n?|\n/).map((line) => (line === "" ? WORDS : `${WORDS} ${line}`));
}

/**
 * The parts of a wake as the one text a signal carries: a line of the source's own behind `#`,
 * and each line of someone else's words behind `>`, in the order given. The runner writes it so
 * for every wake a source raises, whatever the source handed it, and reads it back so when the
 * signal returns (`wakePartsOf`). Two runs of words with no line between them are parted by a
 * line that says nothing. Within `most` characters, the most a signal carries: what comes to
 * more is cut at the end of a line, or within a line of words, and the text's last line says so.
 */
export function wakeTextOf(parts: readonly WakePart[], most = MAX_SIGNAL_LENGTH): string {
  const lines: string[] = [];
  let afterWords = false;
  for (const part of parts) {
    if ("says" in part) {
      const says = inHeader(part.says);
      if (says !== "") {
        lines.push(`${SAYS} ${says}`);
        afterWords = false;
      }
      continue;
    }
    if (part.words === "") {
      continue;
    }
    if (afterWords) {
      lines.push(SAYS);
    }
    lines.push(...quotedLines(part.words));
    afterWords = true;
  }
  const whole = lines.join("\n");
  if (whole.length <= most) {
    return whole;
  }
  const cut = `${SAYS} ${WAKE_CUT}`;
  const kept: string[] = [];
  let room = most - cut.length;
  for (const line of lines) {
    if (line.length + 1 > room) {
      // A line of words is carried as far as it goes; one of the source's own, whole or not at all.
      if (line.startsWith(`${WORDS} `) && room > WORDS.length + 2) {
        kept.push(firstOf(line, room - 1));
      }
      break;
    }
    kept.push(line);
    room -= line.length + 1;
  }
  return [...kept, cut].join("\n");
}

/**
 * The parts of a wake read back from its text, or nothing where the text is not written as
 * `wakeTextOf` writes one: a wake raised by a runner of before, which is then carried whole as
 * someone else's words, as it was.
 */
export function wakePartsOf(text: string): readonly WakePart[] | undefined {
  const parts: WakePart[] = [];
  let words: string[] | undefined;
  const close = (): void => {
    if (words !== undefined) {
      parts.push({ words: words.join("\n") });
      words = undefined;
    }
  };
  for (const line of text.split("\n")) {
    if (line === WORDS || line.startsWith(`${WORDS} `)) {
      words ??= [];
      words.push(line.slice(WORDS.length + 1));
    } else if (line === SAYS || line.startsWith(`${SAYS} `)) {
      close();
      if (line.length > SAYS.length + 1) {
        parts.push({ says: line.slice(SAYS.length + 1) });
      }
    } else {
      return undefined;
    }
  }
  close();
  return parts;
}
