// Every module's manifest, in registry order: the order of Settings > Modules,
// the first-run picker and every list built from MODULES. Integrations (no
// section of their own) come last (.docs/modules.md, section 3).
//
// Adding a module: write packages/core/src/modules/<id>/manifest.ts and list
// it here. The module-boundary lint fails a module folder that isn't listed.

import type { ModuleManifest } from './module-manifest';
import { householdModule } from './modules/household/manifest';
import { calendarModule } from './modules/calendar/manifest';
import { checklistsModule } from './modules/checklists/manifest';
import { documentsModule } from './modules/documents/manifest';
import { groceriesModule } from './modules/groceries/manifest';
import { recipesModule } from './modules/recipes/manifest';
import { mealsModule } from './modules/meals/manifest';
import { costsModule } from './modules/costs/manifest';
import { setupModule } from './modules/setup/manifest';
import { searchModule } from './modules/search/manifest';
import { shopperModule } from './modules/shopper/manifest';
import { rewardsModule } from './modules/rewards/manifest';
import { occasionsModule } from './modules/occasions/manifest';
import { binsModule } from './modules/bins/manifest';
import { assistantModule } from './modules/assistant/manifest';
import { moneyInsightsModule } from './modules/money-insights/manifest';
import { homeCareModule } from './modules/home-care/manifest';
import { googleCalendarModule } from './modules/google-calendar/manifest';
import { mcpModule } from './modules/mcp/manifest';
// new-module:manifest-import (scripts/new-module.mjs adds above this line)

export const MODULE_MANIFESTS = [
  householdModule,
  calendarModule,
  checklistsModule,
  documentsModule,
  groceriesModule,
  recipesModule,
  mealsModule,
  costsModule,
  setupModule,
  searchModule,
  shopperModule,
  rewardsModule,
  occasionsModule,
  binsModule,
  assistantModule,
  // new-module:manifest (scripts/new-module.mjs adds above this line)
  // Integrations: modules with no section of their own.
  moneyInsightsModule,
  homeCareModule,
  googleCalendarModule,
  mcpModule,
] as const;

/** The same list, typed as plain manifests, for registries that read optional fields. */
export const ALL_MANIFESTS: readonly ModuleManifest[] = MODULE_MANIFESTS;
