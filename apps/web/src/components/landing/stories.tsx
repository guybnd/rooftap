"use client";

import { CameraScreen, ChatScreen, HomeScreen, LockScreen, type ChatLine } from "./cards";
import type { Feature, Mark, PlayEvent, Screen, Slot, Spot, Story, Target } from "./story-player";

// The stories, one module each, told on the module's real screens. Every
// link between modules named here exists in the app (packages/core
// module-features.ts is the registry). The household is an example, written
// like a real one, not anyone's data. The copy states what the feature does.

const m = (scene: Mark["scene"], mark: string): Mark => ({ scene, mark });
/** A spot on a phone: a measured control, or a measured line of text widened to its row. */
const at = (on: Slot, rect: Target, row = false): Spot => ({ on, rect, row });
/** A feature that points at a spot the whole time, lit in its turn. */
const point = (name: string, text: string, target: Spot): Feature => ({ name, text, target });
/** A feature that plays a short timeline. */
const play = (name: string, text: string, events: readonly PlayEvent[]): Feature => ({ name, text, play: events });
/** A feature that only states a fact. */
const fact = (name: string, text: string): Feature => ({ name, text });

const HOME_SCREEN: Screen = { node: <HomeScreen />, label: "The Android home screen with the Rooftap widget: 2 of 2 left today, the weather, and Upcoming by day" };

export const HOME_STORY: Story = {
  id: "home",
  room: "home",
  eyebrow: "Home",
  label: "The Home screen: the day's count, the weather, the next item, and the Upcoming feed that every module fills",
  steps: [
    {
      title: "Full-featured dashboard",
      features: [
        point("Today count.", "Tasks left today, for you and for the household, with a meter.", at("a", m("home", "count"))),
        point("Weather.", "Current conditions from Open-Meteo, the hour the rain starts, and a tip.", at("a", m("home", "weather"))),
        point("Now card.", "The next item due, with its time, its module, and a slide to complete it.", at("a", m("home", "now"))),
        point("Upcoming.", "Every module's dated items in one feed, grouped by day.", at("a", m("home", "upcoming"))),
      ],
      a: "home",
    },
    {
      title: "One feed for every module",
      features: [
        point("Calendar.", "Dentist, 2:30 PM. An event from the household calendar.", at("a", m("home-upcoming", "dentist"))),
        point("Tasks.", "Book the plumber. A task with a due day and a priority.", at("a", m("home-upcoming", "plumber"))),
        point("Documents.", "Renew dishwasher warranty. A reminder from a document's expiry date.", at("a", m("home-upcoming", "warranty"))),
        point("Checklists.", "Hosting Saturday. A dated checklist with its progress, 3 of 9.", at("a", m("home-upcoming", "hosting"))),
      ],
      a: "home-upcoming",
    },
  ],
};

export const CAPTURE_STORY: Story = {
  id: "capture",
  room: "home",
  eyebrow: "Capture",
  label: "Capture: one + opens a sheet for every module; type first, see what already matches, then add it where it belongs or ask Rooftap",
  steps: [
    {
      title: "One + for everything",
      features: [
        play("The roof button.", "Tap the + on any screen. Hold it to go straight to a chat with Rooftap.", [
          { at: 0, show: { a: "home" } },
          { at: 200, highlight: at("a", m("home", "roof")) },
          { at: 900, tap: m("home", "roof") },
          { at: 1300, show: { a: "capture" } },
          { at: 1600, highlight: at("a", m("capture", "field")) },
          { at: 3300, highlight: null },
        ]),
        point("Every module.", "A cost, a scanned document, a grocery, a to-do, an event, a recipe or a checklist, each one tap away.", at("a", m("capture", "grocery"), true)),
        fact("Only your modules.", "A module the household has switched off leaves no tile."),
        point("Chat with Rooftap.", "Questions and multi-step asks go to the Assistant.", at("a", m("capture", "chat"), true)),
      ],
      a: "capture",
    },
    {
      title: "Type first, decide after",
      features: [
        point("It searches as you type.", "What you type matches across every module, shown as each one's own rows.", at("a", m("capture-search", "costRow"), true)),
        point("Already there.", "The insurance renewal is a cost and a reminder task, so nothing gets added twice.", at("a", m("capture-search", "taskRow"), true)),
        play("Add it as.", "Make it a to-do, a grocery or a cost. The form opens with the text filled in.", [
          { at: 0, show: { a: "capture-search" } },
          { at: 200, highlight: at("a", m("capture-search", "todo"), true) },
          { at: 1200, tap: m("capture-search", "todo") },
          { at: 1700, show: { b: "capture-todo" } },
          { at: 1700, pop: "b" },
          { at: 2000, highlight: at("b", m("capture-todo", "task"), true) },
          { at: 3800, highlight: null },
        ]),
        point("Or ask.", "Ask Rooftap sends the same text to the Assistant, which can answer or make the change.", at("a", m("capture-search", "ask"), true)),
      ],
      a: "capture-search",
      b: "capture-todo",
    },
  ],
};

