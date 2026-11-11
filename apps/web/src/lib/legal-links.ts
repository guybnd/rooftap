import type { LegalLinks } from "@homeup/core";

// The Terms and Privacy Policy links this server shows under its sign-in
// buttons (sent in /api/public-config, so the phone shows them too).
// Hosted (Vercel) deployments link their own /terms and /privacy pages by
// default. A self-hosted server shows no line, because those pages describe
// the hosted service, unless its owner sets ROOFTAP_TERMS_URL and
// ROOFTAP_PRIVACY_URL to their own pages. ROOFTAP_LEGAL_LINKS=0 turns the
// line off anywhere.
export function serverLegalLinks(env: Record<string, string | undefined> = process.env): LegalLinks | null {
  const flag = env.ROOFTAP_LEGAL_LINKS?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return null;
  const termsUrl = env.ROOFTAP_TERMS_URL?.trim();
  const privacyUrl = env.ROOFTAP_PRIVACY_URL?.trim();
  if (termsUrl && privacyUrl) return { termsUrl, privacyUrl };
  return env.VERCEL ? { termsUrl: "/terms", privacyUrl: "/privacy" } : null;
}
