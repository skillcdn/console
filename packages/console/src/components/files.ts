// The files people and agents put on the board, as the pages treat them: which are pictures the
// pages show in place, whether a text names one, the Markdown that places one, and a name for
// one more among those taken. Shared by the discussion, the runs and the documents.

/** The kinds of picture the pages show in place: what a browser renders and cannot run. */
const PICTURE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Whether a file is a picture the pages show in place, by the media type the console kept. */
export function isPicture(contentType: string): boolean {
  return PICTURE_TYPES.has(contentType);
}

/** The file name a picture's source names in a text, written as `name` or `./name`. */
export function namedFile(source: string): string {
  return source.startsWith("./") ? source.slice(2) : source;
}

/** Whether the text places a file by its name, as `![words](name)` or `![words](./name)`. */
export function placed(body: string, name: string): boolean {
  return body.includes(`](${name})`) || body.includes(`](./${name})`);
}

/** The text with the pictures named placed after what is written, one `![](name)` a line. */
export function placing(body: string, names: readonly string[]): string {
  const lines = names.map((name) => `![](${name})`).join("\n");
  return body.trim().length === 0 ? lines : `${body.trimEnd()}\n\n${lines}`;
}

/** A name for a file among those taken already: the same, or with a count before its extension. */
export function unusedName(name: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(name)) {
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${extension}`;
    if (!names.has(candidate)) {
      return candidate;
    }
  }
}
