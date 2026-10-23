'use client';

// The Recipes list row, shared by the Recipes page and the capture sheet's
// search results (so a recipe hit is the same line item, not a lookalike).
// Moved from apps/web/src/app/recipes/page.tsx.
// Native twin: apps/mobile/src/features/recipes/recipe-row.tsx.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  methodMeta,
  recipeHaveCount,
  canBeMade,
  recipeCuisines,
  type GroceryItem,
  type Recipe,
  type RecipeIngredient,
} from '@homeup/core';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { ListItem, ListItemLeading, ListItemContent, ListItemTitle, ListItemMeta } from '@/components/ui/list-item';

/** H3: ingredients-you-have progress, scoped to the row (~52px x 3px). */
function HaveMeter({ have, total }: { have: number; total: number }) {
  const pct = total > 0 ? Math.round((Math.min(have, total) / total) * 100) : 0;
  return (
    <span
      role="progressbar"
      aria-valuenow={have}
      aria-valuemin={0}
      aria-valuemax={total}
      className="inline-block h-[3px] w-[52px] shrink-0 overflow-hidden rounded-full bg-muted"
    >
      <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function RecipeRow({
  recipe,
  ingredients,
  groceryItems,
  groceriesLinked,
  staples,
  onNavigate,
  onEdit,
  onDelete,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  groceryItems: GroceryItem[];
  /** recipes.groceries: the have/need fill and "Can make now" only show while it's on. */
  groceriesLinked: boolean;
  /** Household staples (useRecipeMatch): count as have. */
  staples?: ReadonlySet<string>;
  /** Runs before the descend navigation, e.g. the capture sheet closing itself. */
  onNavigate?: () => void;
  /** The row menu's Edit and Delete; omitted ones are left out. */
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const meta = methodMeta(recipe.method);
  const { have, total } = recipeHaveCount(ingredients, groceryItems, staples);
  const ready = groceriesLinked && canBeMade(ingredients, groceryItems, staples);
  const router = useRouter();
  const href = `/recipes/${recipe.id}`;
  // Plain meta words (pill shape is reserved for tappable chips, PC1): the
  // method when one is set, then the cuisines.
  const kind = [...(recipe.method ? [meta.label] : []), ...recipeCuisines(recipe).map(capitalize)].join(', ');

  // Hearth §13.7 "Row menu": right-click with a mouse.
  const rowMenu = useRowContextMenu(() => ({
    title: recipe.title,
    kind: 'Recipe',
    actions: [
      {
        id: 'open',
        label: 'Open',
        group: 'open',
        icon: 'open',
        run: () => {
          onNavigate?.();
          router.push(href);
        },
      },
      { id: 'copy', label: 'Copy link', group: 'share', icon: 'copy', run: () => void navigator.clipboard?.writeText(new URL(href, window.location.href).toString()) },
      onEdit && { id: 'edit', label: 'Edit recipe', group: 'edit', icon: 'edit', run: onEdit },
      onDelete && { id: 'delete', label: 'Delete', group: 'danger', icon: 'delete', danger: true, run: onDelete },
    ],
  }));

  return (
    <>
    {/* The menu sits beside the row, not in it: a click inside it must not reach the link. */}
    {rowMenu.menu}
    <ListItem asChild onContextMenu={rowMenu.onContextMenu}>
      {/* Hearth §8.1: descend — destination slides in from the right, this
          list draws back ~30% + dims. */}
      <Link
        href={href}
        onClick={(e) => {
          onNavigate?.();
          navLinkClickHandler('descend', router, href)(e);
        }}
      >
        {/* The method glyph is the recipe's own content glyph (Hearth
            tenants), like a grocery's produce glyph. */}
        <ListItemLeading className="h-9 w-9 rounded-xl bg-muted text-lg">
          {meta.emoji}
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle>
            <span className="truncate">{recipe.title}</span>
          </ListItemTitle>
          <ListItemMeta className="gap-x-2.5">
            {kind && <span className="truncate">{kind}</span>}
            {ready ? (
              <span className="font-medium text-success">Can make now</span>
            ) : groceriesLinked && total > 0 ? (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                {have}/{total} have
                <HaveMeter have={have} total={total} />
              </span>
            ) : null}
          </ListItemMeta>
        </ListItemContent>
      </Link>
    </ListItem>
    </>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
