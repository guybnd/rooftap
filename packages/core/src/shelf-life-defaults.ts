/**
 * Baseline item library: a robust catalog of common household grocery items with
 * a default "rebuy interval" (`days`) and a typical price (AUD) for each. These
 * are the code-level defaults; per-group overrides live in the
 * `grocery_item_library` table and take precedence.
 *
 * `days` is presented on the Item Library as "buy again every ~Nd" (FLUX-208):
 * for perishables it is the shelf life; for staples/consumables it is a sensible
 * consumption cadence. It also feeds list-item expiry + the re-add suggestion
 * (`suggestReAdd`, `groceries.ts`). Households refine per item.
 *
 * All names are stored in canonical singular form (see `canonicalizeItemName`)
 * so "potato"/"potatoes" resolve to one entry.
 */
export interface ShelfLifeDefault {
  name: string;
  days: number;
  /** Typical price in AUD dollars (converted to cents on lookup). */
  price?: number;
  aisle?: string;
}

// ── Name canonicalization (singular + lowercase + trim) ──────────────────────
// Words that would be mangled by the naive rules below but are NOT plurals we
// want to strip — never singularize these (the -us/-ss/-is guards handle most).
const SINGULAR_EXCEPTIONS = new Set([
  "hummus", "asparagus", "couscous", "molasses", "watercress", "series",
]);

/** Singularize a single word conservatively (guards real -s/-us/-is/-ss words). */
function singularizeWord(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return word;
  if (SINGULAR_EXCEPTIONS.has(w)) return word;
  if (/(ss|us|is|os)$/.test(w)) return word;               // kiss, hummus, basis, kudos
  if (/ies$/.test(w)) return word.slice(0, -3) + "y";       // berries -> berry
  if (/(ches|shes|xes|zes|ses|oes)$/.test(w)) return word.slice(0, -2); // boxes->box, tomatoes->tomato
  if (/s$/.test(w)) return word.slice(0, -1);               // bananas -> banana
  return word;
}

/**
 * Canonical key for an item name: lowercase, collapse whitespace, and singularize
 * the head (final) word so singular/plural pairs collapse to one entry. Modifier
 * words are left intact ("chicken thighs" -> "chicken thigh", "sweet potatoes"
 * -> "sweet potato"). Used by every fuzzy matcher + the catalog merge (FLUX-208).
 */
export function canonicalizeItemName(name: string): string {
  const cleaned = name.toLowerCase().trim().replace(/\s+/g, " ");
  if (!cleaned) return cleaned;
  const parts = cleaned.split(" ");
  parts[parts.length - 1] = singularizeWord(parts[parts.length - 1]);
  return parts.join(" ");
}

