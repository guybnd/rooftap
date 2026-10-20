// Modules (.docs/modules.md): a switched-off module has no screens. Any route
// that belongs to one (a tab root, a detail screen, a deep link or a push
// notification landing on it) bounces to Home, the same as web's sidebar
// guard in apps/web/src/components/app-sidebar.tsx. Platform routes (home,
// settings, login, server picker) map to no module and are never touched.
import * as React from 'react';
import { usePathname, useRouter } from 'expo-router';
import { getModuleIdForPath, useModules } from '@homeup/core';

export function useModuleRouteGuard(): void {
  const router = useRouter();
  const pathname = usePathname();
  const modules = useModules();

  const routeModuleId = getModuleIdForPath(pathname);
  const routeModuleOff = routeModuleId !== null && !modules.isSectionEnabled(routeModuleId);

  React.useEffect(() => {
    if (routeModuleOff) router.replace('/home');
  }, [routeModuleOff, router]);
}
