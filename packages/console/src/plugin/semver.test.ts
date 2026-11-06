import { describe, expect, it } from "vitest";
import { lineRangeFrom, parseLooseVersion, satisfiesRange, versionOfDependency } from "./semver.js";

describe("satisfiesRange", () => {
  it("reads the ranges a manifest's requires and console are written in", () => {
    expect(satisfiesRange("1.2.3", "*")).toBe(true);
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.3", "^1.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesRange("0.4.9", "^0.4.1")).toBe(true);
    expect(satisfiesRange("0.5.0", "^0.4.1")).toBe(false);
    expect(satisfiesRange("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.3", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
    expect(satisfiesRange("3.0.0", "^1.0.0 || ^3.0.0")).toBe(true);
    expect(satisfiesRange("not a version", "^1.0.0")).toBe(false);
  });

  it("fills a partial version in a range with zeros, as a plugin writes `<0.6`", () => {
    expect(satisfiesRange("0.4.3", ">=0.4.3 <0.6")).toBe(true);
    expect(satisfiesRange("0.5.9", ">=0.4.3 <0.6")).toBe(true);
    expect(satisfiesRange("0.6.0", ">=0.4.3 <0.6")).toBe(false);
    expect(satisfiesRange("0.4.2", ">=0.4.3 <0.6")).toBe(false);
    expect(satisfiesRange("1.0.0", ">=1")).toBe(true);
    expect(satisfiesRange("0.4.3-next.1", ">=0.4.3")).toBe(true);
  });
});

describe("versions", () => {
  it("reads a version loosely, and the version a dependency spells", () => {
    expect(parseLooseVersion("0.4.3")).toEqual([0, 4, 3]);
    expect(parseLooseVersion("v0.6")).toEqual([0, 6, 0]);
    expect(parseLooseVersion("1")).toEqual([1, 0, 0]);
    expect(parseLooseVersion("0.4.3+build.7")).toEqual([0, 4, 3]);
    expect(parseLooseVersion("latest")).toBeUndefined();
    expect(versionOfDependency("^0.4.3")).toEqual([0, 4, 3]);
    expect(versionOfDependency("~0.4.3")).toEqual([0, 4, 3]);
    expect(versionOfDependency(">=0.4.3")).toEqual([0, 4, 3]);
    expect(versionOfDependency("0.4.3")).toEqual([0, 4, 3]);
    expect(versionOfDependency("workspace:*")).toBeUndefined();
    expect(versionOfDependency("*")).toBeUndefined();
  });

  it("writes the line a plugin written against a version runs on", () => {
    expect(lineRangeFrom([0, 4, 3])).toBe(">=0.4.3 <0.5.0");
    expect(lineRangeFrom([1, 2, 0])).toBe(">=1.2.0 <2.0.0");
    expect(satisfiesRange("0.4.9", lineRangeFrom([0, 4, 3]))).toBe(true);
    expect(satisfiesRange("0.5.0", lineRangeFrom([0, 4, 3]))).toBe(false);
  });
});
