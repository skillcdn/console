// Holds the console's pages to its parts (ADR-0106; packages/console/src/styles/README.md):
//
//   1. the manifest names every file of the stylesheet once: tokens, base, the parts, the pages;
//   2. a colour is written in tokens.css and nowhere else, and tokens.css sets values only;
//   3. a part is a file under parts/ with a row in the catalogue, and its classes are the row's;
//   4. a page's file holds the classes of its own sources and nothing shared, every rule in it
//      names one of them, and a rule there places: it lays its own element out, moves a part
//      about, and gives nothing a look, but for the classes drawn-by-pages.json still lists;
//   5. a class a source names is in the stylesheet, and a class of the stylesheet is named;
//   6. a component sets a style on an element only where it computes a measure.
//
// What it refuses is said with what to do instead, since whoever reads the refusal is about to
// write the next line. Part of `pnpm check`; `pnpm check:styles` runs it alone. With `--hook` it
// is what an agent's editor runs after a file is written (.claude/settings.json): it reads what
// was written from the standard input, says nothing unless that was a source of the pages, and
// ends with 2 on a refusal, which is how such a hook hands its words back to the agent.
//
// A name a source builds from a stem (`sc-badge-${tone}`) keeps every class under that stem
// named, and a page's class the list names may be drawn further: the check reads names, not
// what the browser draws. It writes nothing: the list and the counts are changed by hand.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
// biome-ignore lint/correctness/useImportExtensions: the module beside this one is .mjs, as every script here is
import { STYLES_DIR, styleFiles } from "./styles.mjs";

const root = resolve(import.meta.dirname, "..");
const hook = process.argv.includes("--hook");
if (hook) {
  // What the editor wrote, as it says it: a file elsewhere is none of this check's.
  let written;
  try {
    written = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.file_path;
  } catch {
    written = undefined;
  }
  const ofThePages =
    typeof written === "string" &&
    /packages[\\/]console[\\/]src[\\/].*\.(css|tsx?|json|md)$/.test(written) &&
    !/\.test\.tsx?$/.test(written);
  if (written !== undefined && !ofThePages) {
    process.exit(0);
  }
}
const stylesDir = join(root, STYLES_DIR);
const sourcesDir = join(root, "packages/console/src");

/** The class that is the ground under every page: named as where a rule holds, never what it is about. */
const GROUND = new Set(["sc-shell"]);

/** The composition names the classes of the pages it puts together; its own are the shell's. */
const COMPOSITION = "console.tsx";

/**
 * Classes a source names that have no rule, each for a reason: what a script or a test finds an
 * element by, never a look. A class that is to look like something is a part.
 */
const HOOKS = new Map(
  Object.entries({
    "sc-board-movable": "a board whose cards may be moved; the tests tell it from one that is read",
    "sc-calendar-bar-spanning": "a bar that goes on into the next week; the tests count them",
    "sc-content": "an id, not a class: where the skip link lands",
    "sc-plugin-frame-page": "the browser tests find a plugin's page by it",
    "sc-plugin-frame-widget": "the browser tests find a plugin's widget by it",
    "sc-talk-fact": "a fact of a record in a conversation; the tests read the facts by it",
  }),
);

/**
 * How many times a source may set a style on an element. Each is a measure the component
 * computed: a place, a share, a height. A look is a class.
 */
const INLINE_STYLES = new Map(
  Object.entries({
    "components/board.tsx": 2, // where a card's menu opens, and the card in hand
    "components/calendar.tsx": 2, // a tip's shift into its item, a bar's span
    "components/home.tsx": 6, // a tile's cell and span, a glance's heights
    "components/pictures.tsx": 1, // a picture's drawn size
    "components/plugin-frame.tsx": 1, // the height a plugin's page asked for
    "components/roadmap.tsx": 6, // a month's share, today's place, a bar's ends
    "components/ui.tsx": 2, // the shares of a progress bar
  }),
);

