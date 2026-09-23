import { describe, expect, it } from "vitest";
import { sanitizeSearch } from "./search-core";

describe("sanitizeSearch", () => {
  it("passes ordinary names through", () => {
    expect(sanitizeSearch("Chan")).toBe("Chan");
    expect(sanitizeSearch("Ou Svay")).toBe("Ou Svay");
    expect(sanitizeSearch("B26-0001")).toBe("B26-0001");
  });

  it("keeps Khmer text intact", () => {
    expect(sanitizeSearch("កំពង់ធំ")).toBe("កំពង់ធំ");
  });

  it("strips the PostgREST logic-tree breakers", () => {
    // the live crash: a conversational query typed into search
    expect(sanitizeSearch("wettest paddy, and did we pay them yet?")).toBe(
      "wettest paddy and did we pay them yet?",
    );
    expect(sanitizeSearch("a(b)c")).toBe("a b c");
  });

  it("strips SQL wildcards and quotes", () => {
    expect(sanitizeSearch("100%")).toBe("100");
    expect(sanitizeSearch("a_b")).toBe("a b");
    expect(sanitizeSearch(`o'brien "x"`)).toBe("o brien x");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeSearch("  a   b  ")).toBe("a b");
  });

  it("caps length at 64", () => {
    expect(sanitizeSearch("x".repeat(200))).toHaveLength(64);
  });

  it("returns empty string for junk-only input", () => {
    expect(sanitizeSearch("(((,,,)))")).toBe("");
  });
});
