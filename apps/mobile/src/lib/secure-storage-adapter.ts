// HOUP-69: expo-secure-store-backed adapter for the Supabase auth session.
// Wrapped by @homeup/core's `createChunkedStorage` because a Supabase
// session (access + refresh token + user metadata JSON) regularly exceeds
// SecureStore's ~2KB per-value limit.
import * as SecureStore from 'expo-secure-store';
import { createChunkedStorage, type StorageAdapter } from '@homeup/core';

const rawSecureStoreAdapter: StorageAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const authStorageAdapter: StorageAdapter = createChunkedStorage(rawSecureStoreAdapter);
