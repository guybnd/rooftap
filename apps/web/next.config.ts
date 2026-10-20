import withSerwistInit from "@serwist/next";
import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import path from "node:path";

// FLUX-1546: `/~offline`'s HTML is server-rendered App Router output, which
// @serwist/next's manifest scan excludes (only the public/ dir is globbed;
// `server/`-prefixed build assets are skipped) — so it never lands in the
// precache manifest on its own, and the `fallbacks` entry in sw.ts pointing at
// it would have nothing to serve. `manifestTransforms` APPENDS an entry to
// that glob-based manifest (unlike `additionalPrecacheEntries`, which
// REPLACES it outright — silently dropping every public/ icon + manifest.json
// entry). The rendered `/~offline` HTML embeds hashed `<script>` tags for the
// whole client bundle (chunk hashes, buildId), so its revision must turn over
// whenever ANY precached asset does — not just the route's own two source
// files (that undercounted every shared layout/provider/component the shell
// also depends on). Deriving it from the manifest itself, inside
// `manifestTransforms`, ties the revision to exactly the set of assets that
// can change what this document renders.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  // FLUX-1547: also populate the document/RSC caches on client-side (next/link)
  // navigations, not only cold document loads.
  cacheOnNavigation: true,
  manifestTransforms: [
    (entries) => {
      const offlineShellRevision = createHash("md5")
        .update(entries.map((entry) => `${entry.url}|${entry.revision ?? ""}`).join("\n"))
        .digest("hex");
      return {
        // `size` only feeds Serwist's total-precache-size logging/warnings, not
        // cache correctness — the real response bytes are fetched fresh at
        // SW-install time, so an approximate size here (0) is fine.
        manifest: [...entries, { url: "/~offline", revision: offlineShellRevision, size: 0 }],
      };
    },
  ],
});

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Self-hosting (FLUX-1561): produces .next/standalone + .next/static, which
  // the Dockerfile copies into the runner stage instead of shipping node_modules.
  output: "standalone",
  // HOUP-66: workspace packages ship raw .ts (no build step) — Next only
  // transpiles workspace packages named here.
  transpilePackages: ["@homeup/core", "@homeup/ui"],
  // HOUP-66: standalone tracing defaults to this app's own directory; without
  // pointing it at the monorepo root, hoisted root node_modules deps get
  // dropped from the standalone output. See Dockerfile for the corresponding
  // nested COPY/CMD paths this produces.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Self-hosting (HOUP-309): Supabase Storage-served photos come from
      // whatever NEXT_PUBLIC_SUPABASE_URL points at. The stock self-host
      // default is http://localhost:8000 — deriving protocol AND hostname
      // (not hostname alone) matters because a hardcoded "https" would 400
      // every Supabase-stored photo on that default. Build-time only (this
      // file runs at `next build`, and Dockerfile ARG/ENV-exports the var
      // first); wrapped in try/catch so a malformed value can't break the
      // build.
      ...(() => {
        try {
          const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:8000");
          return [
            {
              protocol: url.protocol.replace(":", "") as "http" | "https",
              hostname: url.hostname,
              ...(url.port ? { port: url.port } : {}),
            },
          ];
        } catch {
          return [];
        }
      })(),
    ],
  },
  serverExternalPackages: ["pdfjs-dist"],
  async redirects() {
    return [
      // The Home Search section's route was renamed from /dashboard to /homesearch
      // ("dashboard" now refers to the /home hub). Keep old links/bookmarks working.
      { source: "/dashboard", destination: "/homesearch", permanent: true },
    ];
  },
  experimental: {
    // Tree-shake lucide-react icon imports so only used icons land in the bundle.
    optimizePackageImports: ["lucide-react"],
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    // HOUP-68: resolve `react-native` imports to react-native-web (Metro's
    // default for apps/mobile) so @homeup/ui's RN-primitive components
    // (View/Text/Pressable + NativeWind) can resolve under webpack too.
    // `.web.*` gets extension priority the same way Metro's platform
    // resolver does. No apps/web page imports @homeup/ui yet (see HOUP-68),
    // so this is inert groundwork today, not a behavior change.
    config.resolve.alias["react-native$"] = "react-native-web";
    config.resolve.extensions = [
      ".web.js",
      ".web.jsx",
      ".web.ts",
      ".web.tsx",
      ...(config.resolve.extensions ?? []),
    ];
    return config;
  },
};

export default withAnalyzer(withSerwist(nextConfig));
