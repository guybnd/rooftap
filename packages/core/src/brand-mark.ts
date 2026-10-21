// The Rooftap mark (the open roof chevron and its tap dot), as geometry both
// apps draw in one colour: the + button wears it in the button's own
// foreground. The full-colour app icon (the spectrum roof on its dark tile)
// stays an asset. Square viewBox, cropped to the mark from the 1024 icon.
export const ROOFTAP_MARK = {
  viewBox: '172 163 680 680',
  roof: 'M232 560 L512 300 L792 560',
  roofStroke: 104,
  dot: { cx: 512, cy: 690, r: 86 },
} as const;
