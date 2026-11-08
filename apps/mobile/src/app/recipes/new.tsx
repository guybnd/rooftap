// HOUP-93: native Recipes — the deep-linkable "new recipe" route (Home's first
// steps link here). It lands on the Recipes list with the New recipe sheet
// open, so the sheet has the list behind it instead of an empty screen. The
// + capture menu opens the same form over the current screen instead.
import * as React from 'react';
import { ActivityIndicator } from 'react-native';
import { ScreenBackground } from '@homeup/ui';
import { useOpenRoute } from '@/lib/tab-routes';

export default function NewRecipeScreen() {
  const openRoute = useOpenRoute();
  React.useEffect(() => {
    openRoute(`/recipes?new=${Date.now()}`);
  }, [openRoute]);
  return (
    <ScreenBackground className="items-center justify-center">
      <ActivityIndicator />
    </ScreenBackground>
  );
}
