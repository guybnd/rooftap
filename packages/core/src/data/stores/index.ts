// HOUP-73: barrel for the ~20 per-table Legend-State store singletons moved
// out of apps/web/src/lib/legend/*-store.ts. Each is a thin createGroupStore()
// call — see create-group-store.ts for the shared factory.
export * from './agents-store';
export * from './apartment-agents-store';
export * from './apartment-checklist-store';
export * from './apartment-comments-store';
export * from './apartments-store';
export * from './appointments-store';
export * from './checklist-items-store';
export * from './checklist-template-items-store';
export * from './checklist-templates-store';
export * from './checklists-store';
export * from './cost-items-store';
export * from './documents-store';
export * from './events-store';
export * from './grocery-items-store';
export * from './household-tasks-store';
export * from './loyalty-cards-store';
export * from './meal-plan-store';
export * from './cook-sessions-store';
export * from './recipe-ingredients-store';
export * from './recipes-store';
export * from './saved-searches-store';
export * from './setup-items-store';
export * from './shopper-stores';
export * from './rewards-stores';
export * from './occasions-stores';
export * from './care-jobs-store';
export * from './bins-stores';
export * from './recipe-match-stores';