export const SHELF_LIFE_DEFAULTS: ShelfLifeDefault[] = [
  // ── Produce ────────────────────────────────────────────────────────────────
  { name: "Apple",              days: 21,  price: 5.00, aisle: "produce" },
  { name: "Banana",             days: 5,   price: 3.50, aisle: "produce" },
  { name: "Orange",             days: 14,  price: 4.00, aisle: "produce" },
  { name: "Mandarin",           days: 14,  price: 4.00, aisle: "produce" },
  { name: "Lemon",              days: 14,  price: 1.00, aisle: "produce" },
  { name: "Lime",               days: 14,  price: 1.00, aisle: "produce" },
  { name: "Grapefruit",         days: 21,  price: 2.00, aisle: "produce" },
  { name: "Strawberry",         days: 4,   price: 4.00, aisle: "produce" },
  { name: "Blueberry",          days: 7,   price: 5.00, aisle: "produce" },
  { name: "Raspberry",          days: 3,   price: 5.00, aisle: "produce" },
  { name: "Blackberry",         days: 3,   price: 5.00, aisle: "produce" },
  { name: "Grape",              days: 7,   price: 6.00, aisle: "produce" },
  { name: "Watermelon",         days: 7,   price: 6.00, aisle: "produce" },
  { name: "Rockmelon",          days: 7,   price: 4.00, aisle: "produce" },
  { name: "Pineapple",          days: 7,   price: 4.00, aisle: "produce" },
  { name: "Mango",              days: 6,   price: 2.00, aisle: "produce" },
  { name: "Peach",              days: 5,   price: 4.00, aisle: "produce" },
  { name: "Nectarine",          days: 5,   price: 4.00, aisle: "produce" },
  { name: "Plum",               days: 7,   price: 4.00, aisle: "produce" },
  { name: "Pear",               days: 14,  price: 4.00, aisle: "produce" },
  { name: "Kiwifruit",          days: 14,  price: 3.00, aisle: "produce" },
  { name: "Cherry",             days: 7,   price: 8.00, aisle: "produce" },
  { name: "Avocado",            days: 3,   price: 1.50, aisle: "produce" },
  { name: "Spinach",            days: 5,   price: 3.50, aisle: "produce" },
  { name: "Lettuce",            days: 7,   price: 3.00, aisle: "produce" },
  { name: "Kale",               days: 5,   price: 3.50, aisle: "produce" },
  { name: "Rocket",             days: 5,   price: 3.50, aisle: "produce" },
  { name: "Mixed salad",        days: 5,   price: 4.00, aisle: "produce" },
  { name: "Broccoli",           days: 7,   price: 4.00, aisle: "produce" },
  { name: "Broccolini",         days: 6,   price: 3.50, aisle: "produce" },
  { name: "Cauliflower",        days: 7,   price: 5.00, aisle: "produce" },
  { name: "Cabbage",            days: 14,  price: 3.00, aisle: "produce" },
  { name: "Brussels sprout",    days: 10,  price: 5.00, aisle: "produce" },
  { name: "Capsicum",           days: 7,   price: 2.00, aisle: "produce" },
  { name: "Chilli",             days: 10,  price: 2.00, aisle: "produce" },
  { name: "Cucumber",           days: 7,   price: 1.50, aisle: "produce" },
  { name: "Zucchini",           days: 7,   price: 4.00, aisle: "produce" },
  { name: "Eggplant",           days: 7,   price: 3.00, aisle: "produce" },
  { name: "Mushroom",           days: 5,   price: 4.50, aisle: "produce" },
  { name: "Celery",             days: 14,  price: 3.00, aisle: "produce" },
  { name: "Carrot",             days: 14,  price: 2.50, aisle: "produce" },
  { name: "Beetroot",           days: 21,  price: 3.00, aisle: "produce" },
  { name: "Radish",             days: 10,  price: 2.50, aisle: "produce" },
  { name: "Asparagus",          days: 4,   price: 4.00, aisle: "produce" },
  { name: "Green bean",         days: 6,   price: 4.00, aisle: "produce" },
  { name: "Snow pea",           days: 5,   price: 4.00, aisle: "produce" },
  { name: "Corn",               days: 3,   price: 1.00, aisle: "produce" },
  { name: "Tomato",             days: 7,   price: 5.00, aisle: "produce" },
  { name: "Potato",             days: 30,  price: 6.00, aisle: "produce" },
  { name: "Sweet potato",       days: 14,  price: 4.00, aisle: "produce" },
  { name: "Pumpkin",            days: 30,  price: 3.00, aisle: "produce" },
  { name: "Onion",              days: 60,  price: 3.00, aisle: "produce" },
  { name: "Red onion",          days: 60,  price: 3.00, aisle: "produce" },
  { name: "Spring onion",       days: 7,   price: 2.00, aisle: "produce" },
  { name: "Leek",               days: 14,  price: 3.00, aisle: "produce" },
  { name: "Garlic",             days: 60,  price: 1.50, aisle: "produce" },
  { name: "Ginger",             days: 21,  price: 2.00, aisle: "produce" },
  { name: "Fresh herbs",        days: 5,   price: 3.00, aisle: "produce" },
  // ── Dairy & Eggs ───────────────────────────────────────────────────────────
  { name: "Milk",               days: 7,   price: 3.10, aisle: "dairy_eggs" },
  { name: "Skim milk",          days: 7,   price: 3.10, aisle: "dairy_eggs" },
  { name: "Oat milk",           days: 10,  price: 3.50, aisle: "dairy_eggs" },
  { name: "Almond milk",        days: 10,  price: 3.00, aisle: "dairy_eggs" },
  { name: "Soy milk",           days: 10,  price: 3.00, aisle: "dairy_eggs" },
  { name: "Egg",                days: 21,  price: 5.50, aisle: "dairy_eggs" },
  { name: "Butter",             days: 60,  price: 6.00, aisle: "dairy_eggs" },
  { name: "Margarine",          days: 60,  price: 4.00, aisle: "dairy_eggs" },
  { name: "Cheese",             days: 21,  price: 8.00, aisle: "dairy_eggs" },
  { name: "Cheddar",            days: 30,  price: 9.00, aisle: "dairy_eggs" },
  { name: "Feta",               days: 14,  price: 6.50, aisle: "dairy_eggs" },
  { name: "Parmesan",           days: 30,  price: 9.50, aisle: "dairy_eggs" },
  { name: "Mozzarella",         days: 7,   price: 7.00, aisle: "dairy_eggs" },
  { name: "Halloumi",           days: 14,  price: 7.00, aisle: "dairy_eggs" },
  { name: "Cream cheese",       days: 14,  price: 4.50, aisle: "dairy_eggs" },
  { name: "Ricotta",            days: 10,  price: 5.00, aisle: "dairy_eggs" },
  { name: "Cottage cheese",     days: 10,  price: 4.50, aisle: "dairy_eggs" },
  { name: "Yogurt",             days: 14,  price: 5.50, aisle: "dairy_eggs" },
  { name: "Greek yogurt",       days: 14,  price: 6.50, aisle: "dairy_eggs" },
  { name: "Cream",              days: 5,   price: 3.00, aisle: "dairy_eggs" },
  { name: "Thickened cream",    days: 7,   price: 3.00, aisle: "dairy_eggs" },
  { name: "Sour cream",         days: 14,  price: 3.50, aisle: "dairy_eggs" },
  { name: "Custard",            days: 7,   price: 3.50, aisle: "dairy_eggs" },
  // ── Meat & Seafood ─────────────────────────────────────────────────────────
  { name: "Chicken breast",     days: 2,   price: 11.00, aisle: "meat_seafood" },
  { name: "Chicken thigh",      days: 2,   price: 9.00,  aisle: "meat_seafood" },
  { name: "Chicken",            days: 2,   price: 10.00, aisle: "meat_seafood" },
  { name: "Whole chicken",      days: 3,   price: 12.00, aisle: "meat_seafood" },
  { name: "Chicken drumstick",  days: 2,   price: 8.00,  aisle: "meat_seafood" },
  { name: "Beef mince",         days: 2,   price: 9.00,  aisle: "meat_seafood" },
  { name: "Steak",              days: 3,   price: 15.00, aisle: "meat_seafood" },
  { name: "Beef",               days: 3,   price: 14.00, aisle: "meat_seafood" },
  { name: "Lamb",               days: 3,   price: 16.00, aisle: "meat_seafood" },
  { name: "Lamb chop",          days: 3,   price: 14.00, aisle: "meat_seafood" },
  { name: "Pork",               days: 3,   price: 12.00, aisle: "meat_seafood" },
  { name: "Pork chop",          days: 3,   price: 12.00, aisle: "meat_seafood" },
  { name: "Pork mince",         days: 2,   price: 9.00,  aisle: "meat_seafood" },
  { name: "Bacon",              days: 7,   price: 7.00,  aisle: "meat_seafood" },
  { name: "Ham",                days: 5,   price: 6.00,  aisle: "meat_seafood" },
  { name: "Prosciutto",         days: 14,  price: 6.00,  aisle: "meat_seafood" },
  { name: "Salami",             days: 14,  price: 5.00,  aisle: "meat_seafood" },
  { name: "Chorizo",            days: 14,  price: 6.00,  aisle: "meat_seafood" },
  { name: "Sausage",            days: 2,   price: 7.00,  aisle: "meat_seafood" },
  { name: "Meatball",           days: 2,   price: 8.00,  aisle: "meat_seafood" },
  { name: "Salmon",             days: 2,   price: 13.00, aisle: "meat_seafood" },
  { name: "Fish",               days: 2,   price: 12.00, aisle: "meat_seafood" },
  { name: "White fish",         days: 2,   price: 12.00, aisle: "meat_seafood" },
  { name: "Barramundi",         days: 2,   price: 16.00, aisle: "meat_seafood" },
  { name: "Prawn",              days: 2,   price: 15.00, aisle: "meat_seafood" },
  { name: "Squid",              days: 2,   price: 12.00, aisle: "meat_seafood" },
  { name: "Mussel",             days: 2,   price: 8.00,  aisle: "meat_seafood" },
  { name: "Tofu",               days: 10,  price: 3.50,  aisle: "meat_seafood" },
  // ── Bakery ─────────────────────────────────────────────────────────────────
  { name: "Bread",              days: 5,   price: 4.00, aisle: "bakery" },
  { name: "White bread",        days: 5,   price: 4.00, aisle: "bakery" },
  { name: "Wholemeal bread",    days: 5,   price: 4.00, aisle: "bakery" },
  { name: "Sourdough",          days: 5,   price: 6.00, aisle: "bakery" },
  { name: "Baguette",           days: 3,   price: 4.00, aisle: "bakery" },
  { name: "Bread roll",         days: 4,   price: 4.00, aisle: "bakery" },
  { name: "Bagel",              days: 7,   price: 5.00, aisle: "bakery" },
  { name: "Croissant",          days: 3,   price: 8.00, aisle: "bakery" },
  { name: "Wrap",               days: 7,   price: 4.00, aisle: "bakery" },
  { name: "Tortilla",           days: 14,  price: 4.50, aisle: "bakery" },
  { name: "Pita bread",         days: 7,   price: 4.00, aisle: "bakery" },
  { name: "Naan",               days: 7,   price: 4.50, aisle: "bakery" },
  { name: "Muffin",             days: 5,   price: 6.00, aisle: "bakery" },
  { name: "Crumpet",            days: 10,  price: 4.00, aisle: "bakery" },
  { name: "Cake",               days: 4,   price: 12.00, aisle: "bakery" },
  { name: "Doughnut",           days: 3,   price: 6.00, aisle: "bakery" },
  // ── Pantry ─────────────────────────────────────────────────────────────────
  { name: "Pasta",              days: 730, price: 2.50, aisle: "pantry" },
  { name: "Spaghetti",          days: 730, price: 2.50, aisle: "pantry" },
  { name: "Penne",              days: 730, price: 2.50, aisle: "pantry" },
  { name: "Lasagne sheet",      days: 730, price: 3.00, aisle: "pantry" },
  { name: "Rice",               days: 730, price: 3.00, aisle: "pantry" },
  { name: "Basmati rice",       days: 730, price: 4.00, aisle: "pantry" },
  { name: "Brown rice",         days: 365, price: 4.00, aisle: "pantry" },
  { name: "Noodle",             days: 365, price: 2.50, aisle: "pantry" },
  { name: "Rice noodle",        days: 365, price: 3.00, aisle: "pantry" },
  { name: "Couscous",           days: 365, price: 3.00, aisle: "pantry" },
  { name: "Quinoa",             days: 365, price: 6.00, aisle: "pantry" },
  { name: "Oats",               days: 365, price: 4.00, aisle: "pantry" },
  { name: "Muesli",             days: 180, price: 6.00, aisle: "pantry" },
  { name: "Granola",            days: 180, price: 7.00, aisle: "pantry" },
  { name: "Cereal",             days: 180, price: 5.00, aisle: "pantry" },
  { name: "Weet-Bix",           days: 180, price: 5.00, aisle: "pantry" },
  { name: "Flour",              days: 365, price: 2.00, aisle: "pantry" },
  { name: "Self-raising flour", days: 365, price: 2.50, aisle: "pantry" },
  { name: "Sugar",              days: 730, price: 2.50, aisle: "pantry" },
  { name: "Brown sugar",        days: 730, price: 3.00, aisle: "pantry" },
  { name: "Icing sugar",        days: 730, price: 3.00, aisle: "pantry" },
  { name: "Salt",               days: 1825,price: 1.50, aisle: "pantry" },
  { name: "Black pepper",       days: 1095,price: 3.00, aisle: "pantry" },
  { name: "Olive oil",          days: 540, price: 8.00, aisle: "pantry" },
  { name: "Vegetable oil",      days: 365, price: 5.00, aisle: "pantry" },
  { name: "Coconut oil",        days: 730, price: 8.00, aisle: "pantry" },
  { name: "Vinegar",            days: 1095,price: 3.00, aisle: "pantry" },
  { name: "Balsamic vinegar",   days: 1095,price: 5.00, aisle: "pantry" },
  { name: "Soy sauce",          days: 730, price: 3.00, aisle: "pantry" },
  { name: "Fish sauce",         days: 730, price: 3.00, aisle: "pantry" },
  { name: "Oyster sauce",       days: 540, price: 4.00, aisle: "pantry" },
  { name: "Sweet chilli sauce", days: 540, price: 4.00, aisle: "pantry" },
  { name: "Sriracha",           days: 540, price: 4.00, aisle: "pantry" },
  { name: "Tomato sauce",       days: 365, price: 4.00, aisle: "pantry" },
  { name: "BBQ sauce",          days: 365, price: 4.00, aisle: "pantry" },
  { name: "Mustard",            days: 365, price: 4.00, aisle: "pantry" },
  { name: "Mayonnaise",         days: 90,  price: 5.00, aisle: "pantry" },
  { name: "Aioli",              days: 60,  price: 5.00, aisle: "pantry" },
  { name: "Pasta sauce",        days: 365, price: 3.50, aisle: "pantry" },
  { name: "Passata",            days: 365, price: 2.50, aisle: "pantry" },
  { name: "Pesto",              days: 60,  price: 5.00, aisle: "pantry" },
  { name: "Canned tomato",      days: 730, price: 1.50, aisle: "pantry" },
  { name: "Canned bean",        days: 730, price: 1.50, aisle: "pantry" },
  { name: "Chickpea",           days: 730, price: 1.50, aisle: "pantry" },
  { name: "Lentil",             days: 730, price: 2.00, aisle: "pantry" },
  { name: "Kidney bean",        days: 730, price: 1.50, aisle: "pantry" },
  { name: "Coconut milk",       days: 540, price: 2.00, aisle: "pantry" },
  { name: "Canned tuna",        days: 1095,price: 1.50, aisle: "pantry" },
  { name: "Canned corn",        days: 730, price: 1.50, aisle: "pantry" },
  { name: "Stock cube",         days: 365, price: 3.00, aisle: "pantry" },
  { name: "Chicken stock",      days: 365, price: 3.00, aisle: "pantry" },
  { name: "Vegetable stock",    days: 365, price: 3.00, aisle: "pantry" },
  { name: "Honey",              days: 1095,price: 6.00, aisle: "pantry" },
  { name: "Jam",                days: 365, price: 4.00, aisle: "pantry" },
  { name: "Peanut butter",      days: 365, price: 5.00, aisle: "pantry" },
  { name: "Vegemite",           days: 730, price: 5.00, aisle: "pantry" },
  { name: "Nutella",            days: 365, price: 5.00, aisle: "pantry" },
  { name: "Maple syrup",        days: 730, price: 8.00, aisle: "pantry" },
  { name: "Chocolate",          days: 365, price: 4.00, aisle: "pantry" },
  { name: "Biscuit",            days: 180, price: 3.00, aisle: "pantry" },
  { name: "Cracker",            days: 180, price: 3.00, aisle: "pantry" },
  { name: "Chips",              days: 90,  price: 3.50, aisle: "pantry" },
  { name: "Popcorn",            days: 180, price: 3.00, aisle: "pantry" },
  { name: "Muesli bar",         days: 180, price: 4.00, aisle: "pantry" },
  { name: "Almond",             days: 180, price: 7.00, aisle: "pantry" },
  { name: "Cashew",             days: 180, price: 8.00, aisle: "pantry" },
  { name: "Peanut",             days: 180, price: 4.00, aisle: "pantry" },
  { name: "Mixed nut",          days: 180, price: 6.00, aisle: "pantry" },
  { name: "Raisin",             days: 180, price: 3.00, aisle: "pantry" },
  { name: "Dried apricot",      days: 180, price: 5.00, aisle: "pantry" },
  { name: "Baking powder",      days: 365, price: 3.00, aisle: "pantry" },
  { name: "Baking soda",        days: 730, price: 2.00, aisle: "pantry" },
  { name: "Vanilla extract",    days: 730, price: 5.00, aisle: "pantry" },
  { name: "Cocoa powder",       days: 365, price: 4.00, aisle: "pantry" },
  { name: "Hummus",             days: 7,   price: 4.00, aisle: "pantry" },
  { name: "Salsa",              days: 14,  price: 4.00, aisle: "pantry" },
  // ── Frozen ─────────────────────────────────────────────────────────────────
  { name: "Frozen pea",         days: 365, price: 3.00, aisle: "frozen" },
  { name: "Frozen mixed veg",   days: 365, price: 3.50, aisle: "frozen" },
  { name: "Frozen corn",        days: 365, price: 3.00, aisle: "frozen" },
  { name: "Frozen berry",       days: 365, price: 5.00, aisle: "frozen" },
  { name: "Frozen mango",       days: 365, price: 5.00, aisle: "frozen" },
  { name: "Frozen spinach",     days: 365, price: 3.00, aisle: "frozen" },
  { name: "Ice cream",          days: 180, price: 7.00, aisle: "frozen" },
  { name: "Gelato",             days: 180, price: 8.00, aisle: "frozen" },
  { name: "Frozen pizza",       days: 180, price: 6.00, aisle: "frozen" },
  { name: "Frozen chips",       days: 365, price: 4.00, aisle: "frozen" },
  { name: "Fish finger",        days: 180, price: 6.00, aisle: "frozen" },
  { name: "Frozen fish fillet", days: 180, price: 10.00, aisle: "frozen" },
  { name: "Chicken nugget",     days: 180, price: 7.00, aisle: "frozen" },
  { name: "Frozen dumpling",    days: 180, price: 8.00, aisle: "frozen" },
  { name: "Puff pastry",        days: 365, price: 5.00, aisle: "frozen" },
  { name: "Ice",                days: 365, price: 3.00, aisle: "frozen" },
  // ── Drinks ─────────────────────────────────────────────────────────────────
  { name: "Water",              days: 7,   price: 1.00, aisle: "drinks" },
  { name: "Sparkling water",    days: 14,  price: 1.50, aisle: "drinks" },
  { name: "Orange juice",       days: 7,   price: 4.50, aisle: "drinks" },
  { name: "Apple juice",        days: 7,   price: 4.00, aisle: "drinks" },
  { name: "Coffee",             days: 30,  price: 10.00, aisle: "drinks" },
  { name: "Coffee bean",        days: 30,  price: 14.00, aisle: "drinks" },
  { name: "Instant coffee",     days: 60,  price: 9.00, aisle: "drinks" },
  { name: "Coffee pod",         days: 30,  price: 8.00, aisle: "drinks" },
  { name: "Tea",                days: 60,  price: 4.00, aisle: "drinks" },
  { name: "Green tea",          days: 60,  price: 5.00, aisle: "drinks" },
  { name: "Soft drink",         days: 14,  price: 3.00, aisle: "drinks" },
  { name: "Cola",               days: 14,  price: 3.00, aisle: "drinks" },
  { name: "Lemonade",           days: 14,  price: 3.00, aisle: "drinks" },
  { name: "Energy drink",       days: 14,  price: 3.00, aisle: "drinks" },
  { name: "Sports drink",       days: 14,  price: 3.00, aisle: "drinks" },
  { name: "Kombucha",           days: 10,  price: 4.00, aisle: "drinks" },
  { name: "Beer",               days: 14,  price: 20.00, aisle: "drinks" },
  { name: "Red wine",           days: 30,  price: 15.00, aisle: "drinks" },
  { name: "White wine",         days: 30,  price: 15.00, aisle: "drinks" },
  { name: "Sparkling wine",     days: 30,  price: 18.00, aisle: "drinks" },
  { name: "Cider",              days: 14,  price: 18.00, aisle: "drinks" },
  // ── Household ──────────────────────────────────────────────────────────────
  { name: "Toilet paper",       days: 30,  price: 8.00, aisle: "household" },
  { name: "Paper towel",        days: 30,  price: 4.00, aisle: "household" },
  { name: "Tissue",             days: 30,  price: 3.00, aisle: "household" },
  { name: "Dish soap",          days: 60,  price: 4.00, aisle: "household" },
  { name: "Dishwasher tablet",  days: 45,  price: 10.00, aisle: "household" },
  { name: "Laundry detergent",  days: 45,  price: 12.00, aisle: "household" },
  { name: "Fabric softener",    days: 60,  price: 6.00, aisle: "household" },
  { name: "Hand soap",          days: 60,  price: 4.00, aisle: "household" },
  { name: "Body wash",          days: 60,  price: 6.00, aisle: "household" },
  { name: "Shampoo",            days: 60,  price: 8.00, aisle: "household" },
  { name: "Conditioner",        days: 60,  price: 8.00, aisle: "household" },
  { name: "Toothpaste",         days: 45,  price: 4.00, aisle: "household" },
  { name: "Toothbrush",         days: 90,  price: 3.00, aisle: "household" },
  { name: "Deodorant",          days: 60,  price: 6.00, aisle: "household" },
  { name: "Moisturiser",        days: 90,  price: 12.00, aisle: "household" },
  { name: "Sunscreen",          days: 90,  price: 12.00, aisle: "household" },
  { name: "Razor",              days: 90,  price: 12.00, aisle: "household" },
  { name: "Bin bag",            days: 60,  price: 5.00, aisle: "household" },
  { name: "Cling wrap",         days: 120, price: 4.00, aisle: "household" },
  { name: "Aluminium foil",     days: 180, price: 4.00, aisle: "household" },
  { name: "Baking paper",       days: 120, price: 4.00, aisle: "household" },
  { name: "Zip lock bag",       days: 90,  price: 5.00, aisle: "household" },
  { name: "Sponge",             days: 30,  price: 3.00, aisle: "household" },
  { name: "Tea towel",          days: 180, price: 5.00, aisle: "household" },
  { name: "Surface spray",      days: 90,  price: 5.00, aisle: "household" },
  { name: "Bleach",             days: 180, price: 3.00, aisle: "household" },
  { name: "Hand sanitiser",     days: 120, price: 5.00, aisle: "household" },
  { name: "Battery",            days: 365, price: 8.00, aisle: "household" },
  { name: "Light bulb",         days: 365, price: 6.00, aisle: "household" },
  { name: "Nappy",              days: 14,  price: 25.00, aisle: "household" },
  { name: "Baby wipe",          days: 21,  price: 5.00, aisle: "household" },
  { name: "Dog food",           days: 30,  price: 20.00, aisle: "household" },
  { name: "Cat food",           days: 30,  price: 20.00, aisle: "household" },
  { name: "Cat litter",         days: 21,  price: 15.00, aisle: "household" },
];