export const GROCERIES_STORY: Story = {
  id: "groceries",
  room: "groceries",
  eyebrow: "Groceries",
  label: "Groceries: aisles or one list, a swipe to get an item, shelf life, the rewards card, and the trip that lands in Costs",
  steps: [
    {
      title: "Intuitive UI",
      features: [
        play("Aisle sort.", "Items group by aisle, in the order you set for your store. One list shows every item in one list.", [
          { at: 300, tap: m("groceries-aisles", "oneList") },
          { at: 700, show: { a: "groceries-flat" } },
          { at: 2600, tap: m("groceries-flat", "aisles") },
          { at: 3000, show: { a: "groceries-aisles" } },
        ]),
        play("Swipe right: got.", "The item moves to the trolley. Swipe left: have, it is in the house. Undo on both.", [
          { at: 300, swipe: m("groceries-aisles", "lemons"), dx: 190 },
          { at: 650, show: { a: "groceries-swipe" } },
          { at: 1200, show: { a: "groceries-got" } },
        ]),
        play("Track the shop.", "After the first got, the list offers to log the trip as one cost.", [
          { at: 200, highlight: at("a", m("groceries-got", "track")) },
          { at: 2400, highlight: null },
        ]),
        fact("Only needed.", "Hides the items marked have. Quantity, unit and note per item."),
      ],
      a: "groceries-aisles",
    },
    {
      title: "Smart grocery recommendations",
      features: [
        play("Shelf life.", "Each item learns how long it lasts in your house from its buy and got dates. The meter shows the days left.", [
          { at: 200, highlight: at("a", m("groceries-aisles", "onions"), true) },
          { at: 2400, highlight: null },
        ]),
        play("Might be running low.", "Items past their shelf life are offered back as chips. Add all puts them on the list in one tap.", [
          { at: 200, highlight: at("a", m("groceries-aisles", "reAdd")) },
          { at: 1600, tap: m("groceries-aisles", "addAll") },
          { at: 2600, highlight: null },
        ]),
        fact("Price memory.", "The last price and the lowest price per item, from what was logged."),
        fact("Essentials.", "Items the house never runs out of are flagged and come back by themselves."),
      ],
      a: "groceries-aisles",
    },
    {
      title: "End-to-end groceries flow",
      features: [
        fact("Running total.", "The items in the trolley and their sum, while you shop."),
        play("Rewards cards.", "Any barcode or QR code, for the household or just you. One tap at the checkout.", [
          { at: 300, tap: m("groceries-shopping", "rewards") },
          { at: 700, show: { a: "groceries-rewards" } },
        ]),
        fact("Receipt scan.", "Photograph the receipt. The total and the store are read from it."),
      ],
      a: "groceries-shopping",
    },
    {
      title: "One-tap cost logging",
      features: [
        play("Done.", "Done confirms the total and the receipt, and writes the trip to Costs as one line with its total and date.", [
          { at: 300, tap: m("groceries-shopping", "done") },
          { at: 900, show: { b: "costs-groceries" } },
          { at: 900, pop: "b" },
          { at: 1200, highlight: at("b", m("costs-groceries", "trip"), true) },
          { at: 3400, highlight: null },
        ]),
        fact("Grocery budget.", "The Groceries category shows each trip against the grocery estimate."),
        fact("Receipt filed.", "The receipt photo is stored in Documents, linked to the cost."),
      ],
      a: "groceries-shopping",
      b: "costs-groceries-before",
    },
  ],
};

export const CALENDAR_STORY: Story = {
  id: "calendar",
  room: "calendar",
  eyebrow: "Calendar",
  label: "Calendar: dated tasks and checklists in the agenda, an event from a link, and the push that says when to leave",
  steps: [
    {
      title: "Centralized agenda",
      features: [
        play("Dated tasks and checklists.", "A task or a checklist with a date is on the calendar. No second entry.", [
          { at: 200, highlight: at("a", m("calendar", "hosting")) },
          { at: 1500, highlight: at("a", m("calendar", "sensor")) },
          { at: 2800, highlight: null },
        ]),
        play("Day and agenda views.", "One calendar for the household, as a day grid or a list.", [
          { at: 200, highlight: at("a", m("calendar", "agenda")) },
          { at: 1800, highlight: null },
        ]),
        fact("Google Calendar.", "Two-way sync. Each person picks which events go to their Google account."),
        fact("Shared or private.", "Set per event."),
      ],
      a: "calendar",
    },
    {
      title: "Smart parsing for event tracking",
      features: [
        play("Fill from a link.", "Paste an event page, a ticket photo or an .ics file. Title, time, place and price are read into the form.", [
          { at: 300, tap: m("calendar-event", "fill") },
        ]),
        play("Save.", "The event lands on the shared calendar.", [
          { at: 300, tap: m("calendar-event", "save") },
          { at: 800, show: { b: "calendar" } },
          { at: 800, pop: "b" },
          { at: 1100, highlight: at("b", m("calendar", "jazz"), true) },
          { at: 3200, highlight: null },
        ]),
        fact("Ticket cost.", "The price becomes a Going out line in Costs."),
        fact("Travel time.", "Computed from your address to the venue and stored on the event."),
      ],
      a: "calendar-event",
      b: "calendar-no-jazz",
    },
    {
      title: "Smart calendar notifications",
      features: [
        play("Leave-by push.", "Sent one hour before the computed leave time, from the travel time and the forecast at the venue.", [{ at: 400, pop: "b" }]),
        fact("Day-before reminder.", "Includes the forecast for the event."),
        fact("On Home too.", "The event waits in Upcoming with the same time."),
        fact("For the household.", "Everyone the event is shared with gets the push."),
      ],
      a: "calendar-event",
      b: { node: <LockScreen time="18:00" title="Leave by 6:30 pm for Jazz at the Lighthouse" body="28 min to Lighthouse Bar. Rain from 7, take an umbrella." />, label: "A lock screen with a push from Rooftap: leave by 6:30 pm for Jazz at the Lighthouse, 28 minutes to Lighthouse Bar, rain from 7" },
    },
  ],
};

