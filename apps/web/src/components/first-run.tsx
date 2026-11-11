// The first-run screens' shared parts (Hearth §13.12): the Rooftap lede over
// a soft spectrum wash, and fields stacked in one group with hairlines
// between them. Used by sign-in and the first-user welcome. Native twin:
// apps/mobile/src/components/first-run.tsx.
import type { ReactNode } from "react";
import { RooftapHero } from "@/components/brand/rooftap-mark";
import { SIGN_IN_LEGAL_COPY, type LegalLinks } from "@homeup/core";
import { cn } from "@/lib/utils";

/** The mark, a headline and one line under it. */
export function FirstRunHeader({ title, lede, children }: { title: string; lede: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <RooftapHero />
      <h1 className="font-heading text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
      <p className="max-w-xs text-sm text-muted-foreground">{lede}</p>
      {children}
    </div>
  );
}

/** Fields as one group: one border round the lot, hairlines between. Give each field FIELD_IN_GROUP. */
export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card", className)}>{children}</div>
  );
}

export const FIELD_IN_GROUP = "block h-12 w-full bg-transparent px-4 text-sm placeholder:text-muted-foreground/70 focus:bg-accent/40 focus:outline-none";

/** The "or with email" rule between Google and the fields. */
export function OrRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border/60" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

/** The Terms and Privacy Policy line under the sign-in buttons, when the server sends links. */
export function LegalLine({ links }: { links: LegalLinks | null }) {
  if (!links) return null;
  const c = SIGN_IN_LEGAL_COPY;
  return (
    <p className="px-2 text-center text-xs leading-relaxed text-muted-foreground">
      {c.lead}{" "}
      <a href={links.termsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
        {c.terms}
      </a>{" "}
      {c.join}{" "}
      <a href={links.privacyUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
        {c.privacy}
      </a>
      .
    </p>
  );
}
