// A grocery item or aisle glyph drawn from core's Fluent Emoji Flat set, so
// Android, iOS and web all show the same art instead of each device's emoji
// font. Content, not chrome: Hearth exempts grocery glyphs from the emoji ban.
import * as React from 'react';
import { Text, View } from 'react-native';
import { SvgAst, parse, type JsxAST } from 'react-native-svg';
import { greyscaleSvg, groceryGlyphSvg } from '@homeup/core';
import { useThemeMaterial } from '../theme/theme-provider';

export interface GroceryGlyphProps {
  /** An emoji from getGroceryEmoji or AISLE_META. */
  emoji: string;
  /** Rendered width and height in px. */
  size?: number;
}

// Parsed once per glyph for the whole app: SvgXml re-parses its string on
// every mount, which made a long grocery list (Home's Groceries filter) slow
// to open. The e-paper theme draws the same art in greys.
const astCache = new Map<string, JsxAST | null>();
function glyphAst(emoji: string, grey: boolean): JsxAST | null {
  const key = grey ? `grey:${emoji}` : emoji;
  let ast = astCache.get(key);
  if (ast === undefined) {
    const xml = groceryGlyphSvg(emoji);
    try {
      ast = xml ? parse(grey ? greyscaleSvg(xml) : xml) : null;
    } catch {
      ast = null;
    }
    astCache.set(key, ast);
  }
  return ast;
}

export const GroceryGlyph = React.memo(function GroceryGlyph({ emoji, size = 20 }: GroceryGlyphProps) {
  const { still } = useThemeMaterial();
  const ast = glyphAst(emoji, still);
  return (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {ast ? (
        <SvgAst ast={ast} override={{ width: size, height: size }} />
      ) : (
        <Text style={{ fontSize: size * 0.85, lineHeight: size }}>{emoji}</Text>
      )}
    </View>
  );
});
