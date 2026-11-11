"use client";

import { useEffect, useState } from "react";
import { resolveLegalLinks, type LegalLinks } from "@homeup/core";

/** This server's Terms and Privacy Policy links for the sign-in and sign-up screens (lib/legal-links.ts), or null. */
export function useLegalLinks(): LegalLinks | null {
  const [legal, setLegal] = useState<LegalLinks | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/public-config")
      .then((res) => res.json())
      .then((data) => {
        if (live) setLegal(resolveLegalLinks(data?.legal, window.location.origin));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return legal;
}
