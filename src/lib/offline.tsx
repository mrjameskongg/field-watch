// Offline plumbing: persistence, the sync loop, and the hook screens use.
//
// The pure decisions live in offline-core.ts; everything here is the messy
// edge — IndexedDB, the network, React. Kept apart so the rules stay testable.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  applyOutcome,
  canQueue,
  enqueue,
  nextToSend,
  offlineCode,
  queueSummary,
  sendableItems,
  type QueueSummary,
  type QueuedOp,
} from "./offline-core";

const DB_NAME = "fieldwatch-offline";
const STORE = "outbox";
const DEVICE_KEY = "fieldwatch-device-id";

/** A stable id for this phone, created once and kept. */
export function deviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** A delivery/QC code that cannot collide with another phone's. */
export const newCode = (prefix: string): string => offlineCode(prefix, Date.now(), deviceId());

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readAll(): Promise<QueuedOp[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as QueuedOp[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function writeAll(queue: QueuedOp[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    for (const op of queue) store.put(op);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

type OfflineValue = {
  online: boolean;
  queue: QueuedOp[];
  summary: QueueSummary;
  /**
   * Save a row. Online it goes straight to the database; offline it goes to the
   * outbox and reports success, because the record IS saved — on the phone.
   */
  save: (table: QueuedOp["table"], row: Record<string, unknown>) => Promise<{ queued: boolean; error: string | null }>;
  syncNow: () => Promise<void>;
  syncing: boolean;
};

const OfflineContext = createContext<OfflineValue | null>(null);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    readAll().then(setQueue).catch(() => setQueue([]));
  }, []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const persist = useCallback(async (next: QueuedOp[]) => {
    setQueue(next);
    await writeAll(next).catch(() => {
      /* storage full or blocked — the in-memory queue still holds this session */
    });
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      let current = await readAll();
      // One at a time, oldest first, so a failure stops the run rather than
      // scattering half-sent records.
      for (let guard = 0; guard < 200; guard++) {
        const op = nextToSend(sendableItems(current));
        if (!op) break;
        const { error } = await supabase.from(op.table).insert(op.row as never);
        current = applyOutcome(current, op.id, error ? { ok: false, error: error.message } : { ok: true });
        await writeAll(current);
        if (error && !current.every((q) => q.id !== op.id)) {
          // Still queued after the outcome — a real failure, stop and retry later.
          break;
        }
      }
      setQueue(current);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Drain whenever the signal comes back, and on a slow heartbeat while online.
  useEffect(() => {
    if (!online) return;
    syncNow();
    const t = setInterval(() => {
      if (navigator.onLine) syncNow();
    }, 60_000);
    return () => clearInterval(t);
  }, [online, syncNow]);

  const save = useCallback<OfflineValue["save"]>(
    async (table, row) => {
      if (!canQueue(table)) {
        const { error } = await supabase.from(table).insert(row as never);
        return { queued: false, error: error?.message ?? null };
      }

      if (navigator.onLine) {
        const { error } = await supabase.from(table).insert(row as never);
        if (!error) return { queued: false, error: null };
        // Online but the request failed — treat it as offline rather than
        // losing the record. A flaky tunnel is the common case here.
        }

      const op: QueuedOp = {
        id: String(row.id ?? crypto.randomUUID()),
        table,
        row: { ...row, id: row.id ?? crypto.randomUUID() },
        queued_at: Date.now(),
        attempts: 0,
        last_error: null,
      };
      const next = enqueue(await readAll(), op);
      await persist(next);
      return { queued: true, error: null };
    },
    [persist],
  );

  const value = useMemo<OfflineValue>(
    () => ({ online, queue, summary: queueSummary(queue, online), save, syncNow, syncing }),
    [online, queue, save, syncNow, syncing],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used within OfflineProvider");
  return ctx;
}
