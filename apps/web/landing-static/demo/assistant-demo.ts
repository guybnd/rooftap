// The live demo's Assistant: no model, so a message is matched to one of a
// few household scenarios and gets a written answer. Chats, replies and
// decisions are kept for the visit, and what the Assistant does lands in the
// demo's stores, so the milk it adds shows up in Groceries.
import type { AssistantConversation, AssistantMessage, AssistantScope, ConversationKind, ProposalItem } from "@homeup/core";
import { AVA, NOA, assistantConversations, assistantMessages, assistantStatus, grocery, task } from "./fixtures";
import { demoUpsert } from "./mocks/create-group-store";

const conversations: AssistantConversation[] = assistantConversations.map((c) => ({ ...c }));
const messages: Record<string, AssistantMessage[]> = Object.fromEntries(Object.entries(assistantMessages).map(([id, list]) => [id, list.map((m) => ({ ...m }))]));

let seq = 0;
const nextId = (prefix: string) => `${prefix}-demo-${Date.now()}-${seq++}`;

const message = (role: AssistantMessage["role"], content: string, extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: nextId(role === "user" ? "u" : "a"),
  role,
  content,
  author: role === "user" ? "Ava" : null,
  channel: "app",
  created_at: new Date().toISOString(),
  proposal: null,
  cost_micros: null,
  ...extra,
});

type Item = [tool: string, module: AssistantScope, args: Record<string, unknown>, summary: string];
const items = (list: Item[]): ProposalItem[] => list.map(([tool, module, args, summary]) => ({ tool, module, args, summary }));

interface Answer {
  content: string;
  /** Changes the answer makes or offers. Under Act they are already done; under Ask first they wait. */
  proposal?: { items: ProposalItem[]; state: "pending" | "confirmed" };
  /** Run when the change happens (at once under Act, on OK under Ask first), and what to say after an OK. */
  apply?: () => string;
}

// ── Doing things ────────────────────────────────────────────────────────────

const AISLES: [RegExp, string][] = [
  [/milk|egg|cheese|yog|butter|cream/i, "dairy_eggs"],
  [/bread|bun|roll|bagel/i, "bakery"],
  [/apple|banana|lemon|lime|tomato|onion|potato|spinach|berr|avocado|lettuce|carrot/i, "produce"],
  [/chicken|beef|mince|salmon|fish|steak|bacon/i, "meat_seafood"],
  [/batter|soap|paper|bin bag|detergent|toothpaste|sponge/i, "household"],
  [/juice|coffee|tea|wine|beer|water/i, "drinks"],
];

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function addGroceries(names: string[]) {
  for (const name of names) {
    const aisle = AISLES.find(([re]) => re.test(name))?.[1] ?? "pantry";
    demoUpsert("grocery_items", { ...grocery(nextId("g"), name, aisle), created_at: new Date().toISOString() });
  }
}

