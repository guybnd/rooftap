// Entry for the static privacy page.
/// <reference types="vite/client" />
import { createRoot, hydrateRoot } from "react-dom/client";
import "../src/app/globals.css";
import "./fonts";
import { PrivacyPage } from "../src/components/landing/privacy-page";
import { mountHues } from "./shared";

mountHues();
const root = document.getElementById("root")!;
const page = <PrivacyPage homeHref="./" />;
if (root.firstElementChild) hydrateRoot(root, page);
else createRoot(root).render(page);
