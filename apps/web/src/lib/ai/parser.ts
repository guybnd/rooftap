import { resolveParsingProvider } from "@/lib/admin-config";
import { runStructuredParse } from "@/lib/ai/providers";

// HOUP-43: parsing now routes through `runStructuredParse`, which resolves
// the owner's selected provider (`resolveParsingProvider`) and translates
// each canonical JSON Schema below into that provider's native structured-
// output mechanism. See `src/lib/ai/providers.ts`.

export interface ParsedAgent {
  name: string;
  phone?: string;
}

export interface ParsedListing {
  address?: string;
  suburb?: string;
  rent_per_week?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: boolean;
  notes?: string;
  image_urls?: string[];
  agent_name?: string;
  agent_phone?: string;
  agents?: ParsedAgent[];
}

const SYSTEM_PROMPT = `You are a real estate listing parser. Given the HTML content of an apartment listing page, extract structured data about the property. Be precise and only include information explicitly stated in the listing. For rent, always convert to weekly amount (if monthly, divide by 4.33; if fortnightly, divide by 2). Return image URLs that show the property (interior/exterior photos), not icons or logos. Extract ALL listing agents/property managers shown — there may be multiple (e.g. listing agent + property manager, or co-agents). Return them in the "agents" array.`;

const LISTING_SCHEMA_NAME = "parsed_listing";

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    address: { type: ["string", "null"], description: "Full street address" },
    suburb: { type: ["string", "null"], description: "Suburb or neighborhood name" },
    rent_per_week: { type: ["number", "null"], description: "Weekly rent in dollars" },
    bedrooms: { type: ["number", "null"], description: "Number of bedrooms" },
    bathrooms: { type: ["number", "null"], description: "Number of bathrooms" },
    parking: { type: ["boolean", "null"], description: "Whether parking is available" },
    notes: { type: ["string", "null"], description: "Key features or description summary (2-3 sentences max)" },
    image_urls: {
      type: "array",
      items: { type: "string" },
      description: "URLs of property photos (not icons/logos). Include up to 10.",
    },
    agent_name: { type: ["string", "null"], description: "Name of the primary listing agent (for backwards compat)" },
    agent_phone: { type: ["string", "null"], description: "Phone number of the primary listing agent (for backwards compat)" },
    agents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Agent or property manager name" },
          phone: { type: ["string", "null"], description: "Agent phone number" },
        },
        required: ["name", "phone"],
        additionalProperties: false,
      },
      description: "All listing agents and property managers shown on the listing",
    },
  },
  required: ["address", "suburb", "rent_per_week", "bedrooms", "bathrooms", "parking", "notes", "image_urls", "agent_name", "agent_phone", "agents"],
  additionalProperties: false,
};

function stripHtmlNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 40_000);
}

export async function parseListingFromHtml(html: string, url: string): Promise<ParsedListing> {
  const provider = await resolveParsingProvider("listing");
  const cleanHtml = stripHtmlNoise(html);

  const parsed = await runStructuredParse(provider, {
    systemPrompt: SYSTEM_PROMPT,
    userText: `Parse this apartment listing from ${url}:\n\n${cleanHtml}`,
    schema: LISTING_SCHEMA,
    schemaName: LISTING_SCHEMA_NAME,
  });

  return extractListingResult(parsed);
}

export async function parseListingFromImages(dataUrls: string[], url?: string): Promise<ParsedListing> {
  const provider = await resolveParsingProvider("listing");

  const parsed = await runStructuredParse(provider, {
    systemPrompt: SYSTEM_PROMPT,
    userText: `Parse this apartment listing${url ? ` from ${url}` : ""} from the screenshot(s):`,
    images: dataUrls,
    schema: LISTING_SCHEMA,
    schemaName: LISTING_SCHEMA_NAME,
  });

  return extractListingResult(parsed);
}

// ── Receipt / invoice parsing (FLUX-82) ───────────────────────────────────────

export interface ParsedReceiptLineItem {
  name: string;
  price?: number;
}

export interface ParsedReceipt {
  retailer?: string;
  purchase_date?: string;   // ISO yyyy-mm-dd
  total?: number;           // dollars
  currency?: string;
  model?: string;
  serial?: string;
  category?: "appliance" | "electronics" | "furniture" | "other";
  line_items?: ParsedReceiptLineItem[];
}