function addTask(title: string, assignee: string | null, due: Date) {
  const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
  demoUpsert("household_tasks", { ...task(nextId("t"), title, { due_date: iso, assigned_to: assignee }), created_at: new Date().toISOString() });
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const bold = (names: string[]) => list(names.map((n) => `**${n}**`));

/** "add milk, eggs and bread to the list" → Milk, Eggs, Bread. */
function groceryNames(text: string): string[] {
  const m = /(?:add|need|buy|get|out of)\s+(?:some\s+)?(.+?)(?:\s+(?:to|on)\s+(?:the\s+)?(?:list|groceries|shopping)[^,]*)?[.?!]*$/i.exec(text);
  if (!m) return [];
  return m[1]
    .split(/,|\band\b|&/)
    .map((s) => s.trim().replace(/^(?:some|more|a|an)\s+/i, ""))
    .filter((s) => s && s.length < 30)
    .map(titleCase);
}

// ── Scenarios ───────────────────────────────────────────────────────────────

interface Scenario {
  test: RegExp;
  answer: (text: string) => Answer;
}

const scenarios: Scenario[] = [
  {
    test: /spen[dt]|budget|afford|how much|cost|bills?\b|money/i,
    answer: () => ({
      content:
        "This month the household has spent **$1,312** of **$1,840**. Groceries are at $255 of $640, and the next bill is **Electricity**, $148 on Friday. Home insurance renews today, so it is worth comparing quotes first.",
    }),
  },
  {
    test: /weather|\brain|umbrella|\bcold\b|\bhot\b|sunny/i,
    answer: () => ({ content: "18°C and clear now, with **rain from about two hours on**, 80% likely, for four hours. Bins out at 7 PM falls in it, so take them out early." }),
  },
  {
    test: /remind|task|chore|\bto ?do\b|plumber|\bclean\b|\bfix\b|\bbook\b/i,
    answer: (text) => {
      const who = /\bnoa\b/i.test(text) ? NOA : AVA;
      const whoName = who === NOA ? "Noa" : "you";
      const what = titleCase(
        (/(?:remind \w+ to|to remember to|add a task to|task to|need to)\s+(.+?)(?:\s+(?:on|by|tomorrow|tonight|this|next)\b.*)?[.?!]*$/i.exec(text)?.[1] ?? "Book the plumber").trim()
      );
      const due = new Date();
      due.setDate(due.getDate() + (/tomorrow/i.test(text) ? 1 : 2));
      return {
        content: `I can add **${what}** to Tasks for ${whoName}, due ${/tomorrow/i.test(text) ? "tomorrow" : "in two days"}. Tasks waits for your OK:`,
        proposal: { state: "pending", items: items([["create_task", "household", { title: what }, `Add "${what}" to Tasks`]]) },
        apply: () => (addTask(what, who, due), `Done. **${what}** is in Tasks for ${whoName}.`),
      };
    },
  },
  {
    test: /\b(add|need|buy|out of)\b.*|groceries|shopping list/i,
    answer: (text) => {
      const names = groceryNames(text);
      if (!names.length)
        return {
          content:
            "The list has **13 items**. Milk and Sourdough are essentials, and Ricotta and Lasagne sheets are for Saturday's lasagne. Greek yoghurt and Blueberries are past their shelf life, so they are worth buying again.",
        };
      return {
        content: `Done. ${bold(names)} ${names.length === 1 ? "is" : "are"} on the list.`,
        proposal: { state: "confirmed", items: items(names.map((n) => ["create_grocery_item", "groceries", { name: n }, `Add "${n}" to Groceries`])) },
        apply: () => (addGroceries(names), ""),
      };
    },
  },
  {
    test: /light|lamp|heat|warm|cool|thermostat|temperature|°|degrees|aircon|heater/i,
    answer: (text) => {
      const off = /\boff\b|dim|turn.*off|switch.*off/i.test(text);
      if (/light|lamp/i.test(text))
        return {
          content: off ? "Done. The **lounge** and **kitchen** lights are off. The porch light stays on until 11 PM." : "Done. The **lounge** lights are on at 70%.",
          proposal: { state: "confirmed", items: items([[off ? "ha_HassTurnOff" : "ha_HassTurnOn", "home-assistant", { name: "Lounge lights" }, `Turn ${off ? "off" : "on"} "Lounge lights" in Home Assistant`]]) },
        };
      const deg = Number(/(\d{2})/.exec(text)?.[1] ?? 21);
      return {
        content: `Done. The lounge thermostat is set to **${deg}°C**. It reads 18.5°C now, so give it about 20 minutes.`,
        proposal: { state: "confirmed", items: items([["ha_HassClimateSetTemperature", "home-assistant", { name: "Lounge", temperature: deg }, `Climate set temperature "Lounge" in Home Assistant`]]) },
      };
    },
  },
  {
    test: /lock|door|garage|alarm|window|sensor|home assistant|the house\b/i,
    answer: () => ({
      content: "The front and back doors are **locked** and the alarm is armed. The garage door is **closed**. One thing: the hallway motion sensor battery is at **8%**, and **Replace hallway sensor battery** is already in Tasks for Saturday.",
    }),
  },
  {
    test: /cook|dinner|lunch|recipe|\beat\b|meal/i,
    answer: () => ({
      content: "You can make **Steak and potatoes** with what is in the house. **Green curry** needs only coconut milk, and **Lasagne** is planned for Saturday. Shall I add coconut milk so curry works tomorrow?",
      proposal: { state: "pending", items: items([["create_grocery_item", "groceries", { name: "Coconut milk" }, 'Add "Coconut milk" to Groceries']]) },
      apply: () => (addGroceries(["Coconut milk"]), "Done. **Coconut milk** is on the list, so Green curry works tomorrow."),
    }),
  },
  {
    test: /when|calendar|week|tomorrow|today|tonight|bins?|dentist|saturday|weekend|plans?|schedule|busy/i,
    answer: () => ({
      content:
        "Tonight: **Bins out** at 7 PM (you). Tomorrow: **Dentist** at 2:30 PM, leave by 2 PM. Saturday: **Hosting** at 7 PM for six, and Noa picks up the chairs on Friday. Rain is due from early evening, so bring the bins out before then.",
    }),
  },
];

const HELP: Answer = {
  content:
    "This demo answers a few things the way your Assistant would. Try:\n\n- Add milk and bread to the list\n- What can we cook tonight?\n- Turn off the lights\n- Is the house locked?\n- Remind Noa to clean the gutters tomorrow\n- How much have we spent this month?\n- What's on this week?",
};

function answerFor(text: string): Answer {
  const hit = scenarios.find((s) => s.test.test(text));
  return hit ? hit.answer(text) : HELP;
}

// ── The routes ──────────────────────────────────────────────────────────────

const byRecent = () => [...conversations].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.last_active_at.localeCompare(a.last_active_at));

