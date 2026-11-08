// The "New recipe" form as a sheet over whatever screen is open. The + capture
// menu opens it in place, so the screen behind stays put and nothing navigates
// until the person asks to open the saved recipe.
import * as React from 'react';
import { useNewRecipe, type Recipe } from '@homeup/core';
import { RecipeFormSheet } from './recipe-form-sheet';

interface NewRecipeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  currentUserId: string | null | undefined;
  /** Called after the recipe and its ingredients are written. */
  onSaved?: (recipe: Recipe) => void;
}

export function NewRecipeSheet({ open, onOpenChange, groupId, currentUserId, onSaved }: NewRecipeSheetProps) {
  const { groceryItems, allIngredients, cuisineSuggestions, saveRecipe } = useNewRecipe(groupId, currentUserId);
  return (
    <RecipeFormSheet
      open={open}
      onOpenChange={onOpenChange}
      groupId={groupId}
      groceryItems={groceryItems}
      allIngredients={allIngredients}
      cuisineSuggestions={cuisineSuggestions}
      onSave={(recipe, ingredients) => {
        saveRecipe(recipe, ingredients);
        onSaved?.(recipe);
      }}
    />
  );
}
