// HOUP-106/HOUP-110: read/write of the widget's `homeup:widget:todaysTasks:v1`
// key.
//
// Uses its OWN SQLiteStorage('HomeUp.db') handle, independent of
// src/lib/legend/environment.ts's StoreEnvironment seam: the widget's
// headless task can fire with the app process cold (WIDGET_UPDATE on the
// updatePeriodMillis timer, WIDGET_CLICK) before expo-router has ever
// mounted _layout.tsx — so configureStoreEnvironment()'s side effect may not
// have run yet, and getStoreEnvironment() would fail-fast. SQLiteStorage
// itself opens synchronously with no such prerequisite, and a second
// instance pointed at the same db name is safe (same underlying db file,
// disjoint key namespace from Legend's own persisted rows).
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import {
  THEME_PREFERENCE_STORAGE_KEY,
  parseThemePreference,
  WIDGET_SNAPSHOT_KEY,
  WIDGET_SNAPSHOT_VERSION,
  type WidgetGrocerySnapshotItem,
  type WidgetSummary,
  type WidgetTaskSnapshotItem,
  type ThemePreference,
  type WidgetTodaySnapshot,
} from '@homeup/core';

const sqliteStorage = new SQLiteStorage('HomeUp.db');

export function readWidgetSnapshot(): WidgetTodaySnapshot | null {
  const raw = sqliteStorage.getItemSync(WIDGET_SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WidgetTodaySnapshot;
    return parsed.version === WIDGET_SNAPSHOT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The theme preference the app mirrors into this same kv-store
 * (lib/theme-context.tsx), so the widget draws in the picked theme. Missing
 * or unreadable means "Match device".
 */
export function readWidgetThemePreference(): ThemePreference {
  try {
    return parseThemePreference(sqliteStorage.getItemSync(THEME_PREFERENCE_STORAGE_KEY));
  } catch {
    return parseThemePreference(null);
  }
}

export function writeWidgetSnapshot(
  items: WidgetTaskSnapshotItem[],
  groceries: WidgetGrocerySnapshotItem[],
  summary: WidgetSummary,
): void {
  const snapshot: WidgetTodaySnapshot = {
    version: WIDGET_SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    items,
    groceries,
    summary,
  };
  sqliteStorage.setItemSync(WIDGET_SNAPSHOT_KEY, JSON.stringify(snapshot));
}
