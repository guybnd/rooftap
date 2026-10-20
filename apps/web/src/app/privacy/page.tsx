import type { Metadata } from "next";
import { PrivacyPage } from "@/components/landing/privacy-page";

export const metadata: Metadata = {
  title: "Privacy · Rooftap",
  description: "What Rooftap stores, and which providers it calls.",
};

export default function Privacy() {
  return <PrivacyPage />;
}