/** The same of an element's `style` written by a script, by the line's own words. */
const STYLE_WRITES = new Map(
  Object.entries({
    "components/agent-page.tsx": 3, // the conversation's top, the box grown to its words
    "components/pictures.tsx": 3, // the page held still under a picture
    "components/shell.tsx": 3, // where a menu's panel opens
    "plugin/web.ts": 1, // a plugin's page given the console's tokens
  }),
);

/** What a rule may say of an element of the page's own: where it is and how it lays out what is in it. */
const LAYOUT = [
  /^margin(-|$)/,
  /^grid(-template|-auto|-area|-column|-row)?(-|$)/,
  /^(justify|align|place)-(self|items|content)$/,
  /^order$/,
  /^flex(-grow|-shrink|-basis|-direction|-wrap|-flow)?$/,
  /^(row-|column-)?gap$/,
  /^(min-|max-)?(width|height|inline-size|block-size)$/,
  /^position$/,
  /^inset(-|$)/,
  /^(top|right|bottom|left)$/,
  /^z-index$/,
  /^display$/,
  /^visibility$/,
  /^aspect-ratio$/,
  /^padding(-|$)/,
  /^box-sizing$/,
  /^overflow(-|$)/,
  /^overscroll-behavior(-|$)/,
  /^scroll-(margin|padding|snap|behavior)(-|$)/,
  /^scrollbar-(gutter|width)$/,
  /^(text-overflow|white-space|text-align|vertical-align)$/,
  /^(overflow-wrap|word-break|hyphens|text-wrap|line-clamp|-webkit-line-clamp|-webkit-box-orient)$/,
  /^object-(fit|position)$/,
  /^contain(er)?(-|$)/,
  /^content-visibility$/,
  /^(pointer-events|user-select|-webkit-user-select|touch-action|cursor|resize)$/,
  /^(table-layout|border-collapse|border-spacing)$/,
  /^columns?(-|$)/,
  /^list-style(-|$)/,
  /^(transform|transform-origin|translate)$/,
  /^(isolation|will-change|direction|writing-mode|tab-size)$/,
];

/** The same of a part the page did not draw, but for its padding, which is the part's own. */
const PLACING = LAYOUT.filter((pattern) => !pattern.test("padding"));

/** A colour written out where a token would give it. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

const failures = [];
const fail = (where, what, instead) => {
  failures.push(`${where}: ${what}\n    ${instead}`);
};

// --- reading a stylesheet ----------------------------------------------------------------------

const blank = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (found) => found.replace(/[^\n]/g, " "));

/** The rules of a text, at-rules descended into: the selector list, the declarations, the line. */
function rulesOf(text, offset = 0, whole = text) {
  const rules = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("{", at);
    if (open === -1) {
      break;
    }
    let depth = 1;
    let close = open + 1;
    while (close < text.length && depth > 0) {
      const c = text[close];
      if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
      }
      close += 1;
    }
    const prelude = text.slice(at, open).split(";").pop().trim();
    const body = text.slice(open + 1, close - 1);
    const line = whole.slice(0, offset + open).split("\n").length;
    if (/^@(media|supports|container|layer)\b/.test(prelude)) {
      rules.push(...rulesOf(body, offset + open + 1, whole));
    } else if (!prelude.startsWith("@")) {
      const declarations = body
        .split(";")
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration.includes(":"))
        .map((declaration) => {
          const colon = declaration.indexOf(":");
          return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
        });
      rules.push({ selectors: selectorsOf(prelude), declarations, line });
    }
    at = close;
  }
  return rules;
}

