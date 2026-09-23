import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  canQueue,
  deviceTag,
  enqueue,
  isAlreadyLanded,
  MAX_ATTEMPTS,
  nextToSend,
  offlineCode,
  queueSummary,
  sendableItems,
  stuckItems,
  type QueuedOp,
} from "./offline-core";

const op = (id: string, queued_at = 1000, attempts = 0): QueuedOp => ({
  id,
  table: "deliveries",
  row: { id, gross_weight_kg: 100 },
  queued_at,
  attempts,
  last_error: null,
});

describe("canQueue", () => {
  it("allows the tables a field officer writes with no signal", () => {
    expect(canQueue("deliveries")).toBe(true);
    expect(canQueue("qc_tests")).toBe(true);
  });
  it("refuses settlements — paying from stale state could pay twice", () => {
    expect(canQueue("settlements")).toBe(false);
    expect(canQueue("contracts")).toBe(false);
  });
});

describe("deviceTag / offlineCode", () => {
  it("is stable for the same device and differs between devices", () => {
    expect(deviceTag("abc-123")).toBe(deviceTag("abc-123"));
    expect(deviceTag("abc-123")).not.toBe(deviceTag("xyz-789"));
  });
  it("is always two characters", () => {
    for (const id of ["a", "abc-123", "x".repeat(64), ""]) {
      expect(deviceTag(id)).toHaveLength(2);
    }
  });
  it("two phones offline in the same millisecond still mint different codes", () => {
    const now = 1787825495985;
    expect(offlineCode("DL", now, "phone-a")).not.toBe(offlineCode("DL", now, "phone-b"));
  });
  it("keeps the readable shape", () => {
    expect(offlineCode("DL", 1787825495985, "phone-a")).toMatch(/^DL-\d{6}-[0-9A-Z]{2}$/);
  });
});

describe("enqueue", () => {
  it("adds an op", () => {
    expect(enqueue([], op("a"))).toHaveLength(1);
  });
  it("never queues the same id twice — a double tap is not two loads of rice", () => {
    const once = enqueue([], op("a"));
    expect(enqueue(once, op("a"))).toHaveLength(1);
  });
});

describe("nextToSend", () => {
  it("sends the oldest first so events land in the order they happened", () => {
    const q = [op("late", 3000), op("early", 1000), op("mid", 2000)];
    expect(nextToSend(q)?.id).toBe("early");
  });
  it("null on an empty queue", () => {
    expect(nextToSend([])).toBeNull();
  });
});

describe("isAlreadyLanded", () => {
  it("treats a duplicate key as a row that already arrived", () => {
    expect(isAlreadyLanded('duplicate key value violates unique constraint "deliveries_pkey"')).toBe(true);
    expect(isAlreadyLanded("23505")).toBe(true);
  });
  it("treats anything else as a real failure", () => {
    expect(isAlreadyLanded("network request failed")).toBe(false);
    expect(isAlreadyLanded(null)).toBe(false);
  });
});

describe("applyOutcome", () => {
  it("drops a sent item", () => {
    expect(applyOutcome([op("a")], "a", { ok: true })).toEqual([]);
  });
  it("drops an item the server says it already has", () => {
    const q = applyOutcome([op("a")], "a", { ok: false, error: "duplicate key value" });
    expect(q).toEqual([]);
  });
  it("counts a real failure and keeps the item with its reason", () => {
    const q = applyOutcome([op("a")], "a", { ok: false, error: "network request failed" });
    expect(q[0].attempts).toBe(1);
    expect(q[0].last_error).toBe("network request failed");
  });
  it("leaves other items untouched", () => {
    const q = applyOutcome([op("a"), op("b")], "a", { ok: true });
    expect(q.map((x) => x.id)).toEqual(["b"]);
  });
});

describe("stuck items", () => {
  it("stops retrying after the limit and separates them out", () => {
    const q = [op("ok", 1000, 1), op("bad", 1000, MAX_ATTEMPTS)];
    expect(sendableItems(q).map((x) => x.id)).toEqual(["ok"]);
    expect(stuckItems(q).map((x) => x.id)).toEqual(["bad"]);
  });
});

describe("queueSummary", () => {
  it("says everything is saved when the queue is empty", () => {
    expect(queueSummary([], true).label).toBe("All saved");
    expect(queueSummary([], false).label).toBe("Offline — all saved");
  });
  it("counts what is waiting, in plain words", () => {
    expect(queueSummary([op("a")], false).label).toBe("1 record waiting to send");
    expect(queueSummary([op("a"), op("b")], false).label).toBe("2 records waiting to send");
  });
  it("calls out records that could not be sent", () => {
    const s = queueSummary([op("a"), op("bad", 1000, MAX_ATTEMPTS)], true);
    expect(s.waiting).toBe(1);
    expect(s.stuck).toBe(1);
    expect(s.label).toMatch(/could not be sent/);
  });
  it("when everything is stuck, does not claim anything is waiting", () => {
    const s = queueSummary([op("bad", 1000, MAX_ATTEMPTS)], true);
    expect(s.label).toBe("1 record could not be sent");
  });
});
