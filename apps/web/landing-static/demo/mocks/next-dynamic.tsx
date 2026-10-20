// next/dynamic for the screen demo: the maps never render in a screenshot.
import type { ComponentType } from "react";

export default function dynamic<P extends object>(_loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>): ComponentType<P> {
  return function Dynamic() {
    return null;
  };
}
