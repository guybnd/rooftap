// HOUP-66: monorepo config — Metro's defaults only watch/resolve this app's
// own directory, so without this it cannot see `packages/*` workspace source
// or the repo root's hoisted `node_modules`.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// HOUP-240: git worktrees for this repo share their node_modules back to the
// main checkout via a symlink/junction to skip a full reinstall per worktree
// (see apps/mobile/README.md's local-build notes). That target's realpath
// sits outside monorepoRoot, so without this, Metro's crawler treats
// everything under it as outside the project and every module resolves to
// "could not be found within the project" -- no local Android build can run
// from a worktree at all. Watching the symlink's real target too fixes it;
// a no-op when node_modules is a real directory (the common case).
const nodeModulesLink = path.resolve(monorepoRoot, "node_modules");
const nodeModulesReal = fs.existsSync(nodeModulesLink) ? fs.realpathSync(nodeModulesLink) : nodeModulesLink;
config.watchFolders = nodeModulesReal === nodeModulesLink ? [monorepoRoot] : [monorepoRoot, path.dirname(nodeModulesReal)];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// HOUP-68: NativeWind's Metro plugin runs the Tailwind build (packages/ui's
// preset, see ../../packages/ui/tailwind-preset.js) against `input` and wires
// the generated stylesheet into every screen — this is what lets
// `packages/ui` components (and this app's own screens) use `className`.
module.exports = withNativeWind(config, { input: "./src/global.css" });