const COOKBOOK: Screen = {
  node: <CameraScreen title="Lasagne" lines={["Serves 6 · 20 min prep · 60 min cook", "500 g beef mince, 1 onion, 700 g passata,", "250 g ricotta, 12 lasagne sheets, parmesan, 2 eggs", "Brown the mince with the onion, then add the passata"]} />,
  label: "The camera pointed at a cookbook page for lasagne",
};

export const RECIPES_STORY: Story = {
  id: "recipes",
  room: "recipes",
  eyebrow: "Recipes",
  label: "Recipes: a cookbook page scanned into a recipe, its missing ingredients added to Groceries, a week of dinners, and cook mode with timers",
  steps: [
    {
      title: "Easy recipe management",
      features: [
        play("Can make now.", "A filter for the recipes whose ingredients are all in the house.", [
          { at: 200, highlight: at("b", m("recipes", "canMake")) },
          { at: 1800, highlight: null },
        ]),
        play("Scan a page.", "Point the camera at a cookbook page. Ingredients, servings and times are read into a recipe.", [
          { at: 300, tap: [156, 700, 78, 78] },
          { at: 900, show: { b: "recipe-lasagne" } },
          { at: 900, pop: "b" },
        ]),
        play("Have or need.", "Each ingredient is checked against Groceries. 5 of 7 in the house.", [
          { at: 200, highlight: at("b", m("recipe-lasagne", "have"), true) },
          { at: 2200, highlight: null },
        ]),
        fact("Cuisines and methods.", "Tags for baking, cooking, roasting, Italian, Thai, or your own."),
      ],
      a: COOKBOOK,
      b: "recipes",
    },
    {
      title: "Convert recipes to groceries",
      features: [
        play("Add missing.", "One tap puts the 2 missing ingredients on the grocery list.", [
          { at: 300, tap: m("recipe-lasagne", "addMissing") },
          { at: 800, show: { b: "groceries-recipe" } },
          { at: 800, pop: "b" },
        ]),
        play("In their aisles.", "Ricotta under dairy, sheets under pantry, with the quantity the recipe needs.", [
          { at: 200, highlight: at("b", m("groceries-recipe", "sheets"), true) },
          { at: 1400, highlight: at("b", m("groceries-recipe", "ricotta"), true) },
          { at: 2800, highlight: null },
        ]),
        fact("Recipe chip.", "Each item names the recipe that wants it."),
        fact("After the shop.", "Buy them, and the recipe shows 7 of 7."),
      ],
      a: "recipe-lasagne",
      b: "groceries-no-recipe",
    },
    {
      title: "Plan the week",
      features: [
        play("Seven nights.", "Each night has a recipe and a cook, and shows what is in stock.", [
          { at: 200, highlight: at("a", m("recipes-week", "curry"), true) },
          { at: 2200, highlight: null },
        ]),
        point("Draft my week.", "The Assistant plans the empty nights from your recipes and the food in the house.", at("a", m("recipes-week", "draft"))),
        play("Several dishes.", "A main, a side and a dessert on one night.", [
          { at: 200, highlight: at("a", m("recipes-week", "sat"), true) },
          { at: 2200, highlight: null },
        ]),
        play("Busy evenings.", "A dinner out on the calendar shows as a hint on its night.", [
          { at: 200, highlight: at("a", m("recipes-week", "hint")) },
          { at: 2200, highlight: null },
        ]),
        fact("Missing ingredients.", "The week's missing ingredients go to Groceries in one tap."),
        fact("Tonight on Home.", "Home shows the dinner for tonight."),
      ],
      a: "recipes-week",
    },
    {
      title: "Cook mode",
      features: [
        point("One step at a time.", "The step shows in large text and the screen stays on. Swipe to go to the next step.", at("a", m("cook-lasagne", "step"))),
        point("Timers from the steps.", "A step that says 40 minutes gets a 40 minute timer. On Android the timer shows in the notification bar.", at("a", m("cook-lasagne", "timer"))),
        point("Steps with times.", "Each step shows its times before you start.", at("b", m("recipe-lasagne-steps", "bake"))),
        fact("Several at once.", "Cook more than one recipe. Each keeps its own step and timers, in a small head over every screen."),
        fact("Ask while you cook.", "Ask the Assistant about the step you are on."),
      ],
      a: "cook-lasagne",
      b: "recipe-lasagne-steps",
    },
  ],
};

const chat1: ChatLine[] = [{ from: "you", text: "What can I cook with what we have?" }];
const chat1b: ChatLine[] = [
  ...chat1,
  { from: "assistant", tools: ["homeup · get_grocery_items"], text: "You bought scotch fillet and potatoes yesterday, so steak and potatoes tonight. For the lasagne that you like, you only need lasagne sheets and ricotta." },
];
const chat2: ChatLine[] = [{ from: "you", text: "How is the house?" }];
const chat2b: ChatLine[] = [...chat2, { from: "assistant", tools: ["home-assistant · get_states"], text: "All quiet. The hallway motion sensor battery is at 9 percent. Shall I add batteries to the groceries and a to-do to change them?" }];
const chat2c: ChatLine[] = [...chat2b, { from: "you", text: "Yes" }];
const chat2d: ChatLine[] = [...chat2c, { from: "assistant", tools: ["homeup · create_grocery_item", "homeup · create_task"], text: "Done. AA batteries are on the list, and the task is due on Saturday." }];

