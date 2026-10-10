import { describe, expect, it } from "vitest";
import { en } from "./en.js";
import { chooseLanguage, DEFAULT_LANGUAGES, ENGLISH, KOREAN, packFor } from "./index.js";
import { ko } from "./ko.js";

/** Every key of a pack, dotted, with what kind of thing is at it. */
function shapeOf(value: unknown, prefix = ""): string[] {
  if (typeof value === "function") {
    return [`${prefix}:function/${value.length}`];
  }
  if (typeof value === "string") {
    return [`${prefix}:string`];
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .flatMap(([key, inner]) => shapeOf(inner, prefix === "" ? key : `${prefix}.${key}`))
      .sort();
  }
  return [`${prefix}:${typeof value}`];
}

describe("the language packs", () => {
  it("carry the same keys, with the same kinds of words at each", () => {
    const { tag: enTag, label: enLabel, ...english } = en;
    const { tag: koTag, label: koLabel, ...korean } = ko;
    expect(shapeOf(korean)).toEqual(shapeOf(english));
    expect([enTag, koTag]).toEqual(["en", "ko"]);
    expect([enLabel, koLabel]).toEqual(["English", "한국어"]);
    expect(DEFAULT_LANGUAGES.map((pack) => pack.tag)).toEqual(["en", "ko"]);
  });

  it("are chosen by the person, else by the browser, else English", () => {
    expect(chooseLanguage("ko", ["en-US"])).toBe(KOREAN);
    expect(chooseLanguage(null, ["fr-FR", "ko-KR", "en"])).toBe(KOREAN);
    expect(chooseLanguage(null, ["fr-FR"])).toBe(ENGLISH);
    expect(chooseLanguage("xx", [])).toBe(ENGLISH);
    expect(chooseLanguage(undefined, [], [KOREAN, ENGLISH])).toBe(KOREAN);
    expect(packFor("KO-kr", DEFAULT_LANGUAGES)).toBe(KOREAN);
    expect(packFor("", DEFAULT_LANGUAGES)).toBeUndefined();
    expect(packFor("de", DEFAULT_LANGUAGES)).toBeUndefined();
  });

  it("say the same thing in each language, with the parts in their own order", () => {
    expect(en.feed.event.memberAdded("alice", "web", "an owner")).toBe(
      "added alice to web as an owner",
    );
    expect(ko.feed.event.memberAdded("alice", "web", "소유자")).toBe(
      "alice을(를) web에 소유자(으)로 추가했습니다",
    );
    expect(en.board.decisions(2)).toBe("2 decisions");
    expect(ko.board.decisions(2)).toBe("결정 2건");
  });
});
