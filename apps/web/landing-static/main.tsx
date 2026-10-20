// Entry for the static landing page (npm run build:landing-static).
/// <reference types="vite/client" />
import { createRoot, hydrateRoot } from "react-dom/client";
import "../src/app/globals.css";
import "./fonts";
import { LandingPage } from "../src/components/landing/landing-page";
import { landingProps, mountHues } from "./shared";

mountHues();
const root = document.getElementById("root")!;
const page = <LandingPage {...landingProps()} />;
// The build prerenders the page into #root (prerender.mjs), so hydrate it; a dev server starts empty.
if (root.firstElementChild) hydrateRoot(root, page);
else createRoot(root).render(page);