const chat = (lines: ChatLine[], label: string, typing = false): Screen => ({ node: <ChatScreen lines={lines} typing={typing} />, label });

export const MCP_STORY: Story = {
  id: "mcp",
  room: "household",
  eyebrow: "Your own agent · MCP",
  label: "AI assistants over MCP: a chat that reads the groceries, and a sensor battery that becomes a grocery item and a to-do",
  steps: [
    {
      title: "Two-way MCP for your agents",
      features: [
        play("Reads your data.", "Rooftap exposes its modules as MCP tools. The assistant called get_grocery_items and answered from the real list and the recipes.", [
          { at: 300, show: { a: chat(chat1, "The assistant is typing", true) } },
          { at: 1700, show: { a: chat(chat1b, "The assistant answers: steak and potatoes tonight, and the lasagne needs only sheets and ricotta") } },
          { at: 2000, highlight: at("b", m("recipes", "lasagne"), true) },
          { at: 4200, highlight: null },
        ]),
        play("Writes back.", "Connect Home Assistant's own MCP server to the same assistant. A low sensor battery becomes a grocery item.", [
          { at: 0, show: { a: chat(chat2, "A chat with an assistant: How is the house?"), b: "groceries-plain" } },
          { at: 600, show: { a: chat(chat2, "The assistant is typing", true) } },
          { at: 1600, show: { a: chat(chat2b, "The assistant: the hallway motion sensor battery is at 9 percent, shall I add batteries and a to-do?") } },
          { at: 2800, show: { a: chat(chat2c, "You answer yes") } },
          { at: 3300, show: { a: chat(chat2c, "The assistant is typing", true) } },
          { at: 4200, show: { a: chat(chat2d, "The assistant: done, AA batteries are on the list and the task is due on Saturday") } },
          { at: 4400, show: { b: "groceries-batteries" } },
          { at: 4400, pop: "b" },
          { at: 4700, highlight: at("b", m("groceries-batteries", "batteries"), true) },
          { at: 6800, highlight: null },
        ]),
        play("Every module.", "The to-do lands in Tasks, due Saturday. Groceries, tasks, calendar events and costs each have tools to read and write.", [
          { at: 300, show: { b: "tasks" } },
          { at: 300, pop: "b" },
          { at: 600, highlight: at("b", m("tasks", "sensor"), true) },
          { at: 3000, highlight: null },
        ]),
        fact("Scoped keys.", "Per key: read-only mode, a tool picker, an expiry. Each row records that the assistant created it."),
      ],
      a: chat(chat1, "A chat with an assistant: What can I cook with what we have?"),
      b: "recipes",
    },
  ],
};

