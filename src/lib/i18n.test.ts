import { describe, expect, it } from "vitest";
import { _dictionaries } from "./i18n";

describe("i18n dictionaries", () => {
  it("has a Khmer string for every English key", () => {
    const enKeys = Object.keys(_dictionaries.en);
    const kmKeys = Object.keys(_dictionaries.km);
    expect(kmKeys.sort()).toEqual(enKeys.sort());
  });

  it("has no empty translations", () => {
    for (const lang of ["en", "km"] as const) {
      for (const [key, value] of Object.entries(_dictionaries[lang])) {
        expect(value.trim(), `${lang}:${key}`).not.toBe("");
      }
    }
  });

  it("keeps Khmer actually Khmer (contains Khmer script)", () => {
    // Guards against an English string pasted into the km table by mistake.
    const khmerRange = /[ក-៿]/;
    for (const [key, value] of Object.entries(_dictionaries.km)) {
      expect(khmerRange.test(value), `km:${key} = "${value}"`).toBe(true);
    }
  });
});
