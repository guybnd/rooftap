import type { Metadata } from "next";
import { TermsPage } from "@/components/landing/terms-page";

export const metadata: Metadata = {
  title: "Terms · Rooftap",
  description: "The terms of the hosted Rooftap service.",
};

export default function Terms() {
  return <TermsPage />;
}