export const SHOPPER_STORY: Story = {
  id: "shopper",
  room: "shopper",
  eyebrow: "Shopper",
  label: "Shopper: a watchlist with a deal rating per item, a price history, every store's price, a plan to buy that lands in Tasks and Costs, and Scout picks for a brief",
  steps: [
    {
      title: "A watchlist with a deal rating",
      features: [
        point("Good now.", "The count of watched items at a good price today, and how many hit your target.", at("a", m("shopper", "good"))),
        play("Deal rating.", "Great at the 90-day low or 15% under the usual price. Good at 5 to 15% under. Fair within 5%. Above usual over that.", [
          { at: 200, highlight: at("a", m("shopper", "airfryer")) },
          { at: 1600, highlight: at("a", m("shopper", "desk")) },
          { at: 3000, highlight: null },
        ]),
        play("Target price.", "Set the price you want to pay. The row says Hit target when a store reaches it.", [
          { at: 200, highlight: at("a", m("shopper", "vacuum")) },
          { at: 1400, tap: m("shopper", "vacuum") },
          { at: 1900, show: { b: "shopper-item" } },
          { at: 1900, pop: "b" },
          { at: 2200, highlight: at("b", m("shopper-item", "verdict")) },
          { at: 4200, highlight: null },
        ]),
        fact("Ideas and bought.", "Keep ideas without a price check. Bought items keep their last price."),
      ],
      a: "shopper",
      b: "shopper-item",
    },
    {
      title: "Price history on your server",
      features: [
        point("Cheapest now.", "The lowest price found, and the store distance when the store is near you.", at("a", m("shopper-item", "hero"))),
        point("Price history.", "One daily low per item, over 30 days, 90 days or a year. The usual range is marked.", at("a", m("shopper-item", "history"))),
        point("Every store.", "Each store's price, cheapest first, with its distance and stock.", at("a", m("shopper-item", "jb"))),
        fact("Daily check.", "A cron job calls the refresh route once a day. It checks each watched item again."),
      ],
      a: "shopper-item",
    },
    {
      title: "Pluggable price sources",
      features: [
        point("Sources by region.", "An AU server ships with Google Shopping via SerpApi, store locations from OpenStreetMap and deals from OzBargain.", at("a", m("shopper-item-buy", "sources"))),
        point("Your own price.", "Add a price you saw in a store. It sits with the others.", at("a", m("shopper-item-buy", "manual"))),
        point("Shared deals.", "Posts from deal sites that match the item.", at("a", m("shopper-item-buy", "deals"))),
        play("Plan to buy.", "One tap writes a to-do in Tasks and a planned cost in Costs, at the cheapest store.", [
          { at: 300, tap: m("shopper-item-buy", "plan") },
          { at: 900, show: { b: "tasks-shopper" } },
          { at: 900, pop: "b" },
          { at: 1200, highlight: at("b", m("tasks-shopper", "buy"), true) },
          { at: 3400, highlight: null },
        ]),
        fact("Add a source.", "A source is a manifest and one server file, or a web service you run. The contributor guide is in the repo."),
      ],
      a: "shopper-item-buy",
      b: "tasks",
    },
    {
      title: "Scout: picks for a brief",
      features: [
        play("A brief.", "Write what you need, a budget and where to look. Scout checks the stores and returns up to three picks.", [
          { at: 200, highlight: at("a", m("shopper-scout-list", "run")) },
          { at: 1200, tap: m("shopper-scout-list", "run") },
          { at: 1700, show: { a: "shopper-scout" } },
          { at: 2000, highlight: at("a", m("shopper-scout", "hero")) },
          { at: 3600, highlight: null },
        ]),
        point("A role per pick.", "Best value, best picture, or a stretch. A pick over the budget shows only with a reason.", at("a", m("shopper-scout", "best"))),
        play("Why it fits.", "Each pick says why it fits the brief, and lists the pages it read.", [
          { at: 200, pop: "b" },
          { at: 400, highlight: at("b", m("shopper-scout-pick", "why"), true) },
          { at: 2600, highlight: null },
        ]),
        play("Watch the price.", "One tap puts the pick on the watchlist, with a daily price check.", [
          { at: 0, show: { b: "shopper-scout-pick" } },
          { at: 300, tap: m("shopper-scout-pick", "watch") },
          { at: 900, show: { b: "shopper-scout-list" } },
          { at: 900, pop: "b" },
          { at: 1200, highlight: at("b", m("shopper-scout-list", "tv")) },
          { at: 3400, highlight: null },
        ]),
        play("Ask, or change the search.", "Ask about the picks and Scout answers from what it found. Raise the budget or add a must-have, and it searches again with the new picks below.", [
          { at: 0, show: { a: "shopper-scout-thread" } },
          { at: 300, highlight: at("a", m("shopper-scout-thread", "answer")) },
          { at: 2400, highlight: at("a", m("shopper-scout-thread", "again")) },
          { at: 3600, highlight: at("a", m("shopper-scout-thread", "grill"), true) },
          { at: 5400, highlight: null },
        ]),
        play("Or ask the Assistant.", "Ask the Assistant to find something. It starts the Scout search for you and links to the picks.", [
          { at: 0, show: { b: "assistant-scout" } },
          { at: 200, pop: "b" },
          { at: 500, highlight: at("b", m("assistant-scout", "open")) },
          { at: 2800, highlight: null },
        ]),
        fact("Your key or Plus.", "Scout runs on the household's own AI key. On the hosted service it uses the Plus allowance. Questions about the picks do not count toward it."),
      ],
      a: "shopper-scout-list",
      b: "shopper-scout-pick",
    },
  ],
};

export const REWARDS_STORY: Story = {
  id: "rewards",
  room: "rewards",
  eyebrow: "Rewards",
  label: "Rewards: loyalty cards and memberships with the stores they work at, a store lookup at the till, the card's barcode, and the perks that end soon",
  steps: [
    {
      title: "Which card works here",
      features: [
        point("Your cards.", "Loyalty cards and memberships as card faces, each with its store count. A card is shared or just yours.", at("a", m("rewards", "flybuys"))),
        play("Store lookup.", "Type the store you are at. The cards that work there come first, best perk first.", [
          { at: 200, highlight: at("a", m("rewards", "search")) },
          { at: 1200, show: { a: "rewards-store" } },
          { at: 1500, highlight: at("a", m("rewards-store", "match")) },
          { at: 3300, highlight: null },
        ]),
        play("At the till.", "One tap shows the card's barcode, with the screen kept awake.", [
          { at: 0, show: { a: "rewards-store" } },
          { at: 300, tap: m("rewards-store", "show") },
          { at: 900, show: { b: "rewards-card" } },
          { at: 900, pop: "b" },
          { at: 1200, highlight: at("b", m("rewards-card", "perk"), true) },
          { at: 3200, highlight: null },
        ]),
        point("Expiry.", "A membership shows when it expires.", at("a", m("rewards", "costco"))),
      ],
      a: "rewards",
      b: "rewards-card",
    },
    {
      title: "Stores and perks per scheme",
      features: [
        point("Many stores per scheme.", "One scheme lists every partner store. Common AU schemes start with their stores. Paste a list from the scheme's website to add more.", at("b", m("rewards-card", "stores"), true)),
        point("Ending soon.", "Perks with an end date in the next 30 days come first.", at("a", m("rewards-perks", "print"), true)),
        point("Every perk.", "A percent, an amount, points or a freebie, for one store or for all of them.", at("a", m("rewards-perks", "bws"), true)),
        fact("In Groceries too.", "The rewards card button in Groceries opens the same cards at the checkout."),
      ],
      a: "rewards-perks",
      b: "rewards-card",
    },
  ],
};

