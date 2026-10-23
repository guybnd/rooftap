// Guards the launch crash from #359 (fixed in #369): the worklets Babel
// plugin rewrites each `'worklet'` function into a `var` built where the
// function is declared, and that build captures every outside name the
// worklet uses. A helper worklet (or a const) declared further down is not
// there yet, so the native app throws "X is not a function" when the module
// loads. Function hoisting hides this on web and in vitest, which never run
// the plugin, so this test reads the source instead.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function isWorkletBody(body: ts.Node | undefined): boolean {
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'worklet';
}

/** The worklet a statement declares, as [name, body], or null. */
function workletOf(stmt: ts.Statement): [string, ts.Node] | null {
  if (ts.isFunctionDeclaration(stmt) && stmt.name && isWorkletBody(stmt.body)) return [stmt.name.text, stmt.body!];
  if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length === 1) {
    const d = stmt.declarationList.declarations[0];
    const init = d.initializer;
    if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && isWorkletBody(init.body)) {
      return [d.name.text, init.body];
    }
  }
  return null;
}

/** Names a statement declares that are not ready before it runs: worklets, and const/let bindings. */
function lateNames(stmt: ts.Statement): string[] {
  const w = workletOf(stmt);
  if (w) return [w[0]];
  if (ts.isVariableStatement(stmt) && stmt.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) {
    return stmt.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  }
  return [];
}

/** Every worklet that uses a name declared after it in the same scope. */
export function workletOrderProblems(file: string, source: string): string[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const problems: string[] = [];
  const visitScope = (stmts: readonly ts.Statement[]) => {
    stmts.forEach((stmt, i) => {
      const w = workletOf(stmt);
      if (!w) return;
      const later = new Set(stmts.slice(i + 1).flatMap(lateNames));
      const walk = (n: ts.Node) => {
        const p = n.parent;
        const isNameUse =
          ts.isIdentifier(n) &&
          later.has(n.text) &&
          !(ts.isPropertyAccessExpression(p) && p.name === n) &&
          !(ts.isPropertyAssignment(p) && p.name === n);
        if (isNameUse) problems.push(`${file}: worklet ${w[0]} uses ${n.text}, declared after it`);
        ts.forEachChild(n, walk);
      };
      walk(w[1]);
    });
  };
  const all = (n: ts.Node) => {
    if (ts.isSourceFile(n) || ts.isBlock(n) || ts.isModuleBlock(n)) visitScope(n.statements);
    ts.forEachChild(n, all);
  };
  all(sf);
  return problems;
}

describe('worklet declaration order', () => {
  it('flags a worklet that calls a helper declared below it', () => {
    const src = `export function edges() { 'worklet'; return clamp(1); }\nfunction clamp(v: number) { 'worklet'; return v; }`;
    expect(workletOrderProblems('x.ts', src)).toEqual(['x.ts: worklet edges uses clamp, declared after it']);
  });

  it('flags a const declared below a worklet that reads it', () => {
    const src = `const f = () => { 'worklet'; return K; };\nconst K = 1;`;
    expect(workletOrderProblems('x.ts', src)).toHaveLength(1);
  });

  it('passes helpers declared first, and plain functions in any order', () => {
    const src = `function clamp(v: number) { 'worklet'; return v; }\nexport function edges() { 'worklet'; return clamp(plain()); }\nfunction plain() { return 1; }`;
    expect(workletOrderProblems('x.ts', src)).toEqual([]);
  });

  it('holds in every file the mobile bundle compiles', () => {
    const files = execFileSync('git', ['grep', '-l', "'worklet'", '--', 'apps/mobile/src', 'packages/core/src', 'packages/ui/src'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((f) => workletOrderProblems(f, readFileSync(path.join(repoRoot, f), 'utf8')));
    expect(problems).toEqual([]);
  });
});
