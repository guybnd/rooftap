import { RegionProvider, GroceryStapleTemplate } from "./types";
import { DEFAULT_EXPENSE_CATEGORIES } from "./generic";

// Germany. Adapted from Dorilan/ZuHause PR #11 (a fork of this repo running a
// German household) and restructured onto the generic-provider baseline.
//
// The moving checklist below encodes real German administrative steps. The
// Anmeldung deadline in particular is a legal one (Bundesmeldegesetz requires
// registering a new address with the local Bürgeramt within two weeks of
// moving in), and the Rundfunkbeitrag is owed per household regardless of
// whether anyone owns a television. Treat every date here as a prompt to check
// the current rule for your Bundesland, not as legal advice: municipalities
// differ on appointment lead times, and the surrounding tasks are convention
// rather than statute.

const EURFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const deProvider: RegionProvider = {
  id: "DE",
  currency: {
    code: "EUR",
    format: (amount: number) => EURFormatter.format(amount),
  },
  expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
  retailerHints: [
    "REWE",
    "Edeka",
    "ALDI",
    "Lidl",
    "Kaufland",
    "Netto",
    "dm",
    "Rossmann",
    "Media Markt",
    "Saturn",
    "OBI",
    "IKEA",
  ],
  listingSources: [
    {
      name: "ImmobilienScout24",
      url: "https://www.immobilienscout24.de",
      scrapable: true,
    },
    {
      name: "Immowelt",
      url: "https://www.immowelt.de",
      scrapable: true,
    },
    {
      name: "Kleinanzeigen",
      url: "https://www.kleinanzeigen.de/s-immobilien/c195",
      scrapable: true,
    },
    {
      name: "WG-Gesucht",
      url: "https://www.wg-gesucht.de",
      scrapable: false,
    },
    {
      name: "Facebook Marketplace",
      url: "https://www.facebook.com/marketplace",
      scrapable: false,
    },
  ],
  // Names carry the German term first with an English gloss, so a household
  // mixing languages can match what's printed on the shelf.
  groceryStaples: [
    { template_key: "staple-milk",       name: "Milch (milk)",                aisle: "dairy_eggs",   quantity: 2,   unit: "L" },
    { template_key: "staple-eggs",       name: "Eier (eggs)",                 aisle: "dairy_eggs",   quantity: 10,  unit: null },
    { template_key: "staple-butter",     name: "Butter",                      aisle: "dairy_eggs",   quantity: 1,   unit: null },
    { template_key: "staple-quark",      name: "Quark",                       aisle: "dairy_eggs",   quantity: 1,   unit: null },
    { template_key: "staple-bread",      name: "Brot (bread)",                aisle: "bakery",       quantity: 1,   unit: null },
    { template_key: "staple-broetchen",  name: "Brötchen (rolls)",            aisle: "bakery",       quantity: 6,   unit: null },
    { template_key: "staple-rice",       name: "Reis (rice)",                 aisle: "pantry",       quantity: 1,   unit: "kg" },
    { template_key: "staple-pasta",      name: "Nudeln (pasta)",              aisle: "pantry",       quantity: 500, unit: "g" },
    { template_key: "staple-tinned-tom", name: "Tomaten, Dose (tinned)",      aisle: "pantry",       quantity: 2,   unit: null },
    { template_key: "staple-olive-oil",  name: "Olivenöl (olive oil)",        aisle: "pantry",       quantity: 1,   unit: null },
    { template_key: "staple-chicken",    name: "Hähnchenbrust (chicken)",     aisle: "meat_seafood", quantity: 500, unit: "g" },
    { template_key: "staple-mince",      name: "Hackfleisch (mince)",         aisle: "meat_seafood", quantity: 500, unit: "g" },
    { template_key: "staple-spinach",    name: "Spinat (spinach)",            aisle: "produce",      quantity: 1,   unit: null },
    { template_key: "staple-tomatoes",   name: "Tomaten (tomatoes)",          aisle: "produce",      quantity: 4,   unit: null },
    { template_key: "staple-onions",     name: "Zwiebeln (onions)",           aisle: "produce",      quantity: 3,   unit: null },
    { template_key: "staple-potatoes",   name: "Kartoffeln (potatoes)",       aisle: "produce",      quantity: 2,   unit: "kg" },
    { template_key: "staple-bananas",    name: "Bananen (bananas)",           aisle: "produce",      quantity: 1,   unit: null },
    { template_key: "staple-coffee",     name: "Kaffee (coffee)",             aisle: "drinks",       quantity: 500, unit: "g" },
    { template_key: "staple-water",      name: "Mineralwasser (water)",       aisle: "drinks",       quantity: 1,   unit: null },
    { template_key: "staple-dishwash",   name: "Spülmittel (dish soap)",      aisle: "household",    quantity: 1,   unit: null },
    { template_key: "staple-tp",         name: "Toilettenpapier (loo roll)",  aisle: "household",    quantity: 1,   unit: null },
    { template_key: "staple-bin-bags",   name: "Müllbeutel (bin bags)",       aisle: "household",    quantity: 1,   unit: null },
  ] satisfies GroceryStapleTemplate[],

  // offset_days is relative to move-in day (0), same contract as AU.
  movingTasks: [
    { template_key: "move-give-notice", title: "Kündigung: give notice to the current landlord", offset_days: -90, notes: "German rental notice is commonly three months. Check your contract." },
    { template_key: "move-schufa", title: "Order a SCHUFA credit report", offset_days: -60, notes: "Most landlords ask for one with the application." },
    { template_key: "move-book-removalist", title: "Book a Umzugsunternehmen or hire a van", offset_days: -30 },
    { template_key: "move-buergeramt-appt", title: "Book the Bürgeramt appointment for your Anmeldung", offset_days: -21, notes: "Book early: slots in larger cities are often weeks out." },
    { template_key: "move-mail-redirect", title: "Set up Deutsche Post Nachsendeauftrag", offset_days: -21 },
    { template_key: "move-electricity-gas", title: "Arrange Strom and Gas contracts", offset_days: -21, notes: "Compare on Verivox or Check24." },
    { template_key: "move-internet", title: "Book the internet connection", offset_days: -21, notes: "Installation can take several weeks." },
    { template_key: "move-insurance", title: "Set up Haftpflicht and Hausratversicherung", offset_days: -14 },
    { template_key: "move-halteverbot", title: "Apply for a Halteverbot outside both addresses", offset_days: -14, notes: "Reserves the kerb for the removal van." },
    { template_key: "move-confirm-bookings", title: "Confirm removal and connection times", offset_days: -3 },
    { template_key: "move-essentials-box", title: "Pack an essentials box (chargers, toiletries, kettle)", offset_days: -1 },
    { template_key: "move-keys-protokoll", title: "Collect keys and complete the Übergabeprotokoll", offset_days: 0 },
    { template_key: "move-meter-readings", title: "Record meter readings (Strom, Gas, Wasser)", offset_days: 0 },
    { template_key: "move-wohnungsgeberbestaetigung", title: "Get the Wohnungsgeberbestätigung from the landlord", offset_days: 1, notes: "Required at the Anmeldung appointment." },
    { template_key: "move-anmeldung", title: "Anmeldung: register your address at the Bürgeramt", offset_days: 7, notes: "Legally due within two weeks of moving in. Bring passport and the Wohnungsgeberbestätigung." },
    { template_key: "move-rundfunkbeitrag", title: "Register for the Rundfunkbeitrag", offset_days: 14, notes: "Owed per household, whether or not you own a TV." },
    { template_key: "move-ummeldung-vehicle", title: "Re-register the car at the Zulassungsstelle", offset_days: 14 },
    { template_key: "move-local-services", title: "Register with a local Hausarzt and find the nearest Apotheke", offset_days: 14 },
  ],
};
