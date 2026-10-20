// FLUX-202: "Scan a recipe" — client orchestration for the photo -> Gemini
// parse -> draft recipe pipeline. Compresses the photo once (the same blob
// feeds both the parse request and the source-photo upload), parses it via
// `/api/parse-recipe`, then builds the draft recipe + ingredient rows and
// persists the source photo via the documents store (`entity_type='recipe'`,
// decision 4). Steps are folded into `instructions` as newline-delimited text
// (decision 5) via the shared `instructionsFromSteps` helper.
//
// FLUX-205: `name` keeps the full transcribed descriptor as Gemini returned it
// (the cooking-facing line); `item_name` is the canonical grocery item —
// Gemini's own `item` guess, snapped to an existing library name when
// `rankItemMatches` finds an exact/plural-tier hit (the tiers decision D3
// deems safe to auto-link silently). A fuzzier (subset/overlap) or no match
// keeps Gemini's raw `item` text as a fresh canonical name; the review sheet
// and quick-editor re-run the same ranker live to offer a suggestion chip.
//
// This module builds and returns the recipe/ingredient rows but does NOT
// write them to the legend-state store itself — `useStoreHelpers` is a React
// hook, so the caller (a page/component) does that write, then opens the
// review sheet. The source-photo upload+link has no such constraint and
// happens here, since the recipe id is already known (client-generated, per
// the local-first row-builder pattern).
//
// On any failure before the draft is built (bad photo, parse error, no
// recognizable recipe), nothing is created — no recipe row, no document
// upload — matching the "no draft, no silent failure" fallback.

import imageCompression from 'browser-image-compression';
import type { createClient } from '@/lib/supabase/client';
import type { GroceryItem, Recipe, RecipeIngredient } from '@homeup/core';
import {
  buildRecipe,
  buildRecipeIngredient,
  itemMatchLibrary,
  instructionsFromSteps,
  rankItemMatches,
} from '@homeup/core';
import { uploadDocument, linkDocument, listDocumentsForEntity, deleteDocument } from '@/lib/documents';
import type { ParsedRecipe } from '@/lib/ai/parser';

type SupabaseClient = ReturnType<typeof createClient>;

// Mirrors photo-gallery.tsx's COMPRESSION_OPTIONS (module-private there, so
// duplicated rather than imported — same precedent as `norm()` in recipes.ts).
const COMPRESSION_OPTIONS = {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
};

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface CaptureRecipeResult {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
}

export interface CaptureRecipeFromPhotoArgs {
  supabase: SupabaseClient;
  groupId: string;
  createdBy: string | null;
  file: File;
  /** Active grocery items + existing recipe ingredients — for name canonicalization. */
  groceryItems: GroceryItem[];
  existingIngredients: RecipeIngredient[];
}

/**
 * Compress the photo, parse it via Gemini, build the draft recipe + ingredient
 * rows (not yet persisted to the store — see module note), and upload+link
 * the source photo. Throws a user-presentable error on any failure.
 */
export async function captureRecipeFromPhoto({
  supabase,
  groupId,
  createdBy,
  file,
  groceryItems,
  existingIngredients,
}: CaptureRecipeFromPhotoArgs): Promise<CaptureRecipeResult> {
  const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
  const dataUrl = await fileToDataUrl(compressed);

  const libraryNames = itemMatchLibrary(groceryItems, existingIngredients);

  const res = await fetch('/api/parse-recipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: [dataUrl], libraryNames }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Recipe scan failed (${res.status})`);
  }

  const parsed = (await res.json()) as ParsedRecipe;
  if (!parsed.title && !parsed.ingredients?.length && !parsed.steps?.length) {
    throw new Error("Couldn't find a recipe in that photo. Try a clearer shot, or enter it manually.");
  }

  // FLUX-205 (decision D3): auto-link only the tiers safe to accept silently
  // (exact norm / singular-plural) — snap to the library entry's own display
  // form. Anything fuzzier (or no match) keeps Gemini's `item` guess as-is, a
  // fresh canonical name the review sheet can offer as an unconfirmed suggestion.
  const itemNameFor = (candidateItem: string): string => {
    const top = rankItemMatches(candidateItem, libraryNames)[0];
    if (top && (top.tier === 'exact' || top.tier === 'plural')) return top.name;
    return candidateItem.trim();
  };

  const recipe = buildRecipe({
    groupId,
    title: parsed.title || 'Scanned recipe',
    instructions: instructionsFromSteps(parsed.steps ?? []),
    servings: parsed.servings ?? null,
    prepMinutes: parsed.prep_minutes ?? null,
    cookMinutes: parsed.cook_minutes ?? null,
    source: parsed.source || file.name,
    sourceType: 'photo',
    draft: true,
    createdBy,
  });

  const ingredients = (parsed.ingredients ?? [])
    .filter((ing) => ing.name.trim())
    .map((ing, idx) =>
      buildRecipeIngredient({
        recipeId: recipe.id,
        groupId,
        name: ing.name,
        itemName: itemNameFor(ing.item || ing.name),
        quantity: ing.quantity ?? null,
        unit: ing.unit ?? null,
        position: idx,
      }),
    );

  const doc = await uploadDocument({
    supabase,
    groupId,
    file: compressed,
    docType: 'photo',
    source: 'other',
    title: recipe.title,
  });
  await linkDocument({
    supabase,
    documentId: doc.id,
    groupId,
    entityType: 'recipe',
    entityId: recipe.id,
  });

  return { recipe, ingredients };
}

/**
 * Soft-delete a draft recipe (Discard): tombstones the recipe + its ingredient
 * rows and unlinks/removes its source photo. Caller supplies the store
 * soft-delete helpers (React hooks) for the recipe/ingredient rows; this
 * function only handles the document side, which has no hook dependency.
 */
export async function discardRecipeDraftPhoto(
  supabase: SupabaseClient,
  recipeId: string,
): Promise<void> {
  const docs = await listDocumentsForEntity(supabase, 'recipe', recipeId);
  for (const doc of docs) {
    await deleteDocument(supabase, doc);
  }
}
