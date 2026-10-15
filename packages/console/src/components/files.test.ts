import { describe, expect, it } from "vitest";
import { isPicture, namedFile, placed, placing, unusedName } from "./files.js";

describe("the files put on the board", () => {
  it("knows a picture by its type, a file a text names, the way to place one, and a name not taken", () => {
    expect(isPicture("image/png")).toBe(true);
    expect(isPicture("image/webp")).toBe(true);
    // What a browser could run is not a picture the pages show.
    expect(isPicture("image/svg+xml")).toBe(false);
    expect(isPicture("text/markdown")).toBe(false);

    expect(namedFile("./board.png")).toBe("board.png");
    expect(namedFile("board.png")).toBe("board.png");

    expect(placed("See ![the board](board.png).", "board.png")).toBe(true);
    expect(placed("See ![the board](./board.png).", "board.png")).toBe(true);
    expect(placed("The file board.png is attached.", "board.png")).toBe(false);

    expect(placing("", ["a.png"])).toBe("![](a.png)");
    expect(placing("Words.\n", ["a.png", "b.png"])).toBe("Words.\n\n![](a.png)\n![](b.png)");

    expect(unusedName("image.png", [])).toBe("image.png");
    expect(unusedName("image.png", ["image.png", "image-2.png"])).toBe("image-3.png");
    expect(unusedName("notes", ["notes"])).toBe("notes-2");
  });
});
