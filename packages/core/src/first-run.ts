// First run: the starting sets the tile picker leads with (Hearth §13.12,
// Guy's pick on 2026-11-10). A new owner picks one set in one tap, and the
// full list of switches folds under "Choose myself". Everyday is the
// household defaults (each manifest's `defaultEnabled`); the other sets add
// the modules whose manifest lists them in `startingSets`.
import { withModuleChoice, type ModuleDef, type ModuleId } from './modules';

export type StartingSetId = 'everyday' | 'moving' | 'everything';

export interface StartingSetDef {
  id: StartingSetId;
  label: string;
  /** One line under the set's name. Hearth copy rules apply. */
  description: string;
}

export const STARTING_SETS: readonly StartingSetDef[] = [
  { id: 'everyday', label: 'Everyday', description: 'What most homes use day to day.' },
  { id: 'moving', label: 'Moving house', description: 'Everyday, plus the search and setting up the new place.' },
  { id: 'everything', label: 'Everything', description: "Every tile. Turn off what you don't use." },
];

/**
 * The modules a starting set ticks, among those the server offers: the
 * defaults, plus every offered module that lists the set, plus what those
 * hard-require (withModuleChoice), so a set never asks for a module that
 * would resolve off.
 */
export function startingSetModules(
  id: StartingSetId,
  offered: readonly ModuleDef[],
  defaults: ReadonlySet<ModuleId>
): Set<ModuleId> {
  let chosen: Set<ModuleId> = new Set(defaults);
  if (id !== 'everyday') {
    for (const m of offered) {
      if (m.startingSets?.includes(id)) chosen = withModuleChoice(chosen, m.id, true);
    }
  }
  const offeredIds = new Set(offered.map((m) => m.id));
  return new Set(Array.from(chosen).filter((m) => offeredIds.has(m)));
}

/** Whether two tick sets hold the same modules. */
export function sameModuleSet(a: ReadonlySet<ModuleId>, b: ReadonlySet<ModuleId>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Where "Look around a sample home" goes: the live demo household on the public site. */
export const SAMPLE_HOME_URL = 'https://guybnd.github.io/rooftap/demo/?live=1';

/**
 * The sample home's address, with `back` (where "Start mine" returns to)
 * when the caller has one. The phone opens it in an in-app browser and
 * passes none, since closing the browser is the way back.
 */
export function sampleHomeHref(back?: string | null): string {
  return back ? `${SAMPLE_HOME_URL}&back=${encodeURIComponent(back)}` : SAMPLE_HOME_URL;
}
