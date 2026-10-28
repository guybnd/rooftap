// Module row parts for the shared screens' slots (.docs/modules.md, section
// 17). A slot's entries draw with the screen's generic row; a module that
// needs a special look adds its trailing part here, keyed by module id, and
// every slot row (calendar agenda, Home feed and Now card) shows it.
// Native twin: apps/mobile/src/components/module-row-parts.tsx.
import type { ReactNode } from "react";
import { binLidsOf } from "@homeup/core";
import { BinLids } from "@/components/bin-lids";

type Detail = Readonly<Record<string, unknown>> | undefined;
type Trailing = (detail: Detail, className?: string) => ReactNode;

const TRAILING: Partial<Record<string, Trailing>> = {
  // Bin night: the lid colours collected that day.
  bins: (detail, className) => <BinLids lids={binLidsOf(detail)} className={className} />,
};

/** The module's own trailing part for a slot row, or nothing. */
export function ModuleRowTrailing({ moduleId, detail, className }: { moduleId: string; detail: Detail; className?: string }) {
  return <>{TRAILING[moduleId]?.(detail, className) ?? null}</>;
}
