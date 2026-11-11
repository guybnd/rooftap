// Entry for the static self-host page.
/// <reference types="vite/client" />
import { createRoot, hydrateRoot } from "react-dom/client";
import "../src/app/globals.css";
import "./fonts";
import { SelfHostPage } from "../src/components/landing/self-host-page";
import { mountHues, selfHostProps } from "./shared";

mountHues();
const root = document.getElementById("root")!;
const page = <SelfHostPage {...selfHostProps()} />;
// The build prerenders the page into #root (prerender.mjs), so hydrate it; a dev server starts empty.
if (root.firstElementChild) hydrateRoot(root, page);
else createRoot(root).render(page);
