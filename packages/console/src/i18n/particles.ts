// The Korean particles that take one of two forms by the sound a word ends in. A sentence of the
// Korean pack that carries a name, a title or a field writes the word with the form that fits,
// where it wrote both, "을(를)".

type Ending = "vowel" | "rieul" | "consonant";

/** How the Sino-Korean reading of a digit ends: 0 영, 1 일, 2 이, 3 삼, 4 사, 5 오, 6 육, 7 칠, 8 팔, 9 구. */
const DIGIT_ENDINGS: readonly Ending[] = [
  "consonant",
  "rieul",
  "vowel",
  "consonant",
  "vowel",
  "vowel",
  "consonant",
  "rieul",
  "rieul",
  "vowel",
];

/**
 * What closes a word without being read: a quote, a bracket, a full stop, a space, and the mark
 * a question or a call ends with, since a decision's question is said by its last word.
 */
const CLOSERS = /["'”’)\]}>.?!？！\s]+$/u;

/**
 * How a word ends when it is read aloud. A Hangul syllable says so itself, a digit by its
 * reading; a Latin word is read as Korean reads a loan word, by its last letters, which is a
 * guess and is right for the common endings (`l`, `m`, `n`, `ng`, a short vowel before `b`, `k`,
 * `p` or `t`, and `ck`). Anything else reads as ending in a vowel.
 */
function endingOf(word: string): Ending {
  const read = word.replace(CLOSERS, "");
  const last = read.codePointAt(read.length - 1);
  if (last === undefined) {
    return "vowel";
  }
  if (last >= 0xac00 && last <= 0xd7a3) {
    const final = (last - 0xac00) % 28;
    return final === 0 ? "vowel" : final === 8 ? "rieul" : "consonant";
  }
  const letter = read.charAt(read.length - 1).toLowerCase();
  if (letter >= "0" && letter <= "9") {
    return DIGIT_ENDINGS[Number(letter)] ?? "vowel";
  }
  if (letter === "l") {
    return "rieul";
  }
  if (letter === "m" || letter === "n") {
    return "consonant";
  }
  const before = read.charAt(read.length - 2).toLowerCase();
  if (letter === "g" && before === "n") {
    return "consonant";
  }
  if (letter === "k" && before === "c") {
    return "consonant";
  }
  if ("bkpt".includes(letter) && "aeiou".includes(before) && before !== "") {
    return "consonant";
  }
  return "vowel";
}

/** The word as what is acted on: 을 after a consonant, 를 after a vowel. */
export function asObject(word: string): string {
  return `${word}${endingOf(word) === "vowel" ? "를" : "을"}`;
}

/** The word as what stands beside another: 과 after a consonant, 와 after a vowel. */
export function asBeside(word: string): string {
  return `${word}${endingOf(word) === "vowel" ? "와" : "과"}`;
}

/** The word as who or what acts: 이 after a consonant, 가 after a vowel. */
export function asSubject(word: string): string {
  return `${word}${endingOf(word) === "vowel" ? "가" : "이"}`;
}

/** The word as what a thing becomes or goes through: 으로 after a consonant but ㄹ, 로 otherwise. */
export function asWay(word: string): string {
  return `${word}${endingOf(word) === "consonant" ? "으로" : "로"}`;
}
