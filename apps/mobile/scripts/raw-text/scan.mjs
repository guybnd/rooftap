// Finds text that React Native would render outside a <Text>.
//
// React Native throws "Text strings must be rendered within a <Text>
// component" when a string or a number lands in a View. The dev build shows
// it as a console error and a release build can crash on it. Type checks and
// eslint do not see it, so this scan walks the JSX with the TypeScript type
// checker and reports:
//
// - raw JSX text inside a View-like element (`<View>hello</View>`)
// - an expression whose type is a string or a number inside a View-like
//   element (`<View>{label}</View>`)
// - a number on the left of `&&` (`<View>{count && <Row />}</View>` renders 0)
// - a string or a number passed to a component prop that the component
//   renders straight into a View (`<Box title="Hi" />`)
//
// "View-like" is a host View (View, Pressable, ScrollView, ...) or one of our
// own components whose `children` end up in one. A component that wraps
// string children in Text (Button, Pill, ListItemMeta) counts as safe when
// that wrapping sits behind a `typeof` check. ReactNode-typed values pass:
// the caller decides what goes in them, and the caller's own JSX is checked.
// An empty string is fine (React renders nothing for it).
//
// Put `raw-text-ok` in a comment on the line before to silence one finding.
import ts from 'typescript';
import path from 'node:path';

const HOST_VIEW = new Set([
  'View',
  'Pressable',
  'ScrollView',
  'SafeAreaView',
  'TouchableOpacity',
  'TouchableWithoutFeedback',
  'TouchableHighlight',
  'KeyboardAvoidingView',
  'LinearGradient',
  'BlurView',
  'Animated.View',
  'Animated.ScrollView',
  'GestureHandlerRootView',
]);
const HOST_TEXT = new Set(['Text', 'Animated.Text', 'TextInput']);

/**
 * @param {{ configPath: string, roots: string[], fileNames?: string[] }} opts
 * @returns {{ file: string, line: number, message: string }[]}
 */
