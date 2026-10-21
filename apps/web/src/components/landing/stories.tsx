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

export const GROCERIES_STORY: Story = {
  id: "groceries",
  room: "groceries",
  eyebrow: "Groceries",
  label: "Groceries: aisles or one list, a swipe to get an item, shelf life, the rewards card, and the trip that lands in Costs",
  steps: [
    {
      title: "Intuitive UI",
      features: [
        play("Aisle sort.", "Items group by aisle, in the order you set for your store. One list is one tap away.", [
          { at: 300, tap: m("groceries-aisles", "oneList") },
          { at: 700, show: { a: "groceries-flat" } },
          { at: 2400, tap: m("groceries-flat", "byAisle") },
          { at: 2800, show: { a: "groceries-aisles" } },
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
        play("Shelf life.", "Each item learns how long it lasts in your house from its buy and got dates.", [
          { at: 200, highlight: at("a", m("groceries-aisles", "needSoon")) },
          { at: 2400, highlight: null },
        ]),
        play("Re-add suggestions.", "Items past their shelf life are offered back as chips. Add all 2 in one tap.", [
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
        play("Rewards cards.", "Any barcode or QR code, stored per household. One tap at the checkout, full brightness.", [
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
        play("Done shopping.", "One tap writes the trip to Costs with the store, the date and the total.", [
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
  label: "Recipes: a cookbook page scanned into a recipe, then its missing ingredients added to Groceries",
  steps: [
    {
      title: "Easy recipe management",
      features: [
        play("Can make now.", "A filter for the recipes whose ingredients are all in the house.", [
          { at: 200, highlight: { ...at("b", m("recipes", "canMake")), pad: 8 } },
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
  label: "Shopper: a watchlist with a deal rating per item, a price history, every store's price, and a plan to buy that lands in Tasks and Costs",
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
        fact("Scout, in progress.", "Describe what you need and a budget. Scout returns three picks with the reason for each."),
      ],
      a: "shopper-item-buy",
      b: "tasks",
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
  label: "The Assistant: quick asks, named chats and a household thread, changes that wait for an OK, trust and spending per household, and Telegram",
  steps: [
    {
      title: "A household assistant in the app",
      features: [
        point("Quick asks.", "Ask from the top of the space. A quick ask takes follow-ups for 30 minutes, then closes.", at("a", m("assistant", "quick"))),
        point("Named chats.", "Keep a conversation under a name. Pin it to keep it on top.", at("a", m("assistant", "chats"))),
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
        fact("What it reaches.", "Tasks, the calendar, the budget and the grocery list, with the same tools as the MCP server."),
        fact("Memory.", "It keeps short facts about the household. Anyone in the home can read and remove them."),
      ],
      a: "assistant-household",
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
  label: "Costs: the year and the month in one chart, grocery trips imported from Groceries, and costs from other modules",
  steps: [
    {
      title: "Robust cost tracking",
      features: [
        play("Plan and actual.", "$2,801 of $4,200 planned this month, against a budget you set.", [
          { at: 200, highlight: at("a", m("costs", "planned")) },
          { at: 2200, highlight: null },
        ]),
        play("The year in one chart.", "A bar per month. Past months actual, future months projected from the recurring items.", [
          { at: 200, highlight: at("a", m("costs", "chart")) },
          { at: 2200, highlight: null },
        ]),
        play("Recurring items.", "Rent, utilities, subscriptions, each with an amount and a cadence.", [
          { at: 200, highlight: at("a", m("costs", "recurring")) },
          { at: 2200, highlight: null },
        ]),
        fact("Who pays.", "Each cost splits between the people in the house."),
        fact("From other modules.", "Grocery trips, event tickets, checklist purchases and contracts in Documents write their own cost lines."),
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
export const ROOM_STORIES: readonly Story[] = [GROCERIES_STORY, CALENDAR_STORY, RECIPES_STORY, SHOPPER_STORY, ASSISTANT_STORY, MCP_STORY, COSTS_STORY, DOCUMENTS_STORY, CHECKLISTS_STORY, NATIVE_STORY];
