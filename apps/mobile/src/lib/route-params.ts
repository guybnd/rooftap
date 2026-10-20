// HOUP-110: expo-router's useLocalSearchParams() types a query param as
// `string | string[] | undefined` (a repeated key like `?add=1&add=1`
// resolves to an array) — every screen that reads a `?flag=1` deep-link
// param needs to unwrap that before comparing. Shared so the widget's
// `?add=1` deep-links (tasks/index.tsx, groceries/index.tsx) have one
// tested definition of "is this flag actually set" instead of two
// hand-rolled copies.
export function isFlagParamSet(param: string | string[] | undefined): boolean {
  return (Array.isArray(param) ? param[0] : param) === '1';
}
