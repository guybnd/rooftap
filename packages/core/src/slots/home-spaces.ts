// Home's Spaces slot (.docs/modules.md, section 17): the cards and tiles
// under the feed. Each module lists its Spaces in its manifest; each app
// draws a Space with the component its home-spaces registry keeps under the
// Space's key. Home loops over the list, so a module's Space shows without
// an edit to either Home screen.

import { MODULE_MANIFESTS } from '../module-manifests';
import type { ManifestSpace } from '../module-manifest';
import type { HomeLensKey } from '../home-lens';

/** A Space and the module it belongs to. */
export interface HomeSpace extends ManifestSpace {
  moduleId: string;
}

type Manifest = (typeof MODULE_MANIFESTS)[number];
type SpacesOf<M> = M extends { spaces: readonly (infer S)[] } ? S : never;

/** Every Space's key, so each app's registry must draw them all. */
export type HomeSpaceKey = SpacesOf<Manifest> extends { key: infer K } ? K & string : never;

/** Every Space, in module registry order, then the order each manifest lists them. */
export const HOME_SPACES: readonly HomeSpace[] = MODULE_MANIFESTS.flatMap((m) =>
  ((m as { spaces?: readonly ManifestSpace[] }).spaces ?? []).map((space) => ({ ...space, moduleId: m.id })),
);

export interface HomeSpaceState {
  space: HomeSpace & { key: HomeSpaceKey };
  /** On screen now: on the dashboard, or the Space the shortcut filters Home to. */
  shown: boolean;
  /** Filtered to its shortcut, it shows everything. */
  expanded: boolean;
}

/**
 * The Spaces whose module is on and not hidden, each with whether it shows
 * now. Filtered to a shortcut, only that Space shows, expanded; otherwise
 * each Space shows unless the person turned its setting off.
 */
export function homeSpaces(input: {
  hidden: readonly string[];
  /** The Customize sheet switch (isModuleShown). */
  settingOn: (key: string) => boolean;
  lens: HomeLensKey | null;
}): HomeSpaceState[] {
  return HOME_SPACES.filter((space) => !input.hidden.includes(space.moduleId)).map((space) => {
    const expanded = !!input.lens && space.lens === input.lens;
    const shown = input.lens ? expanded : !space.setting || input.settingOn(space.setting);
    return { space: space as HomeSpace & { key: HomeSpaceKey }, shown, expanded };
  });
}