const tg = (lines: ChatLine[], label: string, typing = false): Screen => ({
  node: <ChatScreen lines={lines} typing={typing} name="Wattle St" status="bot" />,
  label,
});
const tg1: ChatLine[] = [{ from: "you", text: "We need dishwasher tablets, and the recycling is full" }];
const tg1b: ChatLine[] = [
  ...tg1,
  { from: "assistant", text: "Two changes wait for your OK:\n• Add \"Dishwasher tablets\" to Groceries\n• Add \"Take out the recycling\" to Tasks", buttons: ["Do all 2", "Not now"] },
];
const tg1c: ChatLine[] = [...tg1b, { from: "assistant", text: "Done. Dishwasher tablets are on the list, and the task is due tonight." }];

export const ASSISTANT_STORY: Story = {
  id: "assistant",
  room: "assistant",
  eyebrow: "Assistant",
  label: "The Assistant: quick asks, named chats and a household thread, changes that wait for an OK, Home Assistant, trust and spending per household, and Telegram",
  steps: [
    {
      title: "A household assistant in the app",
      features: [
        point("Quick asks.", "Ask from the top of the space. A quick ask takes follow-ups for 30 minutes, then closes.", at("a", m("assistant", "quick"))),
        play("Named chats.", "Keep a conversation under a name. Pin it to keep it on top. This one added the lasagne's missing ingredients, wine on a checklist and a task for Noa.", [
          { at: 200, highlight: at("a", m("assistant", "chats")) },
          { at: 1200, tap: m("assistant", "chats") },
          { at: 1700, show: { b: "assistant-hosting" } },
          { at: 1700, pop: "b" },
          { at: 2000, highlight: at("b", m("assistant-hosting", "recipe")) },
          { at: 3600, highlight: null },
        ]),
        play("Household thread.", "One thread for the whole house. Each message shows who wrote it.", [
          { at: 200, highlight: at("a", m("assistant", "household")) },
          { at: 1200, tap: m("assistant", "household") },
          { at: 1700, show: { b: "assistant-household" } },
          { at: 1700, pop: "b" },
        ]),
        point("Waiting on your OK.", "The count of changes that wait for a tap.", at("a", m("assistant", "pending"))),
      ],
      a: "assistant",
      b: "assistant-household",
    },
    {
      title: "Changes wait for your OK",
      features: [
        point("Proposals.", "Under Ask first, each change is one line on a card, with the module it goes to.", at("a", m("assistant-household", "proposal"))),
        play("Do all 2.", "One tap makes both changes. Not now drops them.", [{ at: 300, tap: m("assistant-household", "doAll") }]),
        fact("What it reaches.", "Tasks, the calendar, the budget, groceries, recipes, checklists, Home Setup and Shopper, with the same tools as the MCP server."),
        fact("Memory.", "It keeps short facts about the household. Anyone in the home can read and remove them."),
      ],
      a: "assistant-household",
    },
    {
      title: "Searches and finds",
      features: [
        point("Near me.", "Ask for places near you. The phone sends where you are, and the answer gives each place's distance and hours.", at("a", m("assistant-near-me", "places"))),
        point("Where it looked.", "The answer says where the search started.", at("a", m("assistant-near-me", "from"))),
        fact("Web search.", "It searches the web when the answer is not in the house. The server operator can turn web search off."),
        fact("Photos.", "Send a photo with a message. The Assistant can file a copy in Documents."),
        point("Then it acts.", "The filter goes on the grocery list, under the same trust level as any change.", at("a", m("assistant-near-me", "added"))),
      ],
      a: "assistant-near-me",
    },
    {
      title: "Home Assistant, built in",
      features: [
        play("Connect it.", "Add the Model Context Protocol Server integration in Home Assistant. Paste its URL and a long-lived token in Settings. The server stores the token encrypted.", [
          { at: 200, pop: "b" },
          { at: 400, highlight: at("b", m("assistant-home-assistant", "connected"), true) },
          { at: 2600, highlight: null },
        ]),
        point("Reads the house.", "It sees the devices you expose to Assist in Home Assistant: locks, doors, sensors and their batteries.", at("a", m("assistant-house", "garage"))),
        point("Controls it.", "Lights, covers and climate, with Home Assistant's own tools. Each change is a line marked Home Assistant.", at("a", m("assistant-house", "porch"))),
        point("One trust level.", "Read, Ask first or Act for all of Home Assistant, and a switch per tool.", at("b", m("assistant-home-assistant", "trust"))),
        fact("On your network.", "A self-hosted server reaches Home Assistant on your LAN. The hosted service needs a public https address."),
      ],
      a: "assistant-house",
      b: "assistant-home-assistant",
    },
    {
      title: "Trust, models and spending",
      features: [
        point("Trust per module.", "Read only looks things up. Ask first proposes each change. Act makes the change. A delete always asks.", at("a", m("assistant-settings", "trust"))),
        point("Any model.", "Gemini, OpenAI, Anthropic, OpenRouter, or a local model in Ollama or LM Studio. Quick asks can use a cheaper model.", at("a", m("assistant-settings", "models"))),
        play("Spending.", "A monthly budget for the household and a limit per person. At the limit: warn, switch to the cheaper model, or stop.", [{ at: 300, pop: "b" }]),
        fact("Usage.", "Spend by person, by feature and by model. A local model counts as free."),
      ],
      a: "assistant-settings",
      b: "assistant-spending",
    },
    {
      title: "Telegram, on your own bot",
      features: [
        play("Your bot.", "Make a bot with BotFather and put its token in .env. The telegram profile polls from your server, with no open ports.", [
          { at: 300, show: { b: tg(tg1, "A Telegram chat with the household's bot: we need dishwasher tablets, and the recycling is full") } },
          { at: 300, pop: "b" },
          { at: 900, show: { b: tg(tg1, "The bot is typing", true) } },
          { at: 1900, show: { b: tg(tg1b, "The bot lists two changes that wait for an OK, with Do all 2 and Not now buttons") } },
        ]),
        play("Buttons for changes.", "A change under Ask first arrives with buttons under the reply. One tap makes it.", [
          { at: 0, show: { b: tg(tg1b, "The bot lists two changes that wait for an OK, with Do all 2 and Not now buttons") } },
          { at: 1600, show: { b: tg(tg1c, "The bot: done, dishwasher tablets are on the list and the task is due tonight") } },
        ]),
        play("One history.", "Messages from Telegram are stored on your server like any other. The app shows them, marked Telegram.", [
          { at: 200, highlight: at("a", m("assistant-telegram", "tag")) },
          { at: 1600, highlight: at("a", m("assistant-telegram", "noa"), true) },
          { at: 3200, highlight: null },
        ]),
        fact("Private or in a group.", "Each person links an account with a code. In a group the bot answers when mentioned, in the household thread."),
      ],
      a: "assistant-telegram",
      b: tg(tg1, "A Telegram chat with the household's bot: we need dishwasher tablets, and the recycling is full"),
    },
  ],
};

