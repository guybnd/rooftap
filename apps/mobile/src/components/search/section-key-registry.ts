// HOUP-147: GlobalHit.section (SectionKey, from packages/core's
// use-global-search-index) is the search domain's own finer-grained key set
// and doesn't map 1:1 onto the section registry's ids. The table itself now
// lives in core (GLOBAL_HIT_SECTION_ID) so web's capture sheet shares it;
// this module keeps the old import path (and its plain-logic unit test,
// apps/mobile's vitest setup being pure-logic-only, see vitest.config.ts).
export { GLOBAL_HIT_SECTION_ID as SECTION_KEY_TO_REGISTRY_ID } from '@homeup/core/src/hooks/use-global-search-index';
