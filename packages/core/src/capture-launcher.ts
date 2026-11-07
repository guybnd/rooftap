// The Capture sheet's add cells (Hearth §13.9): one group of cells with
// hairlines. Four across, or three when three fills every row and four
// would not, so the group never ends on a row of empty cells.

/** How many cells across the Capture launcher shows for `count` add actions. */
export function launcherColumns(count: number): 3 | 4 {
  if (count % 4 === 0) return 4;
  if (count % 3 === 0) return 3;
  // Otherwise the one that leaves fewer empty cells in the last row.
  return (4 - (count % 4)) <= (3 - (count % 3)) ? 4 : 3;
}
