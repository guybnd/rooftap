// The app screens the landing page shows. Each one is a photograph of the
// real page, rendered with a demo household by landing-static/demo and shot
// by scripts/landing-screens.mjs (`npm run landing:screens -w apps/web`).
// Change a page, re-run the script, and the landing page shows the change.

export const SCREEN_IDS = [
  "home",
  "home-upcoming",
  "groceries-aisles",
  "groceries-flat",
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
  "assistant",
  "assistant-household",
  "assistant-telegram",
  "assistant-settings",
  "assistant-spending",
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

/** What a screen reader hears for each frame. */
export const SCREEN_ALT: Record<ScreenId, string> = {
  home: "The Home screen: two of two left today, the weather, the next task and the Upcoming feed",
  "home-upcoming": "The Upcoming feed on Home, with a bill reminder, a chore, a dentist visit, a warranty check, a party and a birthday",
  "groceries-aisles": "The Groceries list sorted by aisle, with two items suggested for re-adding",
  "groceries-flat": "The Groceries list as one plain list",
  "groceries-swipe": "A swipe to the right on Lemons, half way, showing Got it in green",
  "groceries-got": "Lemons marked as got, and the list asking whether to track today's shop",
  "groceries-no-recipe": "The Groceries list before the lasagne's ingredients were added",
  "groceries-recipe": "The Groceries list with lasagne sheets and ricotta added from the Lasagne recipe",
  "groceries-plain": "The Groceries list before the assistant added anything",
  "groceries-track": "Groceries mid-shop, asking whether to track today's shop as a cost",
  "groceries-shopping": "Groceries during a tracked shop, with the running total and a Done shopping button",
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
  assistant: "The Assistant space: one change waiting on your OK, the ask field, the Household thread, two chats and the quick asks",
  "assistant-household": "The household thread: Ava asks to book the plumber, and the assistant proposes a calendar event and a budget line with Do all 2",
  "assistant-telegram": "The household thread from its start: Noa's message and the reply came from Telegram, and the milk and eggs were added",
  "assistant-settings": "Settings for the Assistant: Read, Ask or Act per module, and the models for chats and quick asks",
  "assistant-spending": "Assistant spending: a 5 dollar monthly budget, and a switch to the cheaper model at the limit",
};

/** The frame's address. Relative, so the same markup works at / and on GitHub Pages. */
export const screenSrc = (id: ScreenId) => `landing/screens/${id}.webp`;

/** The frames were shot on a 390 by 844 point phone at 2x. */
export const SCREEN_W = 390;
export const SCREEN_H = 844;
