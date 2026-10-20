// HOUP-68: NativeWind's babel preset intercepts `className` on RN primitives
// (View/Text/Pressable) and rewrites it to `style` at build time — required
// on native (there is no CSS engine there); web/RNW uses the compiled
// stylesheet directly and doesn't need this transform, but it's harmless
// there too. `react-native-reanimated/plugin` MUST be listed last (Reanimated
// requirement) — it rewrites `worklet` functions app-wide.
// `./babel-plugin-lucide-imports` turns lucide barrel imports into per-icon
// imports so cold start doesn't evaluate all ~1,640 icons (see that file).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: ['./babel-plugin-lucide-imports', 'react-native-reanimated/plugin'],
  };
};