export const COSTS_STORY: Story = {
  id: "costs",
  room: "costs",
  eyebrow: "Bills and costs",
  label: "Costs: the month against a goal, a bar per month, Worth a look, the categories, and lines from other modules",
  steps: [
    {
      title: "Robust cost tracking",
      features: [
        point("Spent and goal.", "$3,056 of a $4,200 goal this month.", at("a", m("costs", "spent"))),
        point("On track.", "Under goal so far, and where the month ends with what is still to come.", at("a", m("costs", "status"))),
        point("The year in one chart.", "A bar per month, in the colours of the categories.", at("a", m("costs", "chart"))),
        point("Worth a look.", "A category that runs ahead of usual, and plans that end soon, so you can look for a better deal.", at("a", m("costs", "worth"))),
        fact("Paid and to come.", "Each category shows what is paid and what is still to come this month."),
        fact("From other modules.", "Grocery trips, event tickets, checklist purchases, gifts and contracts in Documents write their own cost lines."),
      ],
      a: "costs",
    },
  ],
};

export const DOCUMENTS_STORY: Story = {
  id: "documents",
  room: "documents",
  eyebrow: "Documents",
  label: "Documents: a warranty that adds a dated reminder, and a contract that is a cost and a reminder",
  steps: [
    {
      title: "Smart document storage",
      features: [
        play("Typed forms.", "Warranty, insurance, vehicle and lease, each with its own fields and dates.", [
          { at: 200, highlight: at("a", m("documents", "warranty"), true) },
          { at: 2000, highlight: null },
        ]),
        play("Expiry reminder.", "The warranty's expiry creates a task in Tasks before it runs out.", [
          { at: 300, tap: m("documents", "warranty") },
          { at: 900, show: { b: "tasks" } },
          { at: 900, pop: "b" },
          { at: 1200, highlight: at("b", m("tasks", "warranty"), true) },
          { at: 3400, highlight: null },
        ]),
        fact("Linked both ways.", "The task opens the document. The document shows the task."),
        fact("Folders, tags, search.", "Kitchen, house, car. Found by name or by tag."),
      ],
      a: "documents",
      b: "tasks-plain",
    },
    {
      title: "Expiry dates and costs become reminders",
      features: [
        play("Contract cost.", "The gym contract carries its monthly fee and is a recurring line in Costs.", [
          { at: 200, highlight: at("a", m("documents", "gym"), true) },
          { at: 2200, highlight: null },
        ]),
        play("Renewal task.", "Three weeks before the notice date, a task asks whether to keep it.", [
          { at: 200, pop: "b" },
          { at: 300, highlight: at("b", m("tasks-gym", "gym"), true) },
          { at: 2600, highlight: null },
        ]),
        fact("Receipts arrive.", "Grocery receipts file themselves here."),
        fact("Share into it.", "A PDF or a photo from any app's share sheet goes to Documents."),
      ],
      a: "documents",
      b: "tasks-gym",
    },
  ],
};

export const CHECKLISTS_STORY: Story = {
  id: "checklists",
  room: "checklists",
  eyebrow: "Checklists",
  label: "Checklists: a dated list that becomes a to-do in Tasks, and a shopping list that logs its items in Costs",
  steps: [
    {
      title: "Modular checklists: costs or to-dos",
      features: [
        play("Date on dashboard.", "A dated checklist is a task in Tasks that day, on the calendar and in Upcoming.", [
          { at: 300, tap: m("checklist-hosting", "date") },
          { at: 900, show: { b: "tasks" } },
          { at: 900, pop: "b" },
          { at: 1200, highlight: at("b", m("tasks", "hosting"), true) },
          { at: 3400, highlight: null },
        ]),
        fact("Progress.", "The task shows the list's progress, 3 of 9."),
        fact("Templates and repeats.", "Start from a template. A repeating list resets on its schedule."),
      ],
      a: "checklist-hosting",
      b: "tasks-plain",
    },
    {
      title: "Cost-incurring checklists",
      features: [
        play("Log checked items in Costs.", "With the switch on, each ticked item writes a cost line with its price.", [
          { at: 200, highlight: at("a", m("checklist-hosting", "logCosts"), true) },
          { at: 2200, highlight: null },
        ]),
        play("Tick.", "Wine, $26, logged under the list's category.", [{ at: 300, tap: m("checklist-hosting", "wine") }]),
        fact("Untick.", "Removes the cost line."),
        fact("Shared.", "Every tick syncs to the household."),
      ],
      a: "checklist-hosting",
    },
  ],
};

