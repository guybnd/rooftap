import type { GroceryAisle } from '../../types';
import { GROCERY_GLYPH_SVGS } from './grocery-glyph-svgs';

/** Aisle fallback emoji — shown when no item-level match is found. */
export const AISLE_EMOJI: Record<GroceryAisle, string> = {
  produce:      "🥦",
  dairy_eggs:   "🥛",
  meat_seafood: "🥩",
  bakery:       "🍞",
  pantry:       "🫙",
  frozen:       "🧊",
  drinks:       "🥤",
  household:    "🧹",
  other:        "🛒",
};

// keyword → emoji. First match wins; entries are checked in order.
const KEYWORD_MAP: [string[], string][] = [
  // ── Produce ──────────────────────────────────────────────────────────────────
  [["apple", "apples", "granny smith", "fuji", "pink lady"], "🍎"],
  [["banana", "bananas"], "🍌"],
  [["orange", "oranges", "mandarin", "clementine", "tangerine"], "🍊"],
  [["lemon", "lemons"], "🍋"],
  [["lime", "limes"], "🍋"],
  [["strawberr"], "🍓"],
  [["blueberr", "raspberr", "blackberr", "mixed berr", "berry", "berries"], "🫐"],
  [["grapefruit"], "🍊"],
  [["grape", "grapes"], "🍇"],
  [["watermelon"], "🍉"],
  [["rockmelon", "cantaloupe", "honeydew", "melon"], "🍈"],
  [["pineapple"], "🍍"],
  [["mango", "mangoes", "mangos"], "🥭"],
  [["peach", "peaches", "nectarine"], "🍑"],
  [["cherr"], "🍒"],
  [["plum"], "🍑"],
  [["pear"], "🍐"],
  [["kiwi"], "🥝"],
  [["avocado"], "🥑"],
  [["broccoli"], "🥦"],
  [["carrot", "carrots"], "🥕"],
  [["cucumber", "zucchini", "courgette"], "🥒"],
  [["corn", "sweet corn"], "🌽"],
  [["chilli", "chili", "jalapeño", "capsicum", "bell pepper", "pepper"], "🫑"],
  [["eggplant", "aubergine"], "🍆"],
  [["tomato", "tomatoes"], "🍅"],
  [["mushroom"], "🍄"],
  [["garlic"], "🧄"],
  [["onion", "onions", "shallot", "leek", "spring onion", "scallion"], "🧅"],
  [["potato", "potatoes", "spud", "baby potato"], "🥔"],
  [["sweet potato", "kumara"], "🍠"],
  [["coconut"], "🥥"],
  [["lettuce", "spinach", "kale", "rocket", "arugula", "bok choy", "silverbeet", "greens", "salad leaves"], "🥬"],
  [["peas", "snow peas", "sugar snap"], "🫛"],
  [["beans", "edamame"], "🫘"],
  [["asparagus", "broccolini"], "🌿"],
  [["celery"], "🥬"],
  [["fennel", "cabbage", "cauliflower", "brussel", "brussels"], "🥦"],
  [["beetroot", "beet"], "🥬"],
  [["pumpkin", "squash", "butternut"], "🎃"],
  [["ginger"], "🫚"],
  [["fresh herb", "coriander", "parsley", "mint", "dill", "chives"], "🌿"],
  [["fruit"], "🍑"],
  [["veget", "veg", "salad"], "🥗"],
  // ── Dairy & Eggs ─────────────────────────────────────────────────────────────
  [["milk", "almond milk", "oat milk", "soy milk", "plant milk", "lactose"], "🥛"],
  [["egg", "eggs"], "🥚"],
  [["cheese", "cheddar", "brie", "feta", "parmesan", "ricotta", "mozzarella", "gouda", "halloumi"], "🧀"],
  [["butter"], "🧈"],
  [["margarine"], "🧈"],
  [["yogurt", "yoghurt", "yoghurt", "greek yogurt"], "🥛"],
  [["cream", "sour cream", "crème fraîche", "fraiche"], "🍦"],
  [["custard"], "🍮"],
  [["ice cream", "gelato", "sorbet"], "🍦"],
  // ── Meat & Seafood ───────────────────────────────────────────────────────────
  [["chicken", "poultry", "turkey", "duck"], "🍗"],
  [["bacon", "pancetta", "prosciutto", "ham", "salami"], "🥓"],
  [["sausage", "frankfurt", "banger", "chorizo"], "🌭"],
  [["beef", "steak", "mince", "ground beef", "brisket", "lamb", "pork", "veal", "meat"], "🥩"],
  [["fish", "cod", "barramundi", "snapper", "basa", "tilapia"], "🐟"],
  [["salmon", "trout"], "🐟"],
  [["tuna", "sardine", "anchov"], "🐟"],
  [["prawn", "shrimp"], "🦐"],
  [["crab", "lobster", "crayfish"], "🦀"],
  [["mussel", "scallop", "oyster", "clam", "squid", "calamari"], "🦞"],
  [["tofu", "tempeh"], "🧈"],
  // ── Bakery ───────────────────────────────────────────────────────────────────
  [["sourdough", "bread", "loaf", "toast", "sandwich bread", "white bread", "wholemeal"], "🍞"],
  [["baguette", "french stick"], "🥖"],
  [["croissant", "danish"], "🥐"],
  [["bagel"], "🥯"],
  [["muffin", "cupcake"], "🧁"],
  [["cake"], "🎂"],
  [["cookie", "biscuit", "cracker"], "🍪"],
  [["donut", "doughnut"], "🍩"],
  [["pita", "wrap", "tortilla", "flatbread", "naan"], "🫓"],
  [["crumpet", "pikelet"], "🥞"],
  // ── Pantry ───────────────────────────────────────────────────────────────────
  [["pasta", "spaghetti", "penne", "fettuccine", "linguine", "rigatoni", "lasagne", "noodle", "noodles", "ramen"], "🍝"],
  [["rice", "jasmine rice", "basmati", "brown rice"], "🍚"],
  [["couscous"], "🍚"],
  [["quinoa"], "🌾"],
  [["weet-bix", "weetbix", "wheat bisc"], "🥣"],
  [["oat", "oatmeal", "porridge", "muesli", "granola", "cereal"], "🥣"],
  [["flour", "bread flour", "plain flour", "self-raising"], "🌾"],
  [["sugar", "brown sugar", "icing sugar", "caster sugar"], "🍬"],
  [["salt", "pepper", "spice", "seasoning", "paprika", "cumin", "turmeric", "cinnamon", "herb", "oregano", "basil", "thyme", "rosemary", "bay leaf"], "🧂"],
  [["olive oil", "oil", "vegetable oil", "coconut oil", "canola"], "🫙"],
  [["vinegar", "balsamic"], "🫙"],
  [["soy sauce", "tamari", "miso", "fish sauce", "oyster sauce", "hoisin", "worcestershire"], "🫙"],
  [["tomato sauce", "ketchup", "passata", "pasta sauce", "pizza sauce"], "🍅"],
  [["mayonnaise", "mayo", "aioli", "mustard", "relish", "chutney", "dressing"], "🫙"],
  [["sriracha", "hot sauce"], "🌶️"],
  [["bbq sauce", "barbecue"], "🍖"],
  [["maple syrup", "syrup"], "🍯"],
  [["salsa"], "🌶️"],
  [["hummus", "dip"], "🥣"],
  [["stock", "broth", "bouillon", "cube"], "🍲"],
  [["canned", "tinned", "tin of", "can of"], "🥫"],
  [["soup"], "🍲"],
  [["honey"], "🍯"],
  [["jam", "jelly", "marmalade", "vegemite", "marmite", "peanut butter", "nutella", "spread"], "🫙"],
  [["chocolate", "cocoa", "cacao"], "🍫"],
  [["lentil", "chickpea", "legume"], "🫘"],
  [["nut", "almond", "cashew", "walnut", "pistachio", "macadamia", "peanut"], "🥜"],
  [["raisin", "sultana", "dried fruit"], "🍇"],
  [["apricot"], "🍑"],
  [["seed", "sesame", "sunflower seed", "chia", "flaxseed"], "🌱"],
  [["baking powder", "baking soda", "yeast", "vanilla", "extract"], "🧁"],
  [["fries", "french fries", "hot chip", "frozen chip"], "🍟"],
  [["chip", "crisp", "potato chip", "corn chip", "popcorn", "snack"], "🍿"],
  // ── Frozen ───────────────────────────────────────────────────────────────────
  [["frozen pizza", "pizza"], "🍕"],
  [["dumpling", "gyoza", "potsticker", "spring roll"], "🥟"],
  [["puff pastry", "pastry"], "🥐"],
  [["frozen", "ice"], "🧊"],
  // ── Drinks ───────────────────────────────────────────────────────────────────
  [["water", "sparkling water", "mineral water", "soda water"], "💧"],
  [["coffee", "espresso", "instant coffee", "nespresso", "pod"], "☕"],
  [["tea towel", "dish towel", "dishcloth"], "🧽"],
  [["tea", "green tea", "herbal tea", "chai", "teabag", "tea bag"], "🍵"],
  [["orange juice", "apple juice", "juice"], "🧃"],
  [["wine", "red wine", "white wine", "rosé", "prosecco", "champagne", "sparkling wine"], "🍷"],
  [["beer", "ale", "lager", "ipa", "cider"], "🍺"],
  [["spirit", "whisky", "whiskey", "gin", "vodka", "rum", "tequila"], "🥃"],
  [["soft drink", "soda", "cola", "coke", "pepsi", "lemonade", "energy drink", "sports drink", "gatorade", "kombucha"], "🥤"],
  // ── Household ────────────────────────────────────────────────────────────────
  [["toilet paper", "toilet roll", "tp ", " tp", "tissue", "facial tissue", "loo roll"], "🧻"],
  [["paper towel", "kitchen towel", "kitchen roll"], "🧻"],
  [["dish soap", "dishwashing liquid", "washing up", "fairy liquid", "dishwasher"], "🧼"],
  [["laundry", "washing powder", "washing liquid", "detergent", "fabric softener", "dryer sheet"], "🫧"],
  [["soap", "hand soap", "bar soap", "body wash", "hand wash"], "🧼"],
  [["shampoo", "conditioner", "hair"], "🧴"],
  [["toothpaste", "toothbrush", "dental", "floss"], "🪥"],
  [["deodorant", "antiperspirant"], "🧴"],
  [["sunscreen", "moisturiser", "moisturizer", "lotion"], "🧴"],
  [["razor", "shaving", "shaver"], "🪒"],
  [["sanitiser", "sanitizer", "hand gel"], "🧴"],
  [["nappy", "diaper"], "🍼"],
  [["baby wipe", "wet wipe", "wipe"], "🧻"],
  [["bin bag", "garbage bag", "trash bag", "rubbish bag"], "🗑️"],
  [["cling wrap", "plastic wrap", "alfoil", "aluminium foil", "foil", "baking paper", "parchment", "zip lock", "ziplock"], "📦"],
  [["sponge", "scrubber", "cleaning"], "🧽"],
  [["bleach", "disinfectant"], "🧪"],
  [["battery", "batteries"], "🔋"],
  [["light bulb", "lightbulb", "globe"], "💡"],
  [["pet food", "dog food", "cat food", "cat litter", "kibble", "treat"], "🐾"],
];