export function scanRawText({ configPath, roots, fileNames }) {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.resolve(configPath), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  });
  if (!parsed) throw new Error(`Cannot read ${configPath}`);
  const program = ts.createProgram(fileNames ?? parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const rootDirs = roots.map((r) => path.resolve(r));
  const inRoots = (f) => rootDirs.some((r) => path.resolve(f).startsWith(r));

  /** @returns {Set<string>} */
  function kinds(t, out = new Set()) {
    if (t.isUnion()) {
      for (const x of t.types) kinds(x, out);
      return out;
    }
    const f = t.flags;
    if (f & ts.TypeFlags.StringLiteral) {
      if (t.value !== '') out.add('string');
    } else if (f & ts.TypeFlags.NumberLiteral) out.add('number');
    else if (f & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) out.add('string');
    else if (f & ts.TypeFlags.Number) out.add('number');
    else if (checker.isArrayType(t)) {
      const el = checker.getTypeArguments(t)[0];
      if (el) kinds(el, out);
    } else if (f & ts.TypeFlags.Object) out.add('node');
    return out;
  }

  /** @returns {string | null} why the expression renders text, or null */
  function exprText(e) {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = kinds(checker.getTypeAtLocation(e.left));
      if (!left.has('node') && left.has('number')) return 'a number before && renders 0';
      return exprText(e.right);
    }
    if (ts.isConditionalExpression(e)) return exprText(e.whenTrue) ?? exprText(e.whenFalse);
    const k = kinds(checker.getTypeAtLocation(e));
    if (k.has('node')) return null;
    if (k.has('string')) return 'a string';
    if (k.has('number')) return 'a number';
    return null;
  }

  function declOf(tagExpr) {
    let sym = checker.getSymbolAtLocation(tagExpr);
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const d = sym.declarations?.[0];
    if (!d || !inRoots(d.getSourceFile().fileName)) return null;
    if (ts.isFunctionDeclaration(d)) return d;
    if (ts.isVariableDeclaration(d) && d.initializer) {
      let init = d.initializer;
      // forwardRef(...) / memo(...)
      while (ts.isCallExpression(init) && init.arguments.length) init = init.arguments[0];
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
    }
    return null;
  }

  function guarded(n, stop) {
    for (let p = n.parent; p && p !== stop; p = p.parent) {
      const cond = ts.isConditionalExpression(p) ? p.condition : ts.isIfStatement(p) ? p.expression : null;
      if (cond && /typeof|isValidElement|Children\.|[wW]rap|every|some/.test(cond.getText())) return true;
    }
    return false;
  }

  function enclosingTag(n) {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxElement(p)) return p.openingElement.tagName;
      if (ts.isJsxSelfClosingElement(p) || ts.isJsxOpeningElement(p)) return p.tagName;
      if (ts.isFunctionLike(p)) return null;
    }
    return null;
  }

  const mentionsChildren = (n) => /\bchildren\b/.test(n.getText());
  /** `children`, `props.children`, a local built from them, or a `.map` item over one of those. */
  function isChildrenRef(e) {
    if (ts.isPropertyAccessExpression(e)) return e.name.text === 'children';
    if (!ts.isIdentifier(e)) return false;
    if (e.text === 'children') return true;
    const sym = checker.getSymbolAtLocation(e);
    const d = sym?.declarations?.[0];
    if (!d) return false;
    if (ts.isVariableDeclaration(d) && d.initializer) return mentionsChildren(d.initializer);
    if (ts.isParameter(d) && (ts.isArrowFunction(d.parent) || ts.isFunctionExpression(d.parent))) {
      const call = d.parent.parent;
      if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'map') {
        const recv = call.expression.expression;
        return ts.isIdentifier(recv) ? isChildrenRef(recv) : mentionsChildren(recv);
      }
    }
    return false;
  }

  /** @type {Map<ts.Node, 'text' | 'view' | 'unknown'>} */
  const classified = new Map();
  /** @returns {'text' | 'view' | 'unknown'} where a tag renders its children */
  function classifyTag(tagExpr) {
    const name = tagExpr.getText();
    if (HOST_TEXT.has(name)) return 'text';
    if (HOST_VIEW.has(name)) return 'view';
    const d = declOf(tagExpr);
    if (!d) return /Text$/.test(name) ? 'text' : 'unknown';
    if (classified.has(d)) return classified.get(d);
    classified.set(d, 'unknown'); // recursion guard
    const res = classifyComponent(d);
    classified.set(d, res);
    return res;
  }

  function classifyComponent(fn) {
    const p0 = fn.parameters[0];
    const destructuresChildren =
      p0 && ts.isObjectBindingPattern(p0.name)
        ? p0.name.elements.some((e) => (e.propertyName ?? e.name).getText() === 'children')
        : false;
    let result = 'unknown';
    const visit = (n) => {
      let sink = null;
      if (ts.isJsxExpression(n) && n.expression && isChildrenRef(n.expression) && !ts.isJsxAttribute(n.parent)) {
        if (!guarded(n, fn)) sink = enclosingTag(n);
      } else if (
        ts.isJsxSpreadAttribute(n) &&
        !destructuresChildren &&
        p0 &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === p0.name.getText()
      ) {
        sink = n.parent.parent.tagName;
      } else if (
        ts.isJsxAttribute(n) &&
        n.name.getText() === 'children' &&
        n.initializer &&
        ts.isJsxExpression(n.initializer) &&
        n.initializer.expression &&
        isChildrenRef(n.initializer.expression)
      ) {
        sink = n.parent.parent.tagName;
      }
      if (sink) {
        const c = classifyTag(sink);
        if (c === 'view') result = 'view';
        else if (c === 'text' && result === 'unknown') result = 'text';
      }
      ts.forEachChild(n, visit);
    };
    visit(fn);
    return result;
  }

  /** Where the children of a JsxElement or JsxFragment render. */
  function hostOf(n) {
    if (ts.isJsxElement(n)) return classifyTag(n.openingElement.tagName);
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxElement(p)) return classifyTag(p.openingElement.tagName);
      if (ts.isFunctionLike(p) || ts.isJsxAttribute(p)) return 'unknown';
    }
    return 'unknown';
  }

  /** @type {Map<ts.Node, Set<string>>} props a component renders straight into a View */
  const sinkProps = new Map();
  function viewProps(fn) {
    if (sinkProps.has(fn)) return sinkProps.get(fn);
    const out = new Set();
    sinkProps.set(fn, out);
    const p0 = fn.parameters[0];
    if (!p0 || !ts.isObjectBindingPattern(p0.name)) return out;
    const names = new Map();
    for (const el of p0.name.elements) if (ts.isIdentifier(el.name)) names.set(el.name.text, (el.propertyName ?? el.name).getText());
    const visit = (n) => {
      if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent)) {
        let e = n.expression;
        while (ts.isParenthesizedExpression(e)) e = e.expression;
        if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) e = e.right;
        if (
          ts.isBinaryExpression(e) &&
          (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        )
          e = e.left;
        if (ts.isIdentifier(e) && names.has(e.text) && e.text !== 'children' && !guarded(n, fn) && hostOf(n.parent) === 'view') {
          out.add(names.get(e.text));
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(fn);
    return out;
  }

  /** @type {{ file: string, line: number, message: string }[]} */
  const findings = [];
  for (const sf of program.getSourceFiles()) {
    if (!inRoots(sf.fileName) || !sf.fileName.endsWith('.tsx')) continue;
    if (/\.web\.tsx$|\.test\.tsx$/.test(sf.fileName)) continue;
    const lines = sf.text.split('\n');
    const report = (node, message) => {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
      if (line > 0 && lines[line - 1].includes('raw-text-ok')) return;
      findings.push({ file: sf.fileName, line: line + 1, message });
    };
    const visit = (n) => {
      if ((ts.isJsxElement(n) || ts.isJsxFragment(n)) && hostOf(n) === 'view') {
        const tag = ts.isJsxElement(n) ? n.openingElement.tagName.getText() : 'fragment';
        for (const c of n.children) {
          if (ts.isJsxText(c) && c.text.trim()) {
            report(c, `text "${c.text.trim().slice(0, 40)}" inside <${tag}>`);
          } else if (ts.isJsxExpression(c) && c.expression) {
            const why = exprText(c.expression);
            if (why) report(c, `${why} inside <${tag}>: {${c.expression.getText().replace(/\s+/g, ' ').slice(0, 60)}}`);
          }
        }
      }
      if (ts.isJsxAttribute(n) && n.initializer) {
        const opening = n.parent.parent;
        const d = declOf(opening.tagName);
        const prop = n.name.getText();
        if (d && viewProps(d).has(prop)) {
          const why = ts.isStringLiteral(n.initializer)
            ? 'a string'
            : ts.isJsxExpression(n.initializer) && n.initializer.expression
              ? exprText(n.initializer.expression)
              : null;
          if (why) report(n, `${why} in <${opening.tagName.getText()} ${prop}>, which renders it inside a View`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return findings;
}
