// core's create-group-store for the screen demo: every group store becomes a
// plain observable seeded from the fixtures, and nothing syncs.
import { observable } from "@legendapp/state";
import type { createGroupStore as realCreateGroupStore, SyncedRow, useReconnectSync as realUseReconnectSync } from "@homeup/core";
import { HOUSEHOLD } from "../fixtures";

export * from "virtual:create-group-store-original";

const live = new Map<string, unknown>();
const empty = observable({});

export const createGroupStore: typeof realCreateGroupStore = <T extends SyncedRow>(config: Parameters<typeof realCreateGroupStore<T>>[0]) => {
  const { collection } = config;
  const store = (groupId: string | null | undefined) => {
    if (!groupId) return empty;
    if (!live.has(collection)) live.set(collection, observable(structuredClone(HOUSEHOLD.stores[collection] ?? {})));
    return live.get(collection);
  };
  return Object.assign(store, { collection }) as unknown as ReturnType<typeof realCreateGroupStore<T>>;
};

export const useReconnectSync: typeof realUseReconnectSync = () => {};