/** Build a lookup map: canonical name → days. */
export function buildDefaultMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of SHELF_LIFE_DEFAULTS) {
    map.set(canonicalizeItemName(entry.name), entry.days);
  }
  return map;
}

/**
 * Find the matching default entry for an item name. Exact canonical match wins
 * first; only then a fuzzy substring pass (guarded to ≥4-char keys/targets so
 * short names like "ice" don't cross-match "rice", "ham" ⊄ "sham", etc.).
 */
export function lookupDefault(name: string): ShelfLifeDefault | null {
  const target = canonicalizeItemName(name);
  if (!target) return null;
  for (const entry of SHELF_LIFE_DEFAULTS) {
    if (canonicalizeItemName(entry.name) === target) return entry;
  }
  if (target.length < 4) return null;
  for (const entry of SHELF_LIFE_DEFAULTS) {
    const key = canonicalizeItemName(entry.name);
    if (key.length < 4) continue;
    if (target.includes(key) || key.includes(target)) return entry;
  }
  return null;
}

/** Find shelf life for an item name by fuzzy match against defaults. */
export function lookupDefaultShelfLife(name: string): number | null {
  return lookupDefault(name)?.days ?? null;
}

/** Find a typical price (in cents) for an item name by fuzzy match. */
export function lookupDefaultPriceCents(name: string): number | null {
  const price = lookupDefault(name)?.price;
  return price != null ? Math.round(price * 100) : null;
}

/**
 * Humanize a rebuy interval in days (`14` -> `"2w"`). Returns `null` for
 * `null` input — callers render the `—` placeholder, never this helper.
 */
export function formatRebuyInterval(days: number | null): string | null {
  if (days == null) return null;
  if (days >= 365) return `${Math.round(days / 365)}y`;
  if (days >= 30) return `${Math.round(days / 30)}mo`;
  if (days >= 7) return `${Math.round(days / 7)}w`;
  return `${days}d`;
}
