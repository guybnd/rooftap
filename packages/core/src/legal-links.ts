// The Terms and Privacy Policy links a server shows under its sign-in buttons.
// The server sends them in GET /api/public-config (`legal`), so the web and
// phone sign-in screens show the same line. A server that sends none (most
// self-hosted servers) shows no line.

export interface LegalLinks {
  termsUrl: string;
  privacyUrl: string;
}

/** The words of the sign-in line, shared by web and phone. */
export const SIGN_IN_LEGAL_COPY = {
  lead: "By continuing, you agree to the",
  terms: "Terms",
  join: "and the",
  privacy: "Privacy Policy",
} as const;

function absoluteHttpUrl(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim(), origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Reads `legal` from a server's public config. Relative paths resolve against
 * the server's origin. Returns null unless both links are valid http(s) URLs.
 */
export function resolveLegalLinks(legal: unknown, origin: string): LegalLinks | null {
  if (typeof legal !== "object" || legal === null) return null;
  const { termsUrl, privacyUrl } = legal as Record<string, unknown>;
  const terms = absoluteHttpUrl(termsUrl, origin);
  const privacy = absoluteHttpUrl(privacyUrl, origin);
  return terms && privacy ? { termsUrl: terms, privacyUrl: privacy } : null;
}
