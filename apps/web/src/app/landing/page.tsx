import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

// The public front page. Signed-out visitors to `/` are rewritten here by
// middleware.ts (hosted deployments only; self-hosted servers keep `/` going
// straight to sign-in), so the address bar still shows `/`.
const DESCRIPTION =
  "One shared app for the tasks, groceries, costs, calendar, recipes, documents and checklists of a household. Free during the beta. A web app for every phone and computer, an Android app, an iPhone app coming soon.";

export const metadata: Metadata = {
  title: "Rooftap · Everything under one roof",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Rooftap",
    title: "Rooftap · Everything under one roof",
    description: DESCRIPTION,
    images: [{ url: "/landing/og.png", width: 1200, height: 630, alt: "Rooftap: Your home, your server. The Home and Groceries screens of the app." }],
  },
  twitter: { card: "summary_large_image", title: "Rooftap · Everything under one roof", description: DESCRIPTION, images: ["/landing/og.png"] },
};

export default function Landing() {
  return <LandingPage termsHref="/terms" />;
}
