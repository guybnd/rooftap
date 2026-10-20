import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "homeup-offline";
const DB_VERSION = 1;

// FLUX-150 slice 8: apartments/checklist_items/checklist_responses/appointments/
// agents/apartment_agents/apartment_comments/saved_searches/sync_queue moved to
// their own Legend-State-managed IndexedDB stores (src/lib/legend/*-store.ts) —
// removed here rather than kept as dead object stores. Safe/additive: existing
// installs already have these object stores physically created (DB_VERSION is
// unchanged), they're just no longer read from or written to.
export const STORES = {
  preliminaryScores: "apartment_preliminary_scores",
  userSettings: "user_settings",
  groups: "groups",
  groupMembers: "group_members",
  groupInvitations: "group_invitations",
  photos: "photos",
  meta: "meta",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const storeName of Object.values(STORES)) {
          if (!db.objectStoreNames.contains(storeName)) {
            if (storeName === "meta") {
              db.createObjectStore(storeName);
            } else {
              db.createObjectStore(storeName, { keyPath: "id" });
            }
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await getDB();
  return db.getAll(storeName) as Promise<T[]>;
}

export async function get<T>(storeName: StoreName, key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(storeName, key) as Promise<T | undefined>;
}

export async function put<T>(storeName: StoreName, value: T): Promise<void> {
  const db = await getDB();
  await db.put(storeName, value);
}

export async function putAll<T>(storeName: StoreName, values: T[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  await store.clear();
  for (const v of values) {
    await store.put(v);
  }
  await tx.done;
}

export async function del(storeName: StoreName, key: string): Promise<void> {
  const db = await getDB();
  await db.delete(storeName, key);
}

export async function clear(storeName: StoreName): Promise<void> {
  const db = await getDB();
  await db.clear(storeName);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put(STORES.meta, value, key);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(STORES.meta, key) as Promise<T | undefined>;
}
