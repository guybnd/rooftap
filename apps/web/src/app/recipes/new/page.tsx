'use client';

// FLUX-189: Recipes — the deep-linkable "new recipe" route (Home's first steps
// link here). It lands on the Recipes list with the New recipe sheet open, so
// the sheet has the list behind it instead of an empty page. The + capture
// menu opens the same form over the current page instead.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewRecipePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/recipes?new=1');
  }, [router]);
  return null;
}
