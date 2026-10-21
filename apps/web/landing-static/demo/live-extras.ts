// Rows only the live demo gets: a full today, so each main tab opens on
// something. The screenshot scenes keep the plainer household their stories
// were written against.
import { AVA, MIA, NOA, HOUSEHOLD, appointment, at, event } from "./fixtures";

export function seedLiveExtras() {
  const add = (collection: string, rows: { id: string }[]) => {
    HOUSEHOLD.stores[collection] = { ...HOUSEHOLD.stores[collection], ...Object.fromEntries(rows.map((r) => [r.id, r])) };
  };
  // Today's plans start just after whenever someone opens the demo, so Home's
  // Now card and the calendar's day are never all in the past.
  const soon = new Date();
  soon.setMinutes(soon.getMinutes() < 30 ? 30 : 60, 0, 0);
  const slot = (hours: number, minutes: number) => new Date(soon.getTime() + hours * 3_600_000 + minutes * 60_000).toISOString();
  add("events", [
    event("e-call", "Call the bank about the loan", slot(0, 0), slot(0, 30), { created_by: AVA }),
    event("e-coffee", "Coffee with Jo", slot(1, 30), slot(2, 30), { category: "social", location: "Bar Idda, Brunswick East" }),
    event("e-pickup", "Pick up Mia", slot(3, 30), slot(4, 0), { created_by: NOA, location: "Brunswick Primary" }),
    event("e-piano", "Mia's piano lesson", slot(5, 0), slot(5, 45), { created_by: NOA, location: "Sydney Rd Music" }),
    event("e-bookclub", "Book club call", slot(8, 0), slot(9, 0), { category: "social", created_by: AVA }),
    event("e-gym", "Noa: gym", at(1, "07:00"), at(1, "08:00"), { created_by: NOA }),
    event("e-parent", "Parent-teacher meeting", at(1, "17:30"), at(1, "18:00"), { created_by: AVA, location: "Brunswick Primary" }),
    event("e-market", "Farmers market", at(-1, "09:00"), at(-1, "10:30"), { created_by: MIA }),
  ]);
  // A viewing later today, so the map's day plan has a stop today.
  add("appointments", [appointment("vw-today", "ap-wattle", slot(6, 15), { notes: "Agent: Priya, 0412 555 019" })]);
}
