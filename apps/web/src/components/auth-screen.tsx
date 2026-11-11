// The frame of the small signed-out account screens (sign up, reset a
// password, join a home, delete an account): centred, one column, the
// first-run header on top. Login and welcome keep their own frames.
import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">{children}</div>
    </main>
  );
}

/** The screen's one primary action, full width. */
export const AUTH_PRIMARY =
  "h-12 w-full rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";

/** A quiet text link under the form ("Sign in instead"). */
export function AuthLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline", className)}>
      {children}
    </Link>
  );
}

/** A short note in the screen's flow: what happened, or why a step can't run here. */
export function AuthNote({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "error" }) {
  return (
    <p role={tone === "error" ? "alert" : undefined} className={cn("px-1 text-center text-sm", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      {children}
    </p>
  );
}