export const OCCASIONS_STORY: Story = {
  id: "occasions",
  room: "occasions",
  eyebrow: "Occasions",
  label: "Occasions: birthdays and anniversaries with a countdown, gift ideas with a budget, wishlists, and plans kept from the person they are for",
  steps: [
    {
      title: "Birthdays and gifts",
      features: [
        play("Every occasion.", "Birthdays, anniversaries and holidays, each with a date, a person and a countdown. They repeat every year.", [
          { at: 200, highlight: at("a", m("occasions", "mum"), true) },
          { at: 1600, highlight: at("a", m("occasions", "noa"), true) },
          { at: 3000, highlight: null },
        ]),
        point("Gift ideas and a budget.", "$180 of $250 for Mum. Each idea is an idea, watching, bought or booked.", at("a", m("occasions", "budget"))),
        point("Wishlists.", "Each person keeps a wishlist that the household can read. The others take an item from it as a gift idea.", at("a", m("occasions", "wishlist"), true)),
        fact("On the calendar.", "Birthdays show in Calendar as all-day rows."),
      ],
      a: "occasions",
    },
    {
      title: "Keep it a surprise",
      features: [
        point("Kept from Noa.", "Noa does not see the plan, its gift ideas or their price watches. The database hides the rows from Noa's account.", at("a", m("occasions-noa", "kept"))),
        point("Watch the price.", "A gift idea can go on the Shopper watchlist, kept from the same people.", at("a", m("occasions-noa", "watching"), true)),
        fact("In the budget.", "A bought gift writes a Budget line named Gift until the day has passed."),
        fact("With the Assistant.", "Ask the Assistant to add gift ideas. In the household thread it does not mention a surprise."),
      ],
      a: "occasions-noa",
    },
  ],
};

export const HOUSE_STORY: Story = {
  id: "house",
  room: "bins",
  eyebrow: "Around the house",
  label: "Around the house: bin night on Home with whose turn it is, bin days from the council or Home Assistant, and home care jobs on a schedule",
  steps: [
    {
      title: "Bin night",
      features: [
        point("Bins out tonight.", "The night before a collection, Home shows which bins go out. Slide to finish when they are out.", at("a", m("home-bins", "bins"))),
        play("Whose turn.", "The household takes turns. Each collection shows whose turn it is.", [
          { at: 200, highlight: at("b", m("bins", "turn"), true) },
          { at: 2200, highlight: null },
        ]),
        fact("A push at 9 pm.", "If nobody marks the bins out, a push comes at 9 pm."),
        play("Read the days.", "Type the days, read the council calendar from a photo or PDF, or read Home Assistant's Waste Collection Schedule.", [
          { at: 200, show: { b: "bins-setup" } },
          { at: 200, pop: "b" },
          { at: 600, highlight: at("b", m("bins-setup", "ha")) },
          { at: 2600, highlight: null },
        ]),
        fact("On the calendar.", "Collection days show in Calendar."),
      ],
      a: "home-bins",
      b: "bins",
    },
    {
      title: "Home care",
      features: [
        point("Jobs on a schedule.", "Smoke alarms, aircon filters, gutters. Each job repeats on its own schedule and can have a person.", at("a", m("setup-care", "smoke"), true)),
        point("Due soon first.", "The list shows what is overdue and what is due in the next 30 days.", at("a", m("setup-care", "aircon"), true)),
        point("Suggestions.", "Pick from a list of common jobs. Hide the ones your home does not have.", at("a", m("setup-care", "suggestions"))),
        fact("Reminders.", "A reminder comes a few days before each job is due."),
        fact("Seasons.", "A job can come once a year in the month you pick, such as before summer."),
      ],
      a: "setup-care",
    },
  ],
};

export const NATIVE_STORY: Story = {
  id: "native",
  room: "home",
  eyebrow: "Android",
  label: "The Android app: the widget on the home screen, the share sheet, notifications, offline reads and haptics",
  steps: [
    {
      title: "Native app features",
      features: [
        fact("Android widget.", "Upcoming by day on the home screen, with the day's count, the weather, and a tap to add."),
        fact("Share sheet.", "A link or a photo shared from any app goes to the module you pick."),
        fact("Notifications.", "When a task is assigned to you, due, or commented on."),
        fact("Offline.", "Reads work without a connection. Writes sync after."),
        fact("Haptics.", "A pulse on every tick, swipe and commit."),
      ],
      a: HOME_SCREEN,
      b: "home",
    },
  ],
};

/** The first stage: the Home dashboard, under the self-hosting section. */
export const HERO_STORIES: readonly Story[] = [HOME_STORY];
/** The modules, one continuous stage, the Android app last. */
export const ROOM_STORIES: readonly Story[] = [CAPTURE_STORY, GROCERIES_STORY, CALENDAR_STORY, RECIPES_STORY, SHOPPER_STORY, OCCASIONS_STORY, REWARDS_STORY, ASSISTANT_STORY, MCP_STORY, COSTS_STORY, DOCUMENTS_STORY, CHECKLISTS_STORY, HOUSE_STORY, NATIVE_STORY];
