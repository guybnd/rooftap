// HOUP-67: fails the build if any file under packages/core/src imports
// react-dom, next/*, or a web-app-relative `@/*` path — the boundary that
// keeps this package consumable by both apps/web and the future RN app.
// Run via `npm run lint` in this package (wired into `turbo run lint`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DISALLOWED_PATTERNS = [
  { name: "react-dom", re: /from\s+['"]react-dom(\/|['"])/ },
  { name: "next/*", re: /from\s+['"]next\// },
  { name: "@/* (apps/web path alias)", re: /from\s+['"]@\// },
  // Node builtins don't exist in the React Native runtime — importing one
  // anywhere in core breaks every native bundle (pat.ts's `crypto` import
  // hung the app on its splash screen before this rule existed).
  {
    name: "node builtin (breaks native bundles)",
    re: /from\s+['"](?:node:)?(?:assert|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|tls|tty|url|util|v8|vm|worker_threads|zlib)(\/|['"])/,
  },
  // Browser/web globals crash Hermes at RUNTIME (no import to catch):
  // crypto.randomUUID broke every create flow on-device before this rule.
  // Route platform needs through the StoreEnvironment seam instead.
  {
    name: "browser/web global usage (crashes Hermes at runtime)",
    re: /\b(?:crypto\.\w|window\.\w|document\.\w|localStorage\.\w|sessionStorage\.\w|navigator\.\w|new\s+FileReader)/,
    skipComments: true,
  },
];

/** Scan a directory tree for disallowed import specifiers. Returns a list of violations. */
export function scanDir(dir) {
  /** @type {{file: string, line: number, name: string, text: string}[]} */
  const violations = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      violations.push(...scanDir(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const content = fs.readFileSync(full, "utf8");
    content.split("\n").forEach((line, i) => {
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
      for (const { name, re, skipComments } of DISALLOWED_PATTERNS) {
        if (skipComments && isComment) continue;
        if (re.test(line)) violations.push({ file: full, line: i + 1, name, text: line.trim() });
      }
    });
  }
  return violations;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain || process.argv[1]?.endsWith("check-import-boundary.mjs")) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const SRC_DIR = path.resolve(__dirname, "..", "src");
  const violations = scanDir(SRC_DIR);
  for (const v of violations) {
    console.error(`${path.relative(process.cwd(), v.file)}:${v.line}: disallowed ${v.name} import — ${v.text}`);
  }
  if (violations.length > 0) {
    console.error(`\nimport-boundary check failed: ${violations.length} violation(s) in packages/core/src.`);
    process.exit(1);
  } else {
    console.log(`import-boundary check passed.`);
  }
}
