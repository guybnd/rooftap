export function getCaptureLauncherCurrentKey(pathname: string, sectionId: string | undefined): string | null {
  if (matchesBase(pathname, "/checklist")) return "checklist";
  if (matchesBase(pathname, "/apartment")) return "apartment";
  if (matchesBase(pathname, "/appointments")) return "apartment";
  if (matchesBase(pathname, "/map")) return "apartment";
  if (matchesBase(pathname, "/homesearch")) return "apartment";

  switch (sectionId) {
    case "household":
      return "todo";
    case "costs":
      return "cost";
    case "documents":
      return "doc";
    case "groceries":
      return "grocery";
    case "calendar":
      return "calendar";
    case "recipes":
      return "recipe";
    case "checklists":
      return "new-checklist";
    default:
      return null;
  }
}

function matchesBase(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