const RECEIPT_SYSTEM_PROMPT = `You are a receipt and invoice parser. Given photo(s) of a purchase receipt or invoice, extract structured data. Only include information explicitly visible. Output the purchase date as ISO format (yyyy-mm-dd). Output the grand total as a number in the receipt's currency (no symbols). If a single main product is identifiable, extract its model and serial number. Classify the main item into one of: appliance, electronics, furniture, other. List the purchased line items with their prices when shown.`;

const RECEIPT_SCHEMA_NAME = "parsed_receipt";

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    retailer: { type: ["string", "null"], description: "Store or vendor name" },
    purchase_date: { type: ["string", "null"], description: "Purchase date, ISO yyyy-mm-dd" },
    total: { type: ["number", "null"], description: "Grand total in the receipt currency, no symbol" },
    currency: { type: ["string", "null"], description: "ISO currency code if shown, e.g. AUD" },
    model: { type: ["string", "null"], description: "Model name/number of the main product" },
    serial: { type: ["string", "null"], description: "Serial number of the main product" },
    category: {
      type: ["string", "null"],
      enum: ["appliance", "electronics", "furniture", "other", null],
      description: "Category of the main item",
    },
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Line item description" },
          price: { type: ["number", "null"], description: "Line item price" },
        },
        required: ["name", "price"],
        additionalProperties: false,
      },
      description: "Purchased line items",
    },
  },
  required: ["retailer", "purchase_date", "total", "currency", "model", "serial", "category", "line_items"],
  additionalProperties: false,
};

export async function parseReceiptFromImages(dataUrls: string[]): Promise<ParsedReceipt> {
  const provider = await resolveParsingProvider("receipt");

  const parsed = await runStructuredParse(provider, {
    systemPrompt: RECEIPT_SYSTEM_PROMPT,
    userText: "Parse this purchase receipt / invoice from the photo(s):",
    images: dataUrls,
    schema: RECEIPT_SCHEMA,
    schemaName: RECEIPT_SCHEMA_NAME,
  });

  const result: ParsedReceipt = {};
  if (parsed.retailer) result.retailer = String(parsed.retailer);
  if (parsed.purchase_date) result.purchase_date = String(parsed.purchase_date);
  if (parsed.total != null) result.total = Number(parsed.total);
  if (parsed.currency) result.currency = String(parsed.currency);
  if (parsed.model) result.model = String(parsed.model);
  if (parsed.serial) result.serial = String(parsed.serial);
  if (
    parsed.category === "appliance" ||
    parsed.category === "electronics" ||
    parsed.category === "furniture" ||
    parsed.category === "other"
  ) {
    result.category = parsed.category;
  }
  if (Array.isArray(parsed.line_items) && parsed.line_items.length > 0) {
    result.line_items = parsed.line_items.map((li) => {
      const item = li as Record<string, unknown>;
      return {
        name: String(item.name ?? ""),
        price: item.price != null ? Number(item.price) : undefined,
      };
    });
  }
  return result;
}

// ── Recipe parsing (FLUX-202) ─────────────────────────────────────────────────

export interface ParsedRecipeIngredient {
  name: string;
  /** FLUX-205: the canonical grocery item this ingredient would be bought as. */
  item: string;
  quantity?: number;
  unit?: string;
}

export interface ParsedRecipe {
  title?: string;
  ingredients?: ParsedRecipeIngredient[];
  steps?: string[];
  servings?: number;
  prep_minutes?: number;
  cook_minutes?: number;
  source?: string;
}

const RECIPE_SYSTEM_PROMPT = `You are a recipe parser. Given photo(s) of a recipe (cookbook page, handwritten card, or screenshot), extract structured data. Put ONLY the recipe's name in "title" — a few words, never ingredients, steps, or commentary. Every ingredient goes in the "ingredients" array as its own object: "name" is the full line as written, including prep/descriptor words (e.g. "thinly sliced blood oranges, peeled"); "item" is the base grocery item you'd actually buy for it, stripped of prep/descriptor words (e.g. "blood oranges" — but keep meaningful qualifiers that change what you'd buy, like "brown sugar" vs "sugar"). When a list of existing household item names is provided, reuse one of them verbatim for "item" ONLY when it genuinely is the item called for — never force a match. Also include optional quantity as a number + optional unit. Every instruction goes in the "steps" array, one string per step — split multi-step paragraphs into separate steps. Extract servings (a number if stated), prep_minutes and cook_minutes (numbers, converting hours to minutes if needed) when visible; omit optional fields you can't determine. Transcribe exactly what's on the page — no invented values. If the image is not a recipe, return an empty title and empty arrays.`;

