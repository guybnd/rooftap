import { z } from "zod";
import { itemLink, type Apartment, type Appointment } from "@homeup/core";
import { compact, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";

// Home Search: the places the household is looking at, with viewings.

export function searchTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { tools, tool, db } = toolRegistrar(ctx);

  tool(
    "get_home_search",
    {
      description:
        "Home Search: the places the household is looking at to rent or buy (address, rent per week in whole currency units, bedrooms, bathrooms, parking, notes, score), with their viewings (scheduled_at, status). Archived listings are left out unless include_archived is true.",
      inputSchema: {
        include_archived: z.boolean().optional(),
      },
    },
    async ({ include_archived }) => {
      const [places, viewings] = await Promise.all([db.rows<Apartment>("apartments"), db.rows<Appointment>("appointments")]);
      return ok(
        places
          .filter((p) => include_archived || !p.archived)
          .map((p) =>
            compact({
              id: p.id,
              address: p.address,
              suburb: p.suburb,
              rent_per_week: p.rent_per_week,
              bedrooms: p.bedrooms,
              bathrooms: p.bathrooms,
              parking: p.parking,
              score: p.preliminary_score,
              decision: p.disposition,
              move_in_date: p.move_in_date,
              listing_url: p.listing_url,
              notes: p.notes,
              archived: p.archived || null,
              link: itemLink("listing", p.id),
              viewings: viewings
                .filter((v) => v.apartment_id === p.id)
                .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
                .map((v) => compact({ scheduled_at: v.scheduled_at, status: v.status, notes: v.notes })),
            }),
          ),
      );
    },
  );

  return tools;
}
