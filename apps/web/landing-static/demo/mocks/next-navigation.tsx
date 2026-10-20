// next/navigation for the screen demo: the route comes from the scene, and in
// the live demo the router moves it.
import { back, navigate, useDemoRoute } from "../route";

const router = {
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href),
  prefetch: () => {},
  back: () => back(),
  forward: () => {},
  refresh: () => {},
};

export const useRouter = () => router;
export const usePathname = () => useDemoRoute().path;
export const useSelectedLayoutSegment = () => useDemoRoute().path.split("/")[1] ?? null;
export const useSearchParams = () => new URLSearchParams(useDemoRoute().search);
export const useParams = <T,>() => useDemoRoute().params as T;
export const redirect = () => {};
export const notFound = () => {};
