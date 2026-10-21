// The route the demo pretends to be on. A screenshot scene sets it before
// mount; the live demo (?live=1) changes it as people tap links.
import { useSyncExternalStore } from "react";

export interface DemoRoute {
  path: string;
  search: string;
  params: Record<string, string>;
}

let route: DemoRoute = { path: "/home", search: "", params: {} };
const listeners = new Set<() => void>();

export function setDemoRoute(next: DemoRoute) {
  route = next;
  listeners.forEach((l) => l());
}

export function demoRoute(): DemoRoute {
  return route;
}

/** The route, re-rendering on each change. */
export function useDemoRoute(): DemoRoute {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    demoRoute,
    demoRoute
  );
}

/** Pages with an id in the path; the rest have none. */
const PARAM_ROUTES: ReadonlyArray<[prefix: string, name: string]> = [
  ["/recipes/", "id"],
  ["/checklists/", "id"],
  ["/shopper/", "id"],
];

const history: DemoRoute[] = [];

export function back() {
  const prev = history.pop();
  if (prev) setDemoRoute(prev);
}

export function navigate(href: string) {
  const url = new URL(href, "https://demo.invalid");
  const path = url.pathname.replace(/\/$/, "") || "/home";
  const params: Record<string, string> = {};
  for (const [prefix, name] of PARAM_ROUTES) {
    if (path.startsWith(prefix) && path.length > prefix.length) params[name] = path.slice(prefix.length);
  }
  history.push(route);
  setDemoRoute({ path: path === "/" ? "/home" : path, search: url.search, params });
  window.scrollTo(0, 0);
}
