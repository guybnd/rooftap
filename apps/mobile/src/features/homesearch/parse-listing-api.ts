// HOUP-78: native calls to POST /api/parse-listing (the AI listing-parse
// backend at apps/web/src/app/api/parse-listing/route.ts — untouched here).
// Same authedFetch pattern already established by
// apps/mobile/src/features/calendar/calendar-api.ts: an absolute-origin
// fetch (native has no cookie jar for the web origin) with the current
// Supabase session's access token attached as `Authorization: Bearer`,
// which the route's createServerSupabase() session lookup accepts as a
// fallback to the cookie path.
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');

  const supabase = getCurrentSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return fetch(`${server.origin}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init?.headers,
    },
  });
}

// Mirrors apps/web/src/lib/ai/parser.ts's ParsedListing/ParsedAgent — that
// file lives in apps/web (imports Node-only provider SDKs), so the shape is
// duplicated here rather than imported.
export interface ParsedListingAgent {
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
  agents?: ParsedListingAgent[];
}

export interface ParseListingInput {
  url?: string;
  text?: string;
  /** base64 data-URLs, e.g. from expo-image-picker assets. */
  images?: string[];
}

export async function parseListing(input: ParseListingInput): Promise<ParsedListing> {
  const res = await authedFetch('/api/parse-listing', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const raw = await res.text();
    let message = 'Failed to parse listing';
    try {
      message = JSON.parse(raw).error || message;
    } catch {
      message = raw || message;
    }
    throw new Error(message);
  }

  return res.json();
}