export function listConversations() {
  return { conversations: byRecent() };
}

export function getConversation(id: string) {
  const conversation = conversations.find((c) => c.id === id) ?? conversations.find((c) => c.kind === "household")!;
  return { conversation, messages: messages[conversation.id] ?? [] };
}

export function updateConversation(id: string, patch: { title?: string; pinned?: boolean; deleted?: boolean }) {
  const i = conversations.findIndex((c) => c.id === id);
  if (i >= 0) {
    if (patch.deleted) conversations.splice(i, 1);
    else conversations[i] = { ...conversations[i], ...(patch.title !== undefined && { title: patch.title }), ...(patch.pinned !== undefined && { pinned: patch.pinned }) };
  }
  return { ok: true };
}

export function chat(input: { text?: string; conversationId?: string | null; kind?: ConversationKind }) {
  const text = (input.text ?? "").trim();
  let conversation = conversations.find((c) => c.id === input.conversationId);
  const now = new Date();
  if (!conversation) {
    const kind = input.kind ?? "quick";
    conversation = {
      id: nextId("conv"),
      kind,
      title: kind === "household" ? null : titleCase(text.replace(/[?.!]+$/, "")).slice(0, 40),
      pinned: false,
      last_active_at: now.toISOString(),
      closes_at: null,
      pending: 0,
    };
    conversations.push(conversation);
    messages[conversation.id] = [];
  }
  const out: AssistantMessage[] = [message("user", text)];
  // The household thread is a chat room: the Assistant answers when someone tags it.
  if (conversation.kind !== "household" || /@rooftap/i.test(text)) {
    const answer = answerFor(text.replace(/@rooftap/gi, ""));
    if (answer.proposal?.state === "confirmed") answer.apply?.();
    const reply = message("assistant", answer.content, { proposal: answer.proposal ?? null, cost_micros: 210 });
    if (answer.proposal?.state === "pending" && answer.apply) applyOnConfirm.set(reply.id, answer.apply);
    out.push(reply);
  }
  messages[conversation.id].push(...out);
  conversation.last_active_at = now.toISOString();
  if (conversation.kind === "quick") conversation.closes_at = new Date(now.getTime() + 30 * 60_000).toISOString();
  conversation.pending = (messages[conversation.id] ?? []).filter((m) => m.proposal?.state === "pending").length;
  assistantStatus.pending = conversations.reduce((n, c) => n + c.pending, 0);
  return { conversation: { ...conversation }, messages: out, budget: "ok" as const };
}

const applyOnConfirm = new Map<string, () => string>();

/** What an OK on a fixture's waiting card says, since those were written ahead. */
const FIXTURE_OUTCOMES: Record<string, () => string> = {
  "m-4": () => "Done. **Plumber** is on the calendar for Thursday at 9 AM, and the **$120** call-out is in the budget under Home.",
};

export function decide(messageId: string, decision: "confirm" | "decline") {
  for (const conversation of conversations) {
    const thread = messages[conversation.id] ?? [];
    const i = thread.findIndex((m) => m.id === messageId);
    if (i < 0 || !thread[i].proposal) continue;
    const updated: AssistantMessage = { ...thread[i], proposal: { ...thread[i].proposal!, state: decision === "confirm" ? "confirmed" : "declined" } };
    thread[i] = updated;
    const said = decision === "confirm" ? (applyOnConfirm.get(messageId) ?? FIXTURE_OUTCOMES[messageId] ?? (() => "Done."))() : "Okay, I left it as it is.";
    applyOnConfirm.delete(messageId);
    const outcome = message("assistant", said || "Done.");
    thread.push(outcome);
    conversation.pending = thread.filter((m) => m.proposal?.state === "pending").length;
    assistantStatus.pending = conversations.reduce((n, c) => n + c.pending, 0);
    return { message: updated, outcome };
  }
  throw new Error("That suggestion is no longer here.");
}
