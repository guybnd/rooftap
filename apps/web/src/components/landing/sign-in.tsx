"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import styles from "./landing.module.css";

// Where "Sign in" goes. The app serves the page next to /login. The static
// copy for GitHub Pages (landing-static/, where next/link is a plain <a>)
// points at the hosted app, or passes null to hide the buttons.
export const SignInHref = createContext<string | null>("/login");

export function SignIn({ ghost = false }: { ghost?: boolean }) {
  const href = useContext(SignInHref);
  if (!href) return null;
  return (
    <Link href={href} className={ghost ? styles.ghost : styles.button}>
      Sign in
    </Link>
  );
}
