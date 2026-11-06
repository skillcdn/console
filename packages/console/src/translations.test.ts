import { describe, expect, it } from "vitest";
import { storedText, textIn } from "./translations.js";

describe("a text in every language of the workspace (ADR-0058)", () => {
  it("reads the reader's language, its language part, or the text kept", () => {
    const texts = { en: "Leave at the year's end?", ko: "연말 휴가를 승인할까요?" };
    expect(textIn(texts, "kept", "ko")).toBe("연말 휴가를 승인할까요?");
    expect(textIn(texts, "kept", "ko-KR")).toBe("연말 휴가를 승인할까요?");
    expect(textIn({ "pt-BR": "Férias?" }, "kept", "pt")).toBe("Férias?");
    expect(textIn(texts, "kept", "fr")).toBe("kept");
    expect(textIn(texts, "kept", null)).toBe("kept");
    expect(textIn(undefined, "kept", "ko")).toBe("kept");
    expect(textIn({ ko: "" }, "kept", "ko")).toBe("kept");
  });

  it("keeps English beside the map where there is English, else the first of the console's languages", () => {
    expect(storedText({ ko: "연말", en: "Year's end" }, ["en", "ko"])).toBe("Year's end");
    expect(storedText({ ko: "연말", fr: "Fin" }, ["en", "ko"])).toBe("연말");
    expect(storedText({ fr: "Fin" }, ["en", "ko"])).toBe("Fin");
  });
});