/** Every emoji the keyword matcher can return. */
export const GROCERY_ITEM_EMOJIS: readonly string[] = [...new Set(KEYWORD_MAP.map(([, emoji]) => emoji))];

/**
 * Returns an emoji for a grocery item name by fuzzy keyword matching.
 * Falls back to the aisle emoji if no keyword matches.
 */
export function getGroceryEmoji(name: string, aisle: string): string {
  const lower = name.toLowerCase();
  for (const [keywords, emoji] of KEYWORD_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return emoji;
    }
  }
  return AISLE_EMOJI[aisle as GroceryAisle] ?? "🏷️";
}

/**
 * Fluent Emoji Flat SVG markup for an emoji from getGroceryEmoji or
 * AISLE_META, so every device draws the same art instead of its own emoji
 * font. Undefined for an emoji with no generated glyph; callers fall back to
 * the plain emoji. Regenerate with scripts/gen-grocery-glyphs.mjs.
 */
export function groceryGlyphSvg(emoji: string): string | undefined {
  return GROCERY_GLYPH_SVGS[emoji.replace(/\uFE0F/g, '')];
}

/**
 * The same SVG with every hex colour turned to its grey (Rec. 709 luma), for
 * the e-paper theme: the art keeps its shape and shading without colour.
 */
export function greyscaleSvg(svg: string): string {
  return svg.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (_, hex: string) => {
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const h = y.toString(16).padStart(2, '0');
    return `#${h}${h}${h}`;
  });
}
