// The app screens the landing page shows. Each one is a photograph of the
// real page, rendered with a demo household by landing-static/demo and shot
// by scripts/landing-screens.mjs (`npm run landing:screens -w apps/web`).
// Change a page, re-run the script, and the landing page shows the change.

export const SCREEN_IDS = [
  "home",
  "home-upcoming",
  "capture",
  "capture-search",
  "capture-todo",
  "groceries-aisles",
  "groceries-flat",
  "groceries-aisles-menu",
  "groceries-flat-menu",
  "groceries-swipe",
  "groceries-got",
  "groceries-no-recipe",
  "groceries-recipe",
  "groceries-plain",
  "groceries-track",
  "groceries-shopping",
  "groceries-rewards",
  "groceries-batteries",
  "calendar",
  "calendar-no-jazz",
  "calendar-event",
  "recipes",
  "recipe-lasagne",
  "recipe-lasagne-steps",
  "costs",
  "costs-groceries",
  "costs-groceries-before",
  "documents",
  "checklists",
  "checklist-hosting",
  "tasks",
  "tasks-gym",
  "tasks-plain",
  "tasks-shopper",
  "shopper",
  "shopper-item",
  "shopper-item-buy",
  "shopper-scout-list",
  "shopper-scout",
  "shopper-scout-pick",
  "rewards",
  "rewards-store",
  "rewards-card",
  "rewards-perks",
  "assistant",
  "assistant-household",
  "assistant-telegram",
  "assistant-house",
  "assistant-hosting",
  "assistant-home-assistant",
  "assistant-settings",
  "assistant-spending",
  "readme-event-ticket",
  "map-costs-suggest",
  "map-calendar-sunday",
  "map-appointments",
  "map-documents-receipts",
  "map-documents-recipe",
  "map-setup-doc",
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

/** What a screen reader hears for each frame. */
export const SCREEN_ALT: Record<ScreenId, string> = {
  home: "The Home screen: two of two left today, the weather, the next task and the Upcoming feed",
  "home-upcoming": "The Upcoming feed on Home, with a bill reminder, a chore, a dentist visit, a warranty check, a party and a birthday",
  capture: "The Add sheet over Home: a field to add or ask anything, Chat with Rooftap, and a tile for each module",
  "capture-search": "The Add sheet with insurance typed: Ask Rooftap, add it as a to-do, grocery or cost, and the matching cost and task",
  "capture-todo": "Add to-do with the task Compare insurance quotes filled in from the Add sheet, due today",
  "groceries-aisles": "The Groceries list sorted by aisle, with two items that might be running low",
  "groceries-flat": "The Groceries list as one plain list",
  "groceries-aisles-menu": "The Groceries View menu open on By aisle, with One list and Only needed",
  "groceries-flat-menu": "The Groceries View menu open on One list, with By aisle and Only needed",
  "groceries-swipe": "A swipe to the right on Lemons, half way, showing Got it in green",
  "groceries-got": "Lemons marked as got, and the list asking whether to track today's shop",
  "groceries-no-recipe": "The Groceries list before the lasagne's ingredients were added",
  "groceries-recipe": "The Groceries list with lasagne sheets and ricotta added from the Lasagne recipe",
  "groceries-plain": "The Groceries list before the assistant added anything",
  "groceries-track": "Groceries mid-shop, asking whether to track today's shop as a cost",
  "groceries-shopping": "Groceries during a tracked shop, with the running total, a Receipt button and a Done button",
  "groceries-rewards": "A Flybuys rewards card shown as a barcode over the Groceries list",
  "groceries-batteries": "The Groceries list with AA batteries added for the hallway motion sensor",
  calendar: "The household calendar on Saturday, with the party, the sensor battery and the jazz night",
  "calendar-no-jazz": "The household calendar on Saturday, before the jazz night was added",
  "calendar-event": "The event form, filled from a link, with the title Jazz at the Lighthouse",
  recipes: "The Recipes list, with one recipe that can be made now",
  "recipe-lasagne": "The Lasagne recipe, with five of seven ingredients in the house and a button to add the two missing",
  "recipe-lasagne-steps": "The Lasagne recipe's ingredients and numbered instructions",
  costs: "Costs and Budget: 2,801 dollars of 4,200 planned, with a chart of the year",
  "costs-groceries": "The Groceries category in Costs, with four shopping trips logged at their real totals",
  "costs-groceries-before": "The Groceries category in Costs, before today's trip",
  documents: "The Documents screen, with a dishwasher warranty, a gym contract and an insurance policy expiring soon",
  checklists: "The Checklists screen",
  "checklist-hosting": "The Hosting Saturday checklist: a dated shopping list that logs its items in Costs",
  tasks: "The Tasks screen, with this week's chores and reminders from other rooms",
  "tasks-gym": "The Tasks screen scrolled to the gym contract's renewal task, three weeks before its notice date",
  "tasks-plain": "The Tasks screen with only the chores people wrote: bins, plants and the plumber",
  "tasks-shopper": "The Tasks screen with a to-do from Shopper: buy the Roborock Q7 robot vacuum at JB Hi-Fi on Saturday",
  shopper: "Shopper: two items at a good price now, four watched, each with its deal word, usual price and trend",
  "shopper-item": "The Roborock Q7 robot vacuum in Shopper: 449 dollars at JB Hi-Fi, hit target, 31 percent under usual, with 90 days of price history",
  "shopper-item-buy": "Where to buy the robot vacuum: five stores by price, the sources, a deal shared on OzBargain, and the Plan to buy button",
  "shopper-scout-list": "The Shopper screen scrolled to its Scout runs: a TV for the lounge, three picks",
  "shopper-scout": "A Scout run for a lounge TV under 2,000 dollars: 14 stores checked, three picks with their role, store, stock and price",
  "shopper-scout-pick": "The best value pick: a Hisense 65 inch TV at JB Hi-Fi for 1,495 dollars, why it fits, its sources, and Watch the price",
  rewards: "Rewards: four cards as card faces, Costco, Everyday Rewards, Flybuys and IKEA Family, that work at 12 stores, with a store search on top",
  "rewards-store": "Rewards looked up for Officeworks: Flybuys works there with 10 percent off, and a Show Flybuys card button",
  "rewards-card": "The Flybuys card: its barcode and number, its perks at Officeworks and Kmart, and its 6 stores",
  "rewards-perks": "The Perks tab: 9 perks, 4 ending this month, starting with 10 percent off print and copy at Officeworks",
  assistant: "The Assistant space: one change waiting on your OK, the ask field, the Household thread, four chats and two open quick asks",
  "assistant-household": "The household thread: Ava asks to book the plumber, and the assistant proposes a calendar event and a budget line with Do all 2",
  "assistant-telegram": "The household thread from its start: Noa's message and the reply came from Telegram, and the milk and eggs were added",
  "assistant-house": "A chat that used Home Assistant: the garage door closed, the porch light on and the lounge set to 21 degrees, each marked Done",
  "assistant-hosting": "A chat that planned Saturday: the lasagne's missing ingredients added to Groceries, wine added to a checklist, and a task for Noa",
  "assistant-home-assistant": "Settings for Home Assistant: connected with a token, the trust level for all of Home Assistant, and a switch per tool",
  "assistant-settings": "Settings for the Assistant: Read, Ask or Act per module, and the models for chats and quick asks",
  "assistant-spending": "Assistant spending: a 5 dollar monthly budget, and a switch to the cheaper model at the limit",
  "readme-event-ticket": "The Jazz night's event: 56 dollars kept in the Budget as Going out, and its ticket from the document store",
  "map-costs-suggest": "Costs suggests two lines from other modules: rent of 820 dollars a week from the chosen home, and 4,350 dollars of Home Setup purchases",
  "map-calendar-sunday": "Sunday on the calendar: a chore, Mia's birthday from Google Calendar, and two viewings from Home Search",
  "map-appointments": "Home Search viewings with a suggestion from Google Calendar: Inspection 12 Separation St, to import as an appointment",
  "map-documents-receipts": "Receipts in Documents: the FreshCo receipt linked to Groceries and Costs, and the fridge receipt linked to Home Setup",
  "map-documents-recipe": "The lasagne recipe photo in Documents, linked to its recipe",
  "map-setup-doc": "Home Setup: the fridge, bought for 1,090 dollars, with a Doc chip for its receipt",
};

/** The frame's address. Relative, so the same markup works at / and on GitHub Pages. */
export const screenSrc = (id: ScreenId) => `landing/screens/${id}.webp`;

/** The frames were shot on a 390 by 844 point phone at 2x. */
export const SCREEN_W = 390;
export const SCREEN_H = 844;

/**
 * A measured mark (screen-marks.json): the painted bounds of what it marks, then
 * the room a ring may take on each side (left, top, right, bottom) before it
 * would touch other text or icons. Older marks carry no room.
 */
export type MarkRect = readonly [number, number, number, number, number?, number?, number?, number?];

/** The most room a ring takes around what it rings, in screen points. */
export const RING_PAD = 12;

/**
 * Where the ring around a mark goes: grown by its room on each side (RING_PAD
 * where nothing is near), plus `extra` points, and kept on the screen.
 */
export function ringAround(r: MarkRect, extra = 0): [number, number, number, number] {
  const [x, y, w, h, pl = RING_PAD, pt = RING_PAD, pr = RING_PAD, pb = RING_PAD] = r;
  const l = Math.max(3, x - pl - extra);
  const t = Math.max(3, y - pt - extra);
  const right = Math.min(SCREEN_W - 3, x + w + pr + extra);
  const b = Math.min(SCREEN_H - 3, y + h + pb + extra);
  return [l, t, right - l, b - t];
}

// The wide layout, shot at 1440 x 900 (`npm run landing:screens -w apps/web -- --desktop`).
export const DESKTOP_SCREEN_IDS = ["home", "groceries-aisles", "costs", "tasks"] as const;
export type DesktopScreenId = (typeof DESKTOP_SCREEN_IDS)[number];
export const DESKTOP_W = 1440;
export const DESKTOP_H = 900;
export const DESKTOP_ALT: Record<DesktopScreenId, string> = {
  home: "Home on a wide screen: today, the weather chart and the week board on the left, Groceries, Budget and Bills on the right",
  "groceries-aisles": "Groceries on a wide screen: the aisles in two columns, with Running low and This trip beside them",
  costs: "Costs on a wide screen: the year chart and the month on the left, the costs by category on the right",
  tasks: "Tasks on a wide screen: this week and later in two columns",
};
export const desktopScreenSrc = (id: DesktopScreenId) => `landing/screens/desktop-${id}.webp`;
