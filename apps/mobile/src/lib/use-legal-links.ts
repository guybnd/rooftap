import * as React from 'react';
import { resolveLegalLinks, type LegalLinks } from '@homeup/core';
import { fetchPublicConfig, type ServerSelection } from '@/lib/server-config';

/**
 * The server's Terms and Privacy Policy links for the sign-in and sign-up
 * screens, or null. The stored config may predate them, so this asks the
 * server again and uses the stored ones until it answers.
 */
export function useLegalLinks(server: ServerSelection | null | undefined): LegalLinks | null {
  const [raw, setRaw] = React.useState<unknown>(null);
  const origin = server?.origin;
  React.useEffect(() => {
    if (!server) return;
    let live = true;
    setRaw(server.config.legal ?? null);
    fetchPublicConfig(server.origin, 5000)
      .then((fresh) => {
        if (live) setRaw(fresh.legal ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // Only a change of server needs a new answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);
  return origin ? resolveLegalLinks(raw, origin) : null;
}
