// A secret is taken out of an event before it leaves the machine (ADR-0086, point 5): every
// value of the account's store, as it is and in the encodings a value is commonly carried in,
// whether the runner handed it to the session or the agent read it itself. The forms are those
// the console takes out of a plugin's answers (ADR-0079): spelled as JSON, a URL's part or a
// form spell it, and in base64, whole or inside a longer run of it.

/** What stands in an event where a secret was. */
export const WITHHELD = "[withheld]";

/** The fewest characters a value is looked for by: a shorter one is in any text by chance. */
const MIN_LENGTH = 4;
/** The fewest bytes a value is looked for in base64 by: a shorter one's letters turn up in any base64 by chance. */
const MIN_BASE64_BYTES = 8;

/** A percent-encoding with its hex digits small, as some spell it. */
const smallHex = (encoded: string): string =>
  encoded.replace(/%[0-9A-F]{2}/g, (sequence) => sequence.toLowerCase());

/** Base64 in the alphabet of a URL. */
const urlAlphabet = (base64: string): string => base64.replaceAll("+", "-").replaceAll("/", "_");

/** A value as a query or a form encodes it. */
const formEncoded = (text: string): string => new URLSearchParams([["", text]]).toString().slice(1);

/** A value as JSON spells it between its quotes. */
const jsonEscaped = (text: string): string => JSON.stringify(text).slice(1, -1);

function spelledForms(text: string): readonly string[] {
  const part = encodeURIComponent(text.toWellFormed());
  const query = formEncoded(text);
  return [text, jsonEscaped(text), part, query, smallHex(part), smallHex(query)];
}

/**
 * A value in base64, in a header's alphabet and in a URL's: whole, padded or not, and inside a
 * longer run of base64 at each of the three places its first byte may fall, without the letters
 * it shares with what is around it.
 */
function base64Forms(text: string): readonly string[] {
  const bytes = Buffer.from(text.toWellFormed(), "utf8");
  if (bytes.byteLength < MIN_BASE64_BYTES) {
    return [];
  }
  const whole = bytes.toString("base64");
  const forms = [whole, whole.replace(/=+$/, ""), bytes.toString("base64url")];
  for (const offset of [0, 1, 2]) {
    const shifted = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64");
    const inside = shifted.slice(
      Math.ceil((offset * 8) / 6),
      Math.floor(((offset + bytes.byteLength) * 8) / 6),
    );
    forms.push(inside, urlAlphabet(inside));
  }
  return forms;
}

/** What a driver ends a text with that it cut: a tool's input is shown to a length, and no further. */
const CUT_MARK = "\u2026";

/** For each place in a form, how long the longest beginning of the form is that also ends there. */
function bordersOf(form: string): Int32Array {
  const borders = new Int32Array(form.length);
  let matched = 0;
  for (let at = 1; at < form.length; at += 1) {
    while (matched > 0 && form[at] !== form[matched]) {
      matched = borders[matched - 1] ?? 0;
    }
    if (form[at] === form[matched]) {
      matched += 1;
    }
    borders[at] = matched;
  }
  return borders;
}

/** How many characters at the end of a text are the beginning of a form, the whole form never among them. */
function beginningAtEnd(text: string, form: string, borders: Int32Array): number {
  const tail = text.slice(-(form.length - 1));
  let matched = 0;
  for (let at = 0; at < tail.length; at += 1) {
    while (matched > 0 && (matched === form.length || tail[at] !== form[matched])) {
      matched = borders[matched - 1] ?? 0;
    }
    if (tail[at] === form[matched]) {
      matched += 1;
    }
  }
  return matched;
}

/** The forms one value may be in, the longest first, so that a shorter form never tears a longer one. */
export function formsOf(value: string): readonly string[] {
  if (value.length < MIN_LENGTH) {
    return [];
  }
  const forms = [...spelledForms(value), ...base64Forms(value)];
  const escaped = forms.flatMap((form) =>
    form.includes("/") ? [form, form.replaceAll("/", "\\/")] : [form],
  );
  return [...new Set(escaped)].filter((form) => form.length >= MIN_LENGTH);
}

/**
 * What takes the values out of a text: each form of each value replaced by `[withheld]`. A value
 * of several lines is looked for whole and a line at a time, since a tool prints a key a line at
 * a time. A text a driver cut may end inside a value: the beginning of one that it ends in, of
 * four characters or more, is taken out as well. With no value to look for, the text comes
 * through as it is.
 */
export function redactorOf(values: Iterable<string>): (text: string) => string {
  const forms = new Set<string>();
  for (const value of values) {
    const whole = value.trim();
    for (const form of formsOf(whole)) {
      forms.add(form);
    }
    const lines = whole.split(/\r?\n/).map((line) => line.trim());
    if (lines.length > 1) {
      // The lines of a key that say nothing of it, its first and its last, stay.
      for (const line of lines) {
        if (line.length >= 16 && !/^-{3,}.*-{3,}$/.test(line)) {
          for (const form of formsOf(line)) {
            forms.add(form);
          }
        }
      }
    }
  }
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  if (ordered.length === 0) {
    return (text) => text;
  }
  const borders = ordered.map(bordersOf);
  return (text) => {
    let out = text;
    for (const form of ordered) {
      if (out.includes(form)) {
        out = out.replaceAll(form, WITHHELD);
      }
    }
    if (out.endsWith(CUT_MARK)) {
      const body = out.slice(0, -CUT_MARK.length);
      let most = 0;
      ordered.forEach((form, index) => {
        const held = borders[index];
        if (held !== undefined) {
          most = Math.max(most, beginningAtEnd(body, form, held));
        }
      });
      if (most >= MIN_LENGTH) {
        out = `${body.slice(0, body.length - most)}${WITHHELD}${CUT_MARK}`;
      }
    }
    return out;
  };
}
