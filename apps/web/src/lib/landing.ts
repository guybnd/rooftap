// Whether this deployment shows the public landing page at `/` to signed-out
// visitors. Hosted (Vercel) deployments do by default; a self-hosted server
// is somebody's home and keeps `/` going straight to sign-in. Either can be
// overridden with HOMEUP_LANDING_PAGE=1 or =0.
export function isLandingPageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.HOMEUP_LANDING_PAGE?.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return Boolean(env.VERCEL);
}
