// Cold-start: Metro doesn't tree-shake, so a single named import from the
// `lucide-react-native` barrel evaluates all ~1,640 icon modules (~1.2MB of
// path data) before the first frame, and the old icon-interop.ts then
// registered every one of them with NativeWind's cssInterop. The app uses
// ~150.
//
// This rewrites `import { Trash2 } from 'lucide-react-native'` into a direct
// import of that icon's own module, and registers just the imported icons
// (see src/lib/lucide-registry.ts) at the top of the importing module, so
// `className` tones keep working (HOUP-307) without loading the barrel.
// Applies to packages/ui too: babel.config.js is project-wide.
//
// Specifiers the barrel doesn't export at runtime can only be types
// (LucideIcon, LucideProps); they're dropped here rather than left for
// TypeScript's import elision, so no leftover statement can pull the barrel
// back in whatever the TS transform's settings.
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = 'lucide-react-native';
const REGISTRY = path.resolve(__dirname, 'src/lib/lucide-registry.ts');

// Built from lucide's own ESM barrel, so aliases (AlarmCheck ->
// alarm-clock-check.js) resolve exactly as the barrel would resolve them.
function readExportMap(barrelPath) {
  const source = fs.readFileSync(barrelPath, 'utf8');
  const map = new Map();
  const statement = /export \{([^}]*)\} from '\.\/([^']+)';/g;
  for (const [, specifiers, file] of source.matchAll(statement)) {
    for (const specifier of specifiers.split(',')) {
      const match = /^\s*default as (\w+)\s*$/.exec(specifier);
      if (match) map.set(match[1], `${PACKAGE}/dist/esm/${file}`);
    }
  }
  return map;
}

let defaultExportMap;
function getDefaultExportMap() {
  if (!defaultExportMap) {
    defaultExportMap = readExportMap(require.resolve(`${PACKAGE}/dist/esm/lucide-react-native.js`));
  }
  return defaultExportMap;
}

function lucideImportsPlugin({ types: t }, options = {}) {
  const registry = options.registry ?? REGISTRY;

  return {
    name: 'lucide-imports',
    visitor: {
      Program(programPath) {
        const exportMap = options.exportMap ?? getDefaultExportMap();
        const registered = [];
        let removedAny = false;

        for (const declaration of programPath.get('body')) {
          if (!declaration.isImportDeclaration()) continue;
          const { node } = declaration;
          if (node.source.value !== PACKAGE) continue;
          if (node.importKind === 'type') {
            // Erased by TypeScript anyway; dropped here so the rule "no
            // barrel import survives this plugin" holds on its own.
            declaration.remove();
            removedAny = true;
            continue;
          }

          const kept = [];
          const direct = [];
          let removedTypes = 0;
          for (const specifier of node.specifiers) {
            const importedName = t.isImportSpecifier(specifier)
              ? (specifier.imported.name ?? specifier.imported.value)
              : null;
            const file = importedName && specifier.importKind !== 'type' ? exportMap.get(importedName) : undefined;
            if (!file) {
              const isRuntimeExport = !importedName || importedName === 'icons';
              if (isRuntimeExport) kept.push(specifier);
              else removedTypes++;
              continue;
            }
            direct.push(
              t.importDeclaration([t.importDefaultSpecifier(t.identifier(specifier.local.name))], t.stringLiteral(file)),
            );
            registered.push(specifier.local.name);
          }

          if (direct.length === 0 && removedTypes === 0) continue;
          removedAny = true;
          if (kept.length > 0) {
            node.specifiers = kept;
            if (direct.length > 0) declaration.insertAfter(direct);
          } else if (direct.length > 0) {
            declaration.replaceWithMultiple(direct);
          } else {
            declaration.remove();
          }
        }

        if (registered.length === 0) {
          if (removedAny) programPath.scope.crawl();
          return;
        }
        const registerFn = programPath.scope.generateUidIdentifier('registerLucideIcons');
        const body = programPath.get('body');
        const lastImport = body.filter((p) => p.isImportDeclaration()).pop();
        const nodes = [
          t.importDeclaration(
            [t.importSpecifier(registerFn, t.identifier('registerLucideIcons'))],
            t.stringLiteral(registry),
          ),
          t.expressionStatement(
            t.callExpression(registerFn, [t.arrayExpression(registered.map((name) => t.identifier(name)))]),
          ),
        ];
        if (lastImport) lastImport.insertAfter(nodes);
        else programPath.unshiftContainer('body', nodes);
        // Rebind the moved specifiers so later passes (TypeScript's import
        // elision) see the new declarations, not the removed ones.
        programPath.scope.crawl();
      },
    },
  };
}

module.exports = lucideImportsPlugin;
module.exports.readExportMap = readExportMap;
