// Ambient declaration for side-effect CSS imports (globals.css, mapbox-gl's
// own stylesheet, etc.). Next.js's build pipeline resolves these itself via
// its webpack/turbopack CSS loader regardless of what TypeScript thinks, so
// `next build` never needed this. A bare `tsc --noEmit` outside that pipeline
// (our own `npm run typecheck`) doesn't get the same leniency and flags them
// as unresolvable modules.
declare module "*.css";
