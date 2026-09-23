import { describe, expect, it } from "vitest";
import { ROW_CAP, capped, FETCH_LIMIT } from "./query-limits";

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe("capped", () => {
  it("passes a short list through untouched", () => {
    const r = capped(make(3));
    expect(r.rows).toHaveLength(3);
    expect(r.truncated).toBe(false);
  });

  it("treats exactly ROW_CAP rows as complete", () => {
    // The query asks for one more than the cap, so ROW_CAP rows back means
    // the table held no more than that.
    const r = capped(make(ROW_CAP));
    expect(r.rows).toHaveLength(ROW_CAP);
    expect(r.truncated).toBe(false);
  });

  it("flags the overflow row and drops it", () => {
    const r = capped(make(ROW_CAP + 1));
    expect(r.rows).toHaveLength(ROW_CAP);
    expect(r.truncated).toBe(true);
  });

  it("handles null from a failed query", () => {
    const r = capped(null);
    expect(r.rows).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("asks for exactly one row more than it will show", () => {
    expect(FETCH_LIMIT).toBe(ROW_CAP + 1);
  });
});
