/**
 * Code points that never belong in text the console accepts, stores or shows: control
 * characters, and the invisible or direction-changing ones that make one string look like
 * another. A body keeps its line breaks and tabs; a title has no use for them.
 */
function isForbidden(codePoint: number, multiline: boolean): boolean {
  if (codePoint <= 0x1f) {
    return !(multiline && (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d));
  }
  return (
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

/**
 * True when the string is malformed UTF-16 or holds a forbidden code point. Linear in the input.
 * With `multiline`, line breaks and tabs are allowed, as a body needs them.
 */
export function hasForbiddenCodePoint(value: string, multiline = false): boolean {
  if (!value.isWellFormed()) {
    return true;
  }
  for (const character of value) {
    if (isForbidden(character.codePointAt(0) ?? 0, multiline)) {
      return true;
    }
  }
  return false;
}
