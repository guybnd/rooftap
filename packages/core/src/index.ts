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
export * from './geometry';

export * from './modules/checklists/checklists';
export * from './modules/checklists/checklist-view';
export * from './comments';
export * from './modules/costs/costs';
export * from './money-format';
export * from './household-currency';
export * from './currency';
export * from './modules/costs/cost-items';
export * from './modules/costs/cost-reminders';
export * from './modules/groceries/groceries';
export * from './modules/groceries/grocery-icons';
export * from './modules/groceries/grocery-sessions';
export * from './modules/rewards/loyalty-cards';
export * from './modules/recipes/recipes';
export * from './modules/recipes/scan-match';
export * from './modules/recipes/steps';
export * from './modules/recipes/cook';
export * from './modules/recipes/use-cooks';
export * from './modules/meals/meal-plan';
export * from './modules/meals/use-meal-week';
export * from './modules/shopper/shopper';
export * from './modules/shopper/shopper-checks';
export * from './modules/rewards/rewards';
export * from './modules/rewards/rewards-view';
export * from './modules/occasions/occasions';
export * from './modules/bins/bins';
export * from './modules/bins/bins-view';
// new-module:module-exports (scripts/new-module.mjs adds above this line)
export * from './modules/shopper/shopper-sources';
export * from './modules/shopper/shopper-relevance';
export * from './modules/shopper/shopper-scout';
export * from './modules/shopper/shopper-scout-thread';
export * from './modules/shopper/use-scout-thread';
export * from './modules/setup/setup';
export * from './modules/setup/setup-templates';
export * from './modules/setup/setup-list-view';
export * from './modules/setup/use-setup-list';
export * from './modules/setup/setup-item-form';
export * from './sections';
export * from './module-settings';
export * from './connector';
export * from './connectors';
export * from './recent-sections';
export * from './modules';
export * from './modules-store';
export * from './whats-new';
export * from './use-whats-new';
export * from './module-features';
export * from './server-features';
export * from './app-release';
export * from './app-release-store';
export * from './server-update-store';
export * from './task-modules';
export * from './mcp-tools';
export * from './assistant-reach';
export * from './store-modules';
export * from './modules/groceries/item-library';
export * from './modules/groceries/grocery-dismiss';
export * from './modules/groceries/shelf-life-defaults';
export * from './modules/groceries/grocery-list-view';
export * from './modules/groceries/use-grocery-search';
export * from './modules/groceries/use-grocery-aux';
export * from './modules/groceries/use-suggest-dismiss';
export * from './modules/search/scoring';
export * from './region';
export * from './modules/documents/document-fields';
export * from './modules/documents/documents';
export * from './modules/documents/document-storage';
export * from './entitlements';
export * from './modules/assistant/assistant';
export * from './modules/assistant/assistant-mentions';
export * from './ai-keys';
export * from './ai-providers';
export * from './modules/assistant/assistant-prompt';
export * from './modules/assistant/assistant-screen';
export * from './modules/assistant/assistant-links';
export * from './assistant-reply-items';
export * from './modules/assistant/web-lookup';
export * from './modules/assistant/assistant-api';
export * from './modules/assistant/assistant-photos';
export * from './modules/assistant/proposal-picks';
export * from './modules/assistant/use-proposal-picks';
export * from './modules/assistant/feedback';
export * from './modules/assistant/assistant-stream';
export * from './modules/assistant/home-assistant';
export * from './modules/costs/up-bank';
export * from './modules/costs/connectors/up-bank';
export * from './modules/costs/up-overview';
export * from './modules/costs/cost-categories';
export * from './modules/costs/money-insights';
export * from './modules/money-insights/cost-insights';
export * from './modules/money-insights/use-cost-insights';
export * from './modules/money-insights/seen-insights';
export * from './modules/money-insights/money-summary';
export * from './modules/home-care/home-care';
export * from './modules/home-care/use-care-jobs';
export * from './modules/home-care/use-care-picker';
export * from './modules/costs/month-spending';
export * from './modules/costs/cost-row-actions';
export * from './modules/costs/to-sort';
export * from './modules/costs/cost-month';
export * from './modules/costs/cost-month-view';
export * from './modules/costs/use-money-view';
export * from './modules/costs/cost-form';
export * from './modules/costs/cost-dates';
export * from './modules/costs/use-costs-overview';
export * from './modules/costs/recent-spend';
export * from './modules/costs/use-recent-spend';
export * from './modules/documents/document-folders';
export * from './modules/documents/document-list-view';
export * from './modules/documents/use-document-list-view';
export * from './modules/documents/document-explorer';
export * from './modules/calendar/events';
export * from './modules/calendar/event-tickets';
export * from './modules/calendar/event-legs';
export * from './modules/calendar/event-reminders';
export * from './modules/calendar/event-import';
export * from './modules/calendar/event-forecast';
export * from './modules/calendar/event-budget';
export * from './modules/calendar/event-travel';
export * from './modules/calendar/event-duration';
export * from './modules/calendar/calendar-span';
export * from './modules/calendar/calendar-overlap';
export * from './modules/calendar/calendar-sources';
export * from './modules/calendar/calendar-view';
export * from './modules/calendar/calendar-api';
export * from './modules/calendar/event-form';
export * from './modules/household/household-tasks';
export * from './modules/household/task-list-view';
export * from './modules/groceries/grocery-items';
export * from './pending-actions';
export * from './use-pending-actions';
export * from './lease';
export * from './modules/household/moving-tasks';
export * from './modules/calendar/ics';
export * from './modules/calendar/ics-parser';
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
export * from './modules/search/photos';
export * from './modules/search/appointments-view';
export * from './modules/search/use-appointments-view';
export * from './weather-tips';
export * from './home-lens';
export * from './home/hero-modules';
export * from './home/use-weather';
export * from './home/use-hero-module-config';
export * from './home/use-home-data';
export * from './home/home-groceries';
export * from './home/home-tiles';
export * from './widget-snapshot';
export * from './widget-colors';
export * from './data/store-environment';
export * from './data/create-group-store';
export * from './data/write-failures';
export * from './data/use-store-loaded';
export * from './data/strip-symbol-keys';
export * from './data/stores';
export * from './modules/checklists/use-checklist-toggle';
export * from './modules/checklists/use-checklist-item-actions';
export * from './modules/checklists/use-checklist-view-prefs';
export * from './modules/checklists/use-add-checklist-to-task';
export * from './data/use-entity-comments';
export * from './modules/calendar/use-event-save';
export * from './modules/calendar/use-calendar-overlay';
export * from './modules/calendar/use-event-lookups';
export * from './modules/rewards/use-rewards';
export * from './modules/rewards/use-rewards-view';
export * from './modules/occasions/use-occasions';
export * from './modules/occasions/occasions-view';
export * from './modules/occasions/use-occasions-view';
export * from './modules/bins/use-bins';
export * from './modules/bins/use-bins-view';
export * from './modules/bins/slots';
export * from './modules/occasions/slots';
export * from './slots/types';
export * from './slots/calendar';
export * from './slots/home';
export * from './use-user-setting';
// new-module:module-hooks (scripts/new-module.mjs adds above this line)
export * from './modules/recipes/use-recipe-match';
export * from './hooks/use-reply-items';

// hooks/use-debounce + hooks/use-fuzzy-search are deliberately NOT exported
// here: they import React client hooks, and this barrel is also consumed by
// Next.js SERVER code (apps/web route handlers via lib/supabase/admin.ts),
// where a useState import fails the production build. Client consumers import
// them by direct path: '@homeup/core/src/hooks/use-fuzzy-search'.

export * from './tokens';
export * from './tab-glide';
export * from './nav-speed';
export * from './space-rearrange';
export * from './theme-preference';
export * from './dialog-store';
export * from './section-hues';
export * from './modules/assistant/assistant-view';
export * from './modules/assistant/assistant-usage';
export * from './modules/assistant/assistant-telegram';
export * from './modules/assistant/assistant-answers';
export * from './modules/assistant/assistant-popup';
export * from './brand-mark';
export * from './row-actions';
export * from './modules/assistant/assistant-thread';
export * from './modules/assistant/use-composer-photos';
export * from './modules/assistant/use-assistant-screens';
export * from './archive-undo';
export * from './glow-blend';
