// HOUP-153: "Scan a recipe" — native orchestration for the photo -> Gemini
// parse -> draft recipe pipeline. Port of apps/web/src/lib/recipe-capture.ts:
// picks a photo (camera/library, HOUP-83's capture-flow.tsx pattern), reads
// it once as base64 (feeds both the parse request as a data URL and the
// upload as an ArrayBuffer via base64-arraybuffer's decode()), parses it via
// parse-recipe-api.ts, then builds the draft recipe + ingredient rows and
// persists the source photo via the documents store (entity_type='recipe').
//
// Mirrors the web module's `item`/`item_name` canonicalization (auto-link
// only 'exact'/'plural' tier matches) and its "no draft, no silent failure"
// contract: any failure before the draft is built throws and creates nothing.
//
// This module builds and returns the recipe/ingredient rows but does NOT
// write them to the legend-state store itself — `useStoreHelpers` is a React
// hook, so the caller (the recipes index screen) does that write, then opens
// the review sheet.
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GroceryItem, Recipe, RecipeIngredient } from '@homeup/core';
import {
  buildRecipe,
  buildRecipeIngredient,
  itemMatchLibrary,
  instructionsFromSteps,
  scannedItemName,
  stapleKeys,
  methodFields,
  stepsFromParsed,
  uploadDocument,
  linkDocument,
  listDocumentsForEntity,
  deleteDocument,
  validateDocumentMeta,
} from '@homeup/core';
import { parseRecipeFromImages, type ParsedRecipe } from './parse-recipe-api';

export type CaptureSource = 'camera' | 'library';

interface PickedPhoto {
  uri: string;
  filename: string;
  mimeType: string;
}

type PickResult = { photo: PickedPhoto } | { photo: null; permissionDenied: boolean };

async function pickPhoto(source: CaptureSource): Promise<PickResult> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { photo: null, permissionDenied: true };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
  if (result.canceled || !result.assets?.[0]) return { photo: null, permissionDenied: false };

  const asset = result.assets[0];
  return {
    photo: {
      uri: asset.uri,
      filename: asset.fileName ?? `recipe-scan-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
    },
  };
}

export interface CaptureRecipeResult {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
}

export interface CaptureRecipeFromPhotoArgs {
  supabase: SupabaseClient;
  groupId: string;
  createdBy: string | null;
  source: CaptureSource;
  /** Active grocery items + existing recipe ingredients — for name canonicalization. */
  groceryItems: GroceryItem[];
  existingIngredients: RecipeIngredient[];
  /** Household staples and taught names (useRecipeMatch); defaults when omitted. */
  staples?: ReadonlySet<string>;
  aliases?: ReadonlyMap<string, string>;
  /** The server has the `recipes.steps` column (server feature), so keep the parsed timers and links. */
  withSteps?: boolean;
}

/**
 * Pick a photo (camera or library), parse it via Gemini, build the draft
 * recipe + ingredient rows (not yet persisted to the store — see module
 * note), and upload+link the source photo. Returns `null` if the user
 * cancelled the picker (no error). Throws a user-presentable error on
 * permission denial or any failure after a photo was picked.
 */
export async function captureRecipeFromPhoto({
  supabase,
  groupId,
  createdBy,
  source,
  groceryItems,
  existingIngredients,
  staples,
  aliases,
  withSteps = false,
}: CaptureRecipeFromPhotoArgs): Promise<CaptureRecipeResult | null> {
  const picked = await pickPhoto(source);
  if (!picked.photo) {
    if (picked.permissionDenied) {
      throw new Error(
        source === 'camera'
          ? 'Camera access is needed to scan a recipe.'
          : 'Photo library access is needed to scan a recipe.',
      );
    }
    return null;
  }
  const { uri, filename, mimeType } = picked.photo;

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const body = decode(base64);
  const sizeBytes = body.byteLength;
  const validationError = validateDocumentMeta({ mimeType, sizeBytes });
  if (validationError) throw new Error(validationError);

  const libraryNames = itemMatchLibrary(groceryItems, existingIngredients);
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const parsed = (await parseRecipeFromImages([dataUrl], libraryNames)) as ParsedRecipe;
  if (!parsed.title && !parsed.ingredients?.length && !parsed.steps?.length) {
    throw new Error("Couldn't find a recipe in that photo. Try a clearer shot, or enter it manually.");
  }

  // Auto-link only the tiers safe to accept silently (exact norm /
  // singular-plural) — snap to the library entry's own display form.
  // Anything fuzzier (or no match) keeps Gemini's `item` guess as-is, a
  // fresh canonical name the match step asks about. A name the household
  // taught (an alias from an earlier "Same") links silently too.
  const ctx = {
    library: libraryNames,
    staples: staples ?? stapleKeys([]),
    aliases: aliases ?? new Map<string, string>(),
  };
  const itemNameFor = (candidateItem: string, line: string): string => scannedItemName(candidateItem, ctx, line);

  const recipe = buildRecipe({
    groupId,
    title: parsed.title || 'Scanned recipe',
    instructions: instructionsFromSteps(parsed.steps ?? []),
    servings: parsed.servings ?? null,
    prepMinutes: parsed.prep_minutes ?? null,
    cookMinutes: parsed.cook_minutes ?? null,
    source: parsed.source || filename,
    sourceType: 'photo',
    draft: true,
    createdBy,
  });

  // Keep each built row's id by its position in the parsed list, so the
  // structured steps' ingredient positions turn into ids.
  const idAt = new Map<number, string>();
  const ingredients = (parsed.ingredients ?? [])
    .map((ing, idx) => ({ ing, idx }))
    .filter(({ ing }) => ing.name.trim())
    .map(({ ing, idx }, position) => {
      const row = buildRecipeIngredient({
        recipeId: recipe.id,
        groupId,
        name: ing.name,
        itemName: itemNameFor(ing.item || ing.name, ing.name),
        quantity: ing.quantity ?? null,
        unit: ing.unit ?? null,
        position,
      });
      idAt.set(idx, row.id);
      return row;
    });

  // Recipes v2: timers, ingredient links and the original wording, when
  // this server can store them (an older server answers without them too).
  const steps = withSteps ? stepsFromParsed(parsed.structuredSteps, (i) => idAt.get(i)) : null;
  if (steps) Object.assign(recipe, methodFields(steps, true));

  const doc = await uploadDocument({
    supabase,
    groupId,
    input: { body, filename, mimeType, sizeBytes },
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
 * Soft-delete a draft recipe's source photo (Discard side-effect). Caller
 * handles the recipe/ingredient row soft-deletes (React store hooks); this
 * only handles the document side, which has no hook dependency.
 */
export async function discardRecipeDraftPhoto(supabase: SupabaseClient, recipeId: string): Promise<void> {
  const docs = await listDocumentsForEntity(supabase, 'recipe', recipeId);
  for (const doc of docs) {
    await deleteDocument(supabase, doc);
  }
}
