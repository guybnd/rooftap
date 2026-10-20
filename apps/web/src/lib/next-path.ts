// Post-login destination. Only same-site paths: anything that could leave the
// site ("//host", "/\host", absolute URLs) falls back to the home page.
export const NEXT_PATH_COOKIE = "rt_login_next";

export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