const RECIPE_SCHEMA_NAME = "parsed_recipe";

// Required + ordered so constrained decoding can't legally stop after
// emitting only `title` (which it did on Gemini — the whole recipe as prose
// in one field). Empty title/arrays remain the "not a recipe" escape hatch.
// Object key order below is load-bearing: the Gemini adapter derives
// `propertyOrdering` from it (see `toGeminiSchema` in providers.ts).
const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        'The recipe\'s name ONLY, a few words (e.g. "Blood Orange Upside-Down Cake"). Never put ingredients, steps, or commentary here.',
    },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Ingredient name, full line as written (with prep/descriptor words)" },
          item: {
            type: "string",
            description:
              'The base grocery item you\'d buy for this ingredient — e.g. "blood oranges" for "thinly sliced blood oranges, peeled". Reuse an existing household item name verbatim when it genuinely matches.',
          },
          quantity: { type: "number", description: "Ingredient quantity" },
          unit: { type: "string", description: "Unit of measurement" },
        },
        required: ["name", "item"],
      },
      description: "Recipe ingredients",
    },
    steps: {
      type: "array",
      items: { type: "string" },
      description: "Ordered instruction steps, one per step",
    },
    servings: { type: "number", description: "Number of servings" },
    prep_minutes: { type: "number", description: "Preparation time in minutes" },
    cook_minutes: { type: "number", description: "Cook time in minutes" },
  },
  required: ["title", "ingredients", "steps"],
};

export async function parseRecipeFromImages(dataUrls: string[], libraryNames: string[] = []): Promise<ParsedRecipe> {
  const provider = await resolveParsingProvider("recipe");

  // FLUX-205 (decision D2): pass the existing item library (grocery items +
  // prior recipe ingredients) so "item" can snap to OUR conventions instead of
  // inventing near-duplicate names. Libraries are realistically dozens to low
  // hundreds of entries — a bounded prompt-size cost worth the quality gain.
  const libraryPrompt = libraryNames.length
    ? `\n\nExisting household item names (for "item" — reuse one of these verbatim when it genuinely is the item called for, otherwise give your own concise canonical name):\n${libraryNames.map((n) => `- ${n}`).join("\n")}`
    : "";

  const parsed = await runStructuredParse(provider, {
    systemPrompt: RECIPE_SYSTEM_PROMPT,
    userText: `Extract the recipe from these photo(s):${libraryPrompt}`,
    images: dataUrls,
    schema: RECIPE_SCHEMA,
    schemaName: RECIPE_SCHEMA_NAME,
  });

  const result: ParsedRecipe = {};
  if (parsed.title) {
    // Degeneration guard: when schema-constrained decoding loops, the junk
    // lands inside this string field (see pinned-model comment in
    // providers.ts). Real titles are short; clamp so a runaway never floods
    // the draft form.
    const title = String(parsed.title).trim();
    result.title = title.length > 120 ? `${title.slice(0, 120).trimEnd()}…` : title;
  }
  if (Array.isArray(parsed.ingredients) && parsed.ingredients.length > 0) {
    result.ingredients = parsed.ingredients
      .filter((i: unknown) => i && typeof i === "object" && String((i as Record<string, unknown>).name ?? "").trim())
      .map((i: unknown) => {
        const item = i as Record<string, unknown>;
        const name = String(item.name).trim();
        // Guard against a missing/empty `item` despite the required schema field
        // (constrained decoding is usually reliable but not guaranteed) by
        // falling back to the descriptor itself as the canonical name.
        const ingredient: ParsedRecipeIngredient = { name, item: String(item.item ?? name).trim() || name };
        if (item.quantity != null && !Number.isNaN(Number(item.quantity))) ingredient.quantity = Number(item.quantity);
        if (item.unit) ingredient.unit = String(item.unit);
        return ingredient;
      });
  }
  if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
    result.steps = parsed.steps
      .map((s: unknown) => String(s).trim())
      .filter((s: string) => s.length > 0);
  }
  if (parsed.servings != null && !Number.isNaN(Number(parsed.servings))) result.servings = Number(parsed.servings);
  if (parsed.prep_minutes != null && !Number.isNaN(Number(parsed.prep_minutes))) result.prep_minutes = Number(parsed.prep_minutes);
  if (parsed.cook_minutes != null && !Number.isNaN(Number(parsed.cook_minutes))) result.cook_minutes = Number(parsed.cook_minutes);
  if (parsed.source) result.source = String(parsed.source);

  return result;
}

