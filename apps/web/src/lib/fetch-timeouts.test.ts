// Every server-side fetch to another service carries a timeout.
//
// A route that waits on a slow service holds its request until the platform
// kills it: Shopper sat on "Checking prices" (#428), the Scout pick sheet sat
// on "Adding" while a route awaited every price source (#499), and Assistant
// turns ran into a bare 504 (#457). A fetch with
// `signal: AbortSignal.timeout(ms)` fails fast instead, and the caller can say
// so. Work slower than the reply belongs in `after()`.
//
// Browser code (a 'use client' file, or a fetch to a relative /api path) is
// left out: the person can leave the screen.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

/** Browser-only modules with no 'use client' line, whose fetches go to the app's own API. */
const BROWSER_ONLY = new Set(["apps/web/src/lib/bins-api.ts"]);

function serverFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "apps/web/src/app/api", "apps/web/src/lib"], { cwd: repoRoot, encoding: "utf8" });
  return out
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !BROWSER_ONLY.has(f));
}

function isRelativePath(arg: ts.Expression | undefined): boolean {
  if (!arg) return false;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text.startsWith("/");
  if (ts.isTemplateExpression(arg)) return arg.head.text.startsWith("/");
  return false;
}

function hasSignal(arg: ts.Expression | undefined): boolean {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  return arg.properties.some((p) => ts.isSpreadAssignment(p) || (p.name !== undefined && p.name.getText() === "signal"));
}

describe("server fetch timeouts", () => {
  it("gives every outside fetch a signal", () => {
    const missing: string[] = [];
    for (const file of serverFiles()) {
      const src = readFileSync(path.join(repoRoot, file), "utf8");
      if (/^\s*['"]use client['"]/.test(src)) continue;
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
          const [target, init] = node.arguments;
          if (!isRelativePath(target) && !hasSignal(init)) {
            missing.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(missing, "Add signal: AbortSignal.timeout(ms) to these fetch calls").toEqual([]);
  });
});
