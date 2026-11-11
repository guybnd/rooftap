import type { HouseholdTool, HouseholdToolContext } from "./tool-kit";
import { agendaTools } from "./tools/agenda-tools";
import { bankTools } from "./tools/bank-tools";
import { binsTools } from "./tools/bins-tools";
import { calendarTools } from "./tools/calendar-tools";
import { checklistsTools } from "./tools/checklists-tools";
import { costsTools } from "./tools/costs-tools";
import { documentsTools } from "./tools/documents-tools";
import { groceriesTools } from "./tools/groceries-tools";
import { homeCareTools } from "./tools/home-care-tools";
import { mealsTools } from "./tools/meals-tools";
import { occasionsTools } from "./tools/occasions-tools";
import { recipesTools } from "./tools/recipes-tools";
import { rewardsTools } from "./tools/rewards-tools";
import { searchTools } from "./tools/search-tools";
import { setupTools } from "./tools/setup-tools";
import { shopperTools } from "./tools/shopper-tools";
import { tasksTools } from "./tools/tasks-tools";
// new-module:tool-import (scripts/new-module.mjs adds above this line)

// The household tool handlers behind both the public MCP server (/api/mcp)
// and the in-app assistant, so the two can never drift apart: same inputs,
// same household scoping, same private-item visibility. Each caller decides
// which tools to expose (modules, MCP settings, assistant trust); this module
// only says what the tools are and does the work.
//
// Each tile's tools live in tools/<tile>-tools.ts. They read and write
// household data through tool-data.ts, which applies every table's privacy
// rule, so no handler repeats it by hand.

export type { HouseholdTool, HouseholdToolContext, ToolResult } from "./tool-kit";
export { costCategoryFrom } from "./tools/costs-tools";

export function householdTools(ctx: HouseholdToolContext): HouseholdTool[] {
  return [
    ...costsTools(ctx),
    ...tasksTools(ctx),
    ...calendarTools(ctx),
    ...agendaTools(ctx),
    ...groceriesTools(ctx),
    ...recipesTools(ctx),
    ...mealsTools(ctx),
    ...occasionsTools(ctx),
    ...checklistsTools(ctx),
    ...setupTools(ctx),
    ...shopperTools(ctx),
    ...bankTools(ctx),
    ...rewardsTools(ctx),
    ...binsTools(ctx),
    ...homeCareTools(ctx),
    ...documentsTools(ctx),
    ...searchTools(ctx),
    // new-module:tool-push (scripts/new-module.mjs adds above this line)
  ];
}
