'use client';

// The "New recipe" form as a sheet over whatever page is open. The + capture
// menu opens it in place, so the page behind stays put and nothing navigates
// until the person asks to open the saved recipe.

import { useNewRecipe, type Recipe } from '@homeup/core';
import { RecipeFormSheet } from './recipe-form-sheet';

interface NewRecipeSheetProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  currentUserId: string | null | undefined;
  /** Called after the recipe and its ingredients are written. */
  onSaved?: (recipe: Recipe) => void;
}

export function NewRecipeSheet({ isOpen, onClose, groupId, currentUserId, onSaved }: NewRecipeSheetProps) {
  const { groceryItems, allIngredients, cuisineSuggestions, saveRecipe } = useNewRecipe(groupId, currentUserId);
  return (
    <RecipeFormSheet
      isOpen={isOpen}
      groupId={groupId}
      groceryItems={groceryItems}
      allIngredients={allIngredients}
      cuisineSuggestions={cuisineSuggestions}
      onClose={onClose}
      onSave={(recipe, ingredients) => {
        saveRecipe(recipe, ingredients);
        onSaved?.(recipe);
      }}
    />
  );
}