function selectorsOf(prelude) {
  const selectors = [];
  let depth = 0;
  let current = "";
  for (const c of prelude) {
    if (c === "(" || c === "[") {
      depth += 1;
    } else if (c === ")" || c === "]") {
      depth -= 1;
    }
    if (c === "," && depth === 0) {
      selectors.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  selectors.push(current.trim());
  return selectors.filter((selector) => selector !== "");
}

/** The classes a selector, or a whole stylesheet, names: `.sc-...`, never a keyframe's name. */
const classesIn = (text) =>
  [...text.matchAll(/\.(sc-[a-z0-9]+(?:-[a-z0-9_]+)*)/g)].map((found) => found[1]);
/** The compounds of a selector, left to right, each with the classes it names. */
const compoundsOf = (selector) =>
  selector
    .split(/\s*[>+~]\s*|\s+/)
    .filter((compound) => compound !== "")
    .map((compound) => classesIn(compound));

// --- 1. the manifest ---------------------------------------------------------------------------

let files = [];
try {
  files = styleFiles(stylesDir).map((file) => ({ ...file, bare: blank(file.text) }));
} catch (error) {
  fail(`${STYLES_DIR}/console.css`, error.message, "It holds imports and comments only.");
}
const names = files.map((file) => file.name);
const rank = (name) =>
  name === "tokens.css" ? 0 : name === "base.css" ? 1 : name.startsWith("parts/") ? 2 : 3;
for (const [index, name] of names.entries()) {
  if (names.indexOf(name) !== index) {
    fail(`${STYLES_DIR}/console.css`, `names ${name} twice`, "Name each file once.");
  }
  if (!/^(tokens\.css|base\.css|parts\/[a-z-]+\.css|pages\/[a-z-]+\.css)$/.test(name)) {
    fail(
      `${STYLES_DIR}/console.css`,
      `names ${name}`,
      "A file of the stylesheet is tokens.css, base.css, a part under parts/ or a page under pages/.",
    );
  }
  if (index > 0 && rank(name) < rank(names[index - 1])) {
    fail(
      `${STYLES_DIR}/console.css`,
      `names ${name} after ${names[index - 1]}`,
      "The order is tokens.css, base.css, the parts, then the pages: a page places a part after the part drew itself.",
    );
  }
}
for (const dir of ["parts", "pages"]) {
  for (const entry of readdirSync(join(stylesDir, dir))) {
    if (entry.endsWith(".css") && !names.includes(`${dir}/${entry}`)) {
      fail(
        `${STYLES_DIR}/${dir}/${entry}`,
        "is not named by console.css",
        "Add its import there, among the others of its kind, or delete the file.",
      );
    }
  }
}
const parts = files.filter((file) => file.name.startsWith("parts/"));
const pages = files.filter((file) => file.name.startsWith("pages/"));
const short = (file) => file.name.replace(/^(parts|pages)\//, "").replace(/\.css$/, "");

// --- 2. colours and tokens ---------------------------------------------------------------------

for (const file of files) {
  if (file.name === "tokens.css") {
    for (const rule of rulesOf(file.bare)) {
      for (const [property] of rule.declarations) {
        if (!property.startsWith("--") && property !== "color-scheme") {
          fail(
            `${STYLES_DIR}/${file.name}:${rule.line}`,
            `sets ${property}`,
            "tokens.css sets values: custom properties, on :root or on a class that carries a palette. A rule that draws belongs to its part.",
          );
        }
      }
    }
    continue;
  }
  for (const [index, line] of file.bare.split("\n").entries()) {
    if (COLOUR.test(line)) {
      fail(
        `${STYLES_DIR}/${file.name}:${index + 1}`,
        `writes a colour: ${line.trim()}`,
        "Read it from a token (var(--sc-color-...)). A colour the tokens lack is a new token in tokens.css, listed in packages/console/README.md and in src/tokens.ts.",
      );
    }
  }
}

// --- 3. the parts and their catalogue -----------------------------------------------------------

/** The catalogue's rows: a part's name, and the classes that are its own. */
const catalogue = new Map();
const catalogueFile = `${STYLES_DIR}/README.md`;
let readme = "";
try {
  readme = readFileSync(join(stylesDir, "README.md"), "utf8");
} catch {
  fail(
    catalogueFile,
    "is missing",
    "It is the catalogue of the parts; every part has a row in it.",
  );
}
for (const line of readme.split("\n")) {
  const cells = line.split("|").map((cell) => cell.trim());
  const name = /^`([a-z-]+)`$/.exec(cells[1] ?? "")?.[1];
  if (name === undefined || cells.length < 5) {
    continue;
  }
  const patterns = [...(cells[2] ?? "").matchAll(/`(sc-[a-z0-9_-]+)(\*?)`/g)].map((found) => ({
    name: found[1],
    prefix: found[2] === "*",
  }));
  catalogue.set(name, patterns);
}
const owns = (patterns, cls) =>
  patterns.some((pattern) =>
    pattern.prefix
      ? cls === pattern.name || cls.startsWith(`${pattern.name}-`)
      : cls === pattern.name,
  );
/** The part a class is of, by the catalogue: the longest name that claims it. */
const partOf = (cls) => {
  let best;
  for (const [name, patterns] of catalogue) {
    for (const pattern of patterns) {
      if (owns([pattern], cls) && (best === undefined || pattern.name.length > best.length)) {
        best = { name, length: pattern.name.length };
      }
    }
  }
  return best?.name;
};
for (const file of parts) {
  if (!catalogue.has(short(file))) {
    fail(
      `${STYLES_DIR}/${file.name}`,
      "has no row in the catalogue",
      `A part is a file and a row of ${catalogueFile}: its name, its classes, what it is for. Before adding one, read the catalogue for the part that already does it.`,
    );
  }
}
for (const name of catalogue.keys()) {
  if (!parts.some((file) => short(file) === name)) {
    fail(catalogueFile, `lists the part ${name}, which has no file`, "Take the row out.");
  }
}
for (const file of parts) {
  const own = catalogue.get(short(file)) ?? [];
  for (const rule of rulesOf(file.bare)) {
    for (const selector of rule.selectors) {
      const named = classesIn(selector).filter((cls) => !GROUND.has(cls));
      const strangers = named.filter((cls) => partOf(cls) === undefined);
      for (const cls of strangers) {
        fail(
          `${STYLES_DIR}/${file.name}:${rule.line}`,
          `names ${cls}, which is no part's class`,
          `A part's rule names the classes its row of the catalogue lists (${own.map((p) => p.name + (p.prefix ? "*" : "")).join(", ")}). A class of one page belongs to that page's file; a new look is a new part, with a row of its own.`,
        );
      }
      if (strangers.length === 0 && named.length > 0 && !named.some((cls) => owns(own, cls))) {
        fail(
          `${STYLES_DIR}/${file.name}:${rule.line}`,
          `holds a rule about another part: ${selector}`,
          `Move it to the file of the part it is about (${[...new Set(named.map(partOf))].join(", ")}).`,
        );
      }
    }
  }
}

// --- the sources -------------------------------------------------------------------------------

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}
/** A class by the sources that name it whole, and the stems a source builds names from. */
const namedBy = new Map();
const stems = new Set();
const sources = sourceFiles(sourcesDir).map((path) => ({
  name: relative(sourcesDir, path).split("\\").join("/"),
  text: readFileSync(path, "utf8"),
}));
for (const source of sources) {
  for (const found of source.text.matchAll(/(?<![\w-])(sc-[a-z0-9]+(?:-[a-z0-9_]+)*)(-\$\{)?/g)) {
    if (found[2] !== undefined) {
      stems.add(found[1]);
    }
    namedBy.set(found[1], (namedBy.get(found[1]) ?? new Set()).add(source.name));
  }
}
const built = (cls) => [...stems].some((stem) => cls.startsWith(`${stem}-`));

// --- 4. the pages ------------------------------------------------------------------------------

let drawn = {};
const drawnFile = `${STYLES_DIR}/drawn-by-pages.json`;
try {
  drawn = JSON.parse(readFileSync(join(stylesDir, "drawn-by-pages.json"), "utf8"));
} catch (error) {
  fail(
    drawnFile,
    `cannot be read: ${error.message}`,
    "It maps a page to the classes it still draws itself.",
  );
}
/** Every class by the page files whose selectors name it. */
const pagesNaming = new Map();
for (const file of pages) {
  for (const cls of new Set(classesIn(file.bare))) {
    pagesNaming.set(cls, [...(pagesNaming.get(cls) ?? []), short(file)]);
  }
}
const isPageClass = (cls) => partOf(cls) === undefined && !GROUND.has(cls);
const allowed = (list, property) => list.some((pattern) => pattern.test(property));
const stillDrawn = new Map();
for (const file of pages) {
  const page = short(file);
  const where = `${STYLES_DIR}/${file.name}`;
  const declared = /^\/\* Sources: ([^*]+) \*\//.exec(file.text)?.[1];
  const own = (declared ?? "").split(",").map((source) => source.trim());
  if (declared === undefined) {
    fail(
      where,
      "does not begin by naming its sources",
      "Its first line is `/* Sources: components/<file>.tsx, ... */`: the sources whose classes this file holds.",
    );
  }
  for (const source of own) {
    if (declared !== undefined && !sources.some((candidate) => candidate.name === source)) {
      fail(where, `names the source ${source}, which is not there`, "Name the files that exist.");
    }
  }
  const listed = new Set(drawn[page] ?? []);
  const painting = new Set();
  for (const rule of rulesOf(file.bare)) {
    for (const selector of rule.selectors) {
      const compounds = compoundsOf(selector);
      const named = compounds.flat().filter((cls) => !GROUND.has(cls));
      const ownClasses = named.filter(isPageClass);
      if (ownClasses.length === 0) {
        if (page === "shell" && named.length === 0) {
          continue;
        }
        fail(
          `${where}:${rule.line}`,
          `holds a rule that names no class of this page: ${selector}`,
          "A rule about a part alone changes the part for every page: it belongs to the part's file, or the page gives the element a class of its own to place it by.",
        );
        continue;
      }
      // What the rule is about: the last compound that names a class.
      const subject =
        compounds.findLast((compound) => compound.some((cls) => !GROUND.has(cls))) ?? [];
      const ofAPart = !subject.some(isPageClass);
      const owner = ownClasses[ownClasses.length - 1];
      const may = ofAPart ? PLACING : LAYOUT;
      const looks = rule.declarations.filter(([property]) => !allowed(may, property));
      if (looks.length === 0) {
        continue;
      }
      // A class that draws itself is listed by its name; a part repainted where a page holds
      // it is listed as the page's class and the part's, so that one entry never opens every
      // part under it.
      const entry = ofAPart ? `${owner} ${subject[0]}` : owner;
      painting.add(entry);
      if (!listed.has(entry)) {
        const said = looks.map(([property]) => property).join(", ");
        fail(
          `${where}:${rule.line}`,
          ofAPart
            ? `repaints a part (${entry}): ${selector} sets ${said}`
            : `gives ${owner} a look of its own: ${said}`,
          ofAPart
            ? "A page puts a part somewhere (its margin, its grid area, its width, how its own contents are laid out) and leaves its look alone: its padding, its colours, its borders, its radius, its type. To change the part, change its rule under parts/, for every page at once; if this is another thing, it is another part."
            : `A page's class places: it lays its element out and no more. Build the element from the parts (${catalogueFile}): a pane is sc-panel, a label sc-eyebrow, a note sc-muted, and so on. If no part does it, the look is a new part with a row in the catalogue, which is the designer's to decide. Do not add the class to drawn-by-pages.json: that list only gets shorter.`,
        );
      }
    }
  }
  stillDrawn.set(page, painting);
  for (const entry of listed) {
    if (!painting.has(entry)) {
      fail(
        drawnFile,
        `lists "${entry}" under ${page}, which draws nothing of its own any more`,
        "Take it off the list: the list only gets shorter.",
      );
    }
  }
  const order = [...(drawn[page] ?? [])];
  if (order.some((entry, index) => index > 0 && entry <= order[index - 1])) {
    fail(
      drawnFile,
      `lists the page ${page} out of order, or an entry twice`,
      "Keep each list sorted, each entry once.",
    );
  }
  for (const cls of new Set(classesIn(file.bare).filter(isPageClass))) {
    const elsewhere = (pagesNaming.get(cls) ?? []).filter((other) => other !== page);
    if (elsewhere.length > 0 && page < elsewhere[0]) {
      fail(
        `${where}`,
        `shares ${cls} with the page ${elsewhere.join(", ")}`,
        "What two pages share is a part: give it a file under parts/ and a row in the catalogue, or use the part that is there.",
      );
    }
    const strangers = [...(namedBy.get(cls) ?? [])].filter(
      (source) => source !== COMPOSITION && !own.includes(source),
    );
    if (declared !== undefined && strangers.length > 0) {
      fail(
        `${where}`,
        `holds ${cls}, which ${strangers.join(", ")} names too`,
        "A page's class is named by that page's sources alone. What another page needs of it is a part.",
      );
    }
  }
}
for (const page of Object.keys(drawn)) {
  if (!pages.some((file) => short(file) === page)) {
    fail(drawnFile, `lists the page ${page}, which has no file`, "Take the entry out.");
  }
}

// --- 5. the classes the sources name -----------------------------------------------------------

const inSheet = new Set(files.flatMap((file) => classesIn(file.bare)));
for (const [cls, by] of namedBy) {
  if (inSheet.has(cls) || HOOKS.has(cls) || stems.has(cls)) {
    continue;
  }
  if ([...inSheet].some((known) => known.startsWith(`${cls}-`)) && built(`${cls}-x`)) {
    continue;
  }
  fail(
    `packages/console/src/${[...by][0]}`,
    `names the class ${cls}, which the stylesheet does not have`,
    `Use a class that is there: the parts are listed in ${catalogueFile}. A name with no rule draws nothing.`,
  );
}
for (const cls of inSheet) {
  if (!namedBy.has(cls) && !built(cls) && !GROUND.has(cls)) {
    const file = files.find((candidate) => classesIn(candidate.bare).includes(cls));
    fail(
      `${STYLES_DIR}/${file?.name}`,
      `holds ${cls}, which no source names`,
      "A class the pages no longer name leaves the stylesheet in the same change.",
    );
  }
}
for (const [cls] of HOOKS) {
  if (!namedBy.has(cls) || inSheet.has(cls)) {
    fail("scripts/check-styles.mjs", `lists the hook ${cls} for nothing`, "Take it off the list.");
  }
}

// --- 6. styles set by a component ---------------------------------------------------------------

const count = (text, pattern) => (text.match(pattern) ?? []).length;
for (const source of sources) {
  const inline = count(source.text, /\bstyle=\{/g);
  if (inline !== (INLINE_STYLES.get(source.name) ?? 0)) {
    fail(
      `packages/console/src/${source.name}`,
      `sets a style on an element ${inline} times, where ${INLINE_STYLES.get(source.name) ?? 0} are known`,
      "A look is a class of the stylesheet. A style on an element carries a measure the component computed (a place, a share, a height) and nothing else; where that is what this is, raise the number in scripts/check-styles.mjs beside a word of what it measures.",
    );
  }
  const written = count(source.text, /\.style\.(?!length\b)[a-zA-Z]+/g);
  if (written !== (STYLE_WRITES.get(source.name) ?? 0)) {
    fail(
      `packages/console/src/${source.name}`,
      `writes an element's style from a script ${written} times, where ${STYLE_WRITES.get(source.name) ?? 0} are known`,
      "The same rule as a style on an element: a measure, never a look.",
    );
  }
  if (/<style[\s>]|insertRule\(|adoptedStyleSheets|new CSSStyleSheet/.test(source.text)) {
    fail(
      `packages/console/src/${source.name}`,
      "adds rules to the page from a script",
      "Every rule is in the stylesheet, where the check reads it.",
    );
  }
}

// --- the verdict -------------------------------------------------------------------------------

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n\n${failures.length} problems with the styles.\n`);
  process.exitCode = hook ? 2 : 1;
} else if (!hook) {
  const left = [...stillDrawn.values()].reduce((sum, set) => sum + set.size, 0);
  process.stdout.write(
    `styles: ${parts.length} parts, ${pages.length} pages, ${inSheet.size} classes; ${left} looks the pages still draw themselves.\n`,
  );
}
