import { crc32, deflateSync } from "node:zlib";

// The pictures of the preview's invented work (`preview-board.ts`): drawn here, as bytes, so that
// the repository keeps no picture of anything: a chart, a page as a wireframe, a mark. Each is a
// PNG of flat colours, a few kilobytes, the same every time. Not compiled.

type Colour = readonly [number, number, number];

const PAPER: Colour = [247, 248, 252];
const WHITE: Colour = [255, 255, 255];
const LINE: Colour = [214, 220, 232];
const INK: Colour = [62, 72, 92];
const FAINT: Colour = [176, 186, 204];

/** The colours a picture takes its one accent from, by name. */
export const PICTURE_COLOURS = {
  blue: [59, 111, 212],
  green: [34, 160, 74],
  orange: [240, 115, 26],
  pink: [230, 61, 148],
  purple: [132, 87, 230],
  teal: [15, 155, 176],
} as const satisfies Record<string, Colour>;

export type PictureColour = keyof typeof PICTURE_COLOURS;

/** A canvas of pixels, three bytes each, with the one thing drawn on it: a filled rectangle. */
class Canvas {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8Array;

  constructor(width: number, height: number, ground: Colour) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3);
    this.fill(0, 0, width, height, ground);
  }

  fill(x: number, y: number, width: number, height: number, colour: Colour): void {
    const left = Math.max(0, Math.round(x));
    const top = Math.max(0, Math.round(y));
    const right = Math.min(this.width, Math.round(x + width));
    const bottom = Math.min(this.height, Math.round(y + height));
    for (let row = top; row < bottom; row += 1) {
      for (let column = left; column < right; column += 1) {
        this.pixels.set(colour, (row * this.width + column) * 3);
      }
    }
  }

  /** The canvas as a PNG: truecolour, eight bits a channel, every line unfiltered. */
  png(): Uint8Array {
    const lines = new Uint8Array((this.width * 3 + 1) * this.height);
    for (let row = 0; row < this.height; row += 1) {
      const from = row * this.width * 3;
      lines.set(this.pixels.subarray(from, from + this.width * 3), row * (this.width * 3 + 1) + 1);
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, this.width);
    view.setUint32(4, this.height);
    header.set([8, 2, 0, 0, 0], 8);
    return Uint8Array.from(
      Buffer.concat([
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(lines)),
        chunk("IEND", new Uint8Array(0)),
      ]),
    );
  }
}

/** One chunk of a PNG: its length, its name, its bytes and the check over the last two. */
function chunk(name: string, data: Uint8Array): Uint8Array {
  const body = Buffer.concat([Buffer.from(name, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A colour a share of the way to white. */
function pale(colour: Colour, share: number): Colour {
  return [
    Math.round(colour[0] + (255 - colour[0]) * share),
    Math.round(colour[1] + (255 - colour[1]) * share),
    Math.round(colour[2] + (255 - colour[2]) * share),
  ];
}

/** A chart of bars, each a share of the height, the last one in the accent. */
export function chartPicture(bars: readonly number[], colour: PictureColour): Uint8Array {
  const canvas = new Canvas(640, 360, WHITE);
  const accent = PICTURE_COLOURS[colour];
  const [left, top, right, bottom] = [56, 40, 608, 300];
  for (let step = 0; step <= 4; step += 1) {
    canvas.fill(left, top + ((bottom - top) * step) / 4, right - left, 1, LINE);
  }
  canvas.fill(left, top, 1, bottom - top, FAINT);
  canvas.fill(left, bottom, right - left, 2, INK);
  const room = (right - left) / bars.length;
  bars.forEach((share, index) => {
    const height = (bottom - top) * Math.min(1, Math.max(0.02, share));
    canvas.fill(
      left + room * index + room * 0.2,
      bottom - height,
      room * 0.6,
      height,
      index === bars.length - 1 ? accent : pale(accent, 0.55),
    );
    // What a label would be, under each bar.
    canvas.fill(left + room * index + room * 0.3, bottom + 14, room * 0.4, 6, FAINT);
  });
  canvas.fill(left, 14, 180, 10, INK);
  return canvas.png();
}

/** A page as a wireframe: a header, a title, lines of text and, where asked, a form or two columns. */
export function pagePicture(
  layout: "form" | "columns" | "hero",
  colour: PictureColour,
): Uint8Array {
  const canvas = new Canvas(720, 450, PAPER);
  const accent = PICTURE_COLOURS[colour];
  canvas.fill(0, 0, 720, 52, WHITE);
  canvas.fill(0, 52, 720, 1, LINE);
  canvas.fill(24, 18, 16, 16, accent);
  canvas.fill(48, 22, 90, 8, INK);
  for (const at of [520, 580, 640]) {
    canvas.fill(at, 22, 44, 8, FAINT);
  }
  const lines = (x: number, y: number, widths: readonly number[], colourOf: Colour = FAINT) => {
    widths.forEach((width, index) => {
      canvas.fill(x, y + index * 18, width, 8, colourOf);
    });
  };
  if (layout === "form") {
    canvas.fill(210, 92, 300, 318, WHITE);
    canvas.fill(238, 120, 150, 14, INK);
    for (const [index, width] of [244, 244, 244].entries()) {
      canvas.fill(238, 162 + index * 62, 70, 6, FAINT);
      canvas.fill(238, 176 + index * 62, width, 30, PAPER);
      canvas.fill(238, 205 + index * 62, width, 1, LINE);
    }
    canvas.fill(238, 356, 244, 34, accent);
    canvas.fill(318, 369, 84, 8, WHITE);
  } else if (layout === "columns") {
    canvas.fill(40, 92, 300, 20, INK);
    lines(40, 132, [300, 280, 292, 190]);
    for (const [index, x] of [40, 256, 472].entries()) {
      canvas.fill(x, 236, 200, 174, WHITE);
      canvas.fill(x + 16, 252, 36, 36, index === 1 ? accent : pale(accent, 0.6));
      canvas.fill(x + 16, 306, 110, 10, INK);
      lines(x + 16, 332, [168, 150, 120]);
    }
    canvas.fill(400, 92, 280, 112, pale(accent, 0.82));
  } else {
    canvas.fill(0, 53, 720, 230, pale(accent, 0.8));
    canvas.fill(60, 110, 330, 24, INK);
    canvas.fill(60, 146, 250, 24, INK);
    lines(60, 196, [300, 260]);
    canvas.fill(60, 240, 120, 30, accent);
    canvas.fill(470, 96, 190, 150, WHITE);
    canvas.fill(486, 112, 158, 84, pale(accent, 0.5));
    lines(486, 210, [120, 90]);
    lines(60, 320, [600, 560, 590, 420]);
  }
  return canvas.png();
}

/** A project's mark as an image: a ground in the accent with two bars across it. */
export function markPicture(colour: PictureColour): Uint8Array {
  const canvas = new Canvas(128, 128, PICTURE_COLOURS[colour]);
  canvas.fill(28, 36, 72, 16, WHITE);
  canvas.fill(28, 64, 48, 16, pale(PICTURE_COLOURS[colour], 0.7));
  canvas.fill(28, 92, 72, 4, WHITE);
  return canvas.png();
}
