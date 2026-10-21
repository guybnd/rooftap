// @homeup/core — platform-agnostic shared types, Supabase data layer,
// business logic, and design tokens (HOUP-67). Consumed by apps/web today;
// apps/mobile (Expo) is the reason this boundary exists at all.
//
// Zero react-dom / next/* / browser-global / @/* imports are enforced by
// `npm run lint` (scripts/check-import-boundary.mjs) — see that script for
// the exact rule.

// HOUP-66 scaffold-proof constant — apps/mobile/src/app/index.tsx still
// renders this to prove its Metro config resolves @homeup/core. Out of
// scope for HOUP-67 to touch apps/mobile, so this stays until that scaffold
// screen is replaced with real content.
export const CORE_PACKAGE = "core";

export * from './types';
export * from './supabase';
export * from './native-client';
export * from './server-origin';
export * from './date-utils';

export * from './checklists';
export * from './checklist-view';
export * from './comments';
export * from './costs';
export * from './household-currency';
export * from './currency';
export * from './cost-items';
export * from './cost-reminders';
export * from './groceries';
export * from './grocery-icons';
export * from './grocery-sessions';
export * from './loyalty-cards';
export * from './recipes';
export * from './shopper';
export * from './rewards';
export * from './shopper-sources';
export * from './shopper-relevance';
export * from './shopper-scout';
export * from './setup';
export * from './setup-templates';
export * from './sections';
export * from './recent-sections';
export * from './modules';
export * from './modules-store';
export * from './whats-new';
export * from './use-whats-new';
export * from './module-features';
export * from './server-features';
export * from './task-modules';
export * from './mcp-tools';
export * from './store-modules';
export * from './item-library';
export * from './grocery-dismiss';
export * from './shelf-life-defaults';
export * from './scoring';
export * from './region';
export * from './document-fields';
export * from './documents';
export * from './document-storage';
export * from './entitlements';
export * from './assistant';
export * from './ai-keys';
export * from './ai-providers';
export * from './assistant-prompt';
export * from './assistant-api';
export * from './assistant-stream';
export * from './home-assistant';
export * from './document-folders';
export * from './events';
export * from './event-tickets';
export * from './event-legs';
export * from './event-reminders';
export * from './event-import';
export * from './event-forecast';
export * from './event-budget';
export * from './event-travel';
export * from './event-duration';
export * from './calendar-span';
export * from './calendar-overlap';
export * from './calendar-sources';
export * from './household-tasks';
export * from './grocery-items';
export * from './pending-actions';
export * from './use-pending-actions';
export * from './lease';
export * from './moving-tasks';
export * from './ics';
export * from './ics-parser';
export * from './reminders';
export * from './relative-time';
export * from './pat-expiry';
export * from './key-validation';
export * from './sort';
// pat.ts moved to apps/web/src/lib/pat.ts — it imports Node's crypto
// (server-only), which breaks every native bundle when exported from here.
export * from './auth/identifier';
export * from './data/group-data';
export * from './data/group-admin';
export * from './data/setup-stores';
export * from './hero';
export * from './feed';
export * from './photos';
export * from './weather-tips';
export * from './home-lens';
export * from './widget-snapshot';
export * from './widget-colors';
export * from './data/store-environment';
export * from './data/create-group-store';
export * from './data/use-store-loaded';
export * from './data/strip-symbol-keys';
export * from './data/stores';
export * from './data/use-checklist-toggle';
export * from './data/use-checklist-item-actions';
export * from './data/use-checklist-view-prefs';
export * from './data/use-add-checklist-to-task';
export * from './data/use-entity-comments';
export * from './data/use-event-save';
export * from './data/use-rewards';

// hooks/use-debounce + hooks/use-fuzzy-search are deliberately NOT exported
// here: they import React client hooks, and this barrel is also consumed by
// Next.js SERVER code (apps/web route handlers via lib/supabase/admin.ts),
// where a useState import fails the production build. Client consumers import
// them by direct path: '@homeup/core/src/hooks/use-fuzzy-search'.

export * from './tokens';
export * from './tab-glide';
export * from './space-rearrange';
export * from './theme-preference';
export * from './dialog-store';
export * from './section-hues';
export * from './assistant-view';
export * from './assistant-usage';
export * from './assistant-telegram';
export * from './assistant-answers';
export * from './assistant-popup';
export * from './brand-mark';
export * from './assistant-thread';
