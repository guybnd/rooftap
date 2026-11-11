import type { Metadata } from "next";
import { SelfHostPage } from "@/components/landing/self-host-page";

// The self-host page the household landing page links to. Public, like /privacy.
const DESCRIPTION =
  "Run Rooftap on your own server: every tile for one household in one Postgres database, in Docker. The Assistant with the model you pick, an MCP server, Home Assistant. Free to self-host.";

export const metadata: Metadata = {
  title: "Self-host · Rooftap",
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "Rooftap", title: "Self-host Rooftap", description: DESCRIPTION, images: [{ url: "/landing/og.png", width: 1200, height: 630 }] },
};

export default function SelfHost() {
  return <SelfHostPage />;
}