function extractListingResult(parsed: Record<string, unknown>): ParsedListing {
  const result: ParsedListing = {};
  if (parsed.address) result.address = String(parsed.address);
  if (parsed.suburb) result.suburb = String(parsed.suburb);
  if (parsed.rent_per_week != null) result.rent_per_week = Number(parsed.rent_per_week);
  if (parsed.bedrooms != null) result.bedrooms = Number(parsed.bedrooms);
  if (parsed.bathrooms != null) result.bathrooms = Number(parsed.bathrooms);
  if (parsed.parking != null) result.parking = Boolean(parsed.parking);
  if (parsed.notes) result.notes = String(parsed.notes);
  if (Array.isArray(parsed.image_urls) && parsed.image_urls.length > 0) {
    result.image_urls = parsed.image_urls.map(String);
  }
  if (parsed.agent_name) result.agent_name = String(parsed.agent_name);
  if (parsed.agent_phone) result.agent_phone = String(parsed.agent_phone);

  if (Array.isArray(parsed.agents) && parsed.agents.length > 0) {
    result.agents = parsed.agents
      .filter((a: unknown) => a && typeof a === "object" && "name" in (a as object))
      .map((a: unknown) => {
        const agent = a as { name: string; phone?: string | null };
        return { name: String(agent.name), phone: agent.phone ? String(agent.phone) : undefined };
      });
  }

  if (!result.agents?.length && result.agent_name) {
    result.agents = [{ name: result.agent_name, phone: result.agent_phone }];
  }

  return result;
}

// ── Event parsing (calendar: fill an event from a link or a ticket) ──────────

const EVENT_SYSTEM_PROMPT = `You read event pages and tickets (concerts, shows, festivals, markets, sports, dinners, parties) and extract the event's details. Only use information that is actually shown. Give dates as yyyy-mm-dd and times as 24-hour HH:MM, both in the local time at the venue, exactly as printed; when the year isn't shown, pick the next occurrence after today's date. Prefer the event's start time over doors when both are shown, and mention doors in notes. Give the venue's name and its street address separately. price_total is what was paid in total on a ticket or order, or the cheapest standard ticket price on an event page; leave it null when no price is shown. category is one of: general, medical, social, household, finance, school, travel, work (concerts, shows, parties and outings are social). notes is at most two short sentences of practical detail (doors, seat or section, booking reference, age limits); no marketing copy.`;

const EVENT_SCHEMA_NAME = "parsed_event";

const EVENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"], description: "Event name, short" },
    start_date: { type: ["string", "null"], description: "yyyy-mm-dd" },
    start_time: { type: ["string", "null"], description: "HH:MM 24h, venue local time" },
    end_date: { type: ["string", "null"], description: "yyyy-mm-dd" },
    end_time: { type: ["string", "null"], description: "HH:MM 24h, venue local time" },
    venue: { type: ["string", "null"], description: "Venue name" },
    address: { type: ["string", "null"], description: "Venue street address" },
    category: { type: ["string", "null"], description: "general|medical|social|household|finance|school|travel|work" },
    price_total: { type: ["number", "null"], description: "Total paid, or the ticket price" },
    currency: { type: ["string", "null"], description: "ISO 4217 code, e.g. AUD" },
    ticket_count: { type: ["number", "null"], description: "Number of tickets on the order" },
    notes: { type: ["string", "null"], description: "Practical details, two short sentences at most" },
  },
  required: [
    "title", "start_date", "start_time", "end_date", "end_time", "venue", "address",
    "category", "price_total", "currency", "ticket_count", "notes",
  ],
  additionalProperties: false,
};

/** Read an event from page text (a link) or from ticket images. Returns the raw answer; callers normalize it with core's normalizeParsedEvent. */
export async function parseEventDetails(
  input: { text: string; url?: string } | { images: string[] },
): Promise<Record<string, unknown>> {
  const provider = await resolveParsingProvider("event");
  const today = new Date().toISOString().slice(0, 10);
  return runStructuredParse(provider, {
    systemPrompt: EVENT_SYSTEM_PROMPT,
    userText:
      "text" in input
        ? `Today is ${today}. Read the event on this page${input.url ? ` (${input.url})` : ""}:\n\n${input.text}`
        : `Today is ${today}. Read the event from this ticket or booking:`,
    images: "images" in input ? input.images : undefined,
    schema: EVENT_SCHEMA,
    schemaName: EVENT_SCHEMA_NAME,
  });
}
