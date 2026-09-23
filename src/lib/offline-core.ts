// Offline capture: the outbox model.
//
// A field officer in the paddy has no signal. Everything they record is a NEW
// fact — a load weighed, a moisture reading, a sack count — so it can be
// written on the phone and sent later without anyone having to resolve a
// conflict. What cannot be done offline is anything that DECIDES from state
// the phone may not have: settling and paying a farmer depends on which loads
// are already settled, and a stale phone could pay the same load twice.
//
// Two rules make the replay safe:
//   1. Every queued row carries an id generated on the device, so re-sending
//      after a dropped connection cannot create a second load of rice — the
//      database rejects the duplicate key and we treat that as success.
//   2. Every human-readable code carries a device tag, so two phones offline
//      in the same second cannot mint the same delivery code.

export type QueuedOp = {
  /** Client-generated row id — also the idempotency key on replay. */
  id: string;
  table: "deliveries" | "qc_tests" | "batch_weigh_points" | "field_events";
  row: Record<string, unknown>;
  /** Milliseconds since epoch, passed in — never read from the clock here. */
  queued_at: number;
  /** How many send attempts have failed so far. */
  attempts: number;
  /** Last error text, kept so a stuck item can explain itself. */
  last_error: string | null;
};

/** Tables a field officer may write with no signal. */
export const OFFLINE_TABLES: QueuedOp["table"][] = [
  "deliveries",
  "qc_tests",
  "batch_weigh_points",
  "field_events",
];

export const canQueue = (table: string): table is QueuedOp["table"] =>
  (OFFLINE_TABLES as string[]).includes(table);

/**
 * A short, stable tag for this device, derived from its id. Two characters is
 * enough: it exists to separate a handful of phones, not to be unique across
 * the world, and the row id already carries real uniqueness.
 */
export function deviceTag(deviceId: string): string {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) hash = (hash * 31 + deviceId.charCodeAt(i)) >>> 0;
  return hash.toString(36).toUpperCase().padStart(2, "0").slice(-2);
}

/**
 * Human-readable code carrying the device tag, so offline phones cannot
 * collide. `now` is passed in rather than read here, to keep this pure.
 */
export const offlineCode = (prefix: string, now: number, deviceId: string): string =>
  `${prefix}-${String(now).slice(-6)}-${deviceTag(deviceId)}`;

/** Add to the outbox. An id already queued is left alone, never duplicated. */
export function enqueue(queue: QueuedOp[], op: QueuedOp): QueuedOp[] {
  if (queue.some((q) => q.id === op.id)) return queue;
  return [...queue, op];
}

/** Oldest first — the order things happened is the order they should land. */
export const nextToSend = (queue: QueuedOp[]): QueuedOp | null =>
  [...queue].sort((a, b) => a.queued_at - b.queued_at)[0] ?? null;

/**
 * A duplicate-key error means this row already landed on a previous attempt,
 * so the send succeeded even though it reported failure. Anything else is a
 * real failure worth retrying.
 */
export const isAlreadyLanded = (errorMessage: string | null | undefined): boolean => {
  if (!errorMessage) return false;
  const m = errorMessage.toLowerCase();
  return m.includes("duplicate key") || m.includes("23505") || m.includes("already exists");
};

export type SendOutcome = { ok: true } | { ok: false; error: string };

/** Fold one send result back into the queue. */
export function applyOutcome(queue: QueuedOp[], id: string, outcome: SendOutcome): QueuedOp[] {
  if (outcome.ok) return queue.filter((q) => q.id !== id);
  if (isAlreadyLanded(outcome.error)) return queue.filter((q) => q.id !== id);
  return queue.map((q) =>
    q.id === id ? { ...q, attempts: q.attempts + 1, last_error: outcome.error } : q,
  );
}

/** Items that keep failing — surfaced to a human instead of retried forever. */
export const MAX_ATTEMPTS = 5;
export const stuckItems = (queue: QueuedOp[]): QueuedOp[] =>
  queue.filter((q) => q.attempts >= MAX_ATTEMPTS);
export const sendableItems = (queue: QueuedOp[]): QueuedOp[] =>
  queue.filter((q) => q.attempts < MAX_ATTEMPTS);

export type QueueSummary = {
  waiting: number;
  stuck: number;
  /** What to show a field officer, in their own terms. */
  label: string;
};

export function queueSummary(queue: QueuedOp[], online: boolean): QueueSummary {
  const stuck = stuckItems(queue).length;
  const waiting = queue.length - stuck;
  if (queue.length === 0) {
    return { waiting: 0, stuck: 0, label: online ? "All saved" : "Offline — all saved" };
  }
  if (stuck > 0 && waiting === 0) {
    return { waiting, stuck, label: `${stuck} record${stuck === 1 ? "" : "s"} could not be sent` };
  }
  const base = `${waiting} record${waiting === 1 ? "" : "s"} waiting to send`;
  return {
    waiting,
    stuck,
    label: stuck > 0 ? `${base}, ${stuck} could not be sent` : base,
  };
}
