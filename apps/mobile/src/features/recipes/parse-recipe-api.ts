// HOUP-153: native calls to POST /api/parse-recipe (the AI recipe-parse
// backend at apps/web/src/app/api/parse-recipe/route.ts, now gated by
// getSessionUser() so a Bearer-only request authenticates). Same authedFetch
// pattern already established by
// apps/mobile/src/features/homesearch/parse-listing-api.ts /
// apps/mobile/src/features/calendar/calendar-api.ts: an absolute-origin
// fetch (native has no cookie jar for the web origin) with the current
// Supabase session's access token attached as `Authorization: Bearer`.
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
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

// Mirrors apps/web/src/lib/ai/parser.ts's ParsedRecipe/ParsedRecipeIngredient —
// that file lives in apps/web (imports Node-only provider SDKs), so the shape
// is duplicated here rather than imported.
export interface ParsedRecipeIngredient {
  name: string;
  /** The canonical grocery item this ingredient would be bought as. */
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

export async function parseRecipeFromImages(dataUrls: string[], libraryNames: string[]): Promise<ParsedRecipe> {
  const res = await authedFetch('/api/parse-recipe', {
    method: 'POST',
    body: JSON.stringify({ images: dataUrls, libraryNames }),
  });

  if (!res.ok) {
    const raw = await res.text();
    let message = 'Failed to parse recipe';
    try {
      message = JSON.parse(raw).error || message;
    } catch {
      message = raw || message;
    }
    throw new Error(message);
  }

  return res.json();
}
