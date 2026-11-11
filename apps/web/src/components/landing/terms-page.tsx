import { LEGAL_CONTACT_EMAIL, LegalPage, type LegalSections } from "./legal-page";

// The Terms of the hosted service. The software itself is under the Elastic
// License 2.0; these terms do not cover a server that someone runs themselves.
const SECTIONS: LegalSections = [
  [
    "What these terms cover",
    [
      "These terms cover the hosted Rooftap service and the Rooftap apps when they connect to it. When you sign in, you agree to them.",
      "If you run Rooftap on your own server, these terms do not apply to that server. The software is under the Elastic License 2.0.",
    ],
  ],
  [
    "Your account",
    [
      "Give true details, and keep your password safe. You are responsible for what happens in your account.",
      "A household can have several members. The members see what you share with the household.",
    ],
  ],
  [
    "Your content",
    [
      "What you put in Rooftap stays yours. You let us store it and process it only to run the service for you.",
      "Do not upload anything that you do not have the right to share.",
    ],
  ],
  [
    "Fair use",
    [
      "Do not use Rooftap to break the law, to harm other people, or to send spam.",
      "Do not try to get into other households' data, overload the service, or get around its limits.",
    ],
  ],
  [
    "The Assistant",
    [
      "The Assistant uses AI and can make mistakes. Check what it tells you before you act on it.",
      "It does not give financial, legal or medical advice.",
    ],
  ],
  [
    "Connected services",
    [
      "When you connect another service, such as a calendar, a bank feed or a chat app, you let Rooftap read from it and write to it for the features that you turn on. That service's own terms also apply.",
    ],
  ],
  [
    "Price",
    ["The hosted service is free today. If we add a paid plan, we show you the price before you pay anything."],
  ],
  [
    "Changes to the service",
    [
      "We work to keep Rooftap running, but it can be down at times, and we can change or remove features.",
      "If we close the hosted service, we tell you at least 30 days before, so that you can take your data out.",
    ],
  ],
  [
    "Closing your account",
    [
      `You can stop using Rooftap at any time. To delete your account, email ${LEGAL_CONTACT_EMAIL}.`,
      "We can suspend or close an account that breaks these terms. Unless the problem is serious, we tell you first.",
    ],
  ],
  [
    "Our responsibility",
    [
      "Nothing in these terms takes away rights that you have under the Australian Consumer Law or other laws that cannot be excluded.",
      "Apart from those rights, we provide the service as it is. As far as the law allows, we are not responsible for indirect loss, such as lost data or lost profit.",
    ],
  ],
  [
    "Law",
    ["The laws of Australia apply to these terms."],
  ],
  [
    "Changes to these terms",
    [
      "If we change these terms in a way that matters to you, we tell you in the app before the change starts.",
      `Questions: ${LEGAL_CONTACT_EMAIL}.`,
    ],
  ],
];

export function TermsPage({ homeHref = "/" }: { homeHref?: string }) {
  return <LegalPage title="Terms" lede="The terms of the hosted Rooftap service. Last updated 9 November 2026." sections={SECTIONS} homeHref={homeHref} />;
}
