// Module row parts for the shared screens' slots (.docs/modules.md, section
// 17). A slot's entries draw with the screen's generic row; a module that
// needs a special look adds its trailing part here, keyed by module id, and
// every slot row (calendar agenda, Home feed and Now card) shows it.
// Web twin: apps/web/src/components/module-row-parts.tsx.
import * as React from 'react';
import { binLidsOf } from '@homeup/core';
import { BinLids } from '@/features/bins/bin-lids';

type Detail = Readonly<Record<string, unknown>> | undefined;
type Trailing = (detail: Detail) => React.ReactNode;

const TRAILING: Partial<Record<string, Trailing>> = {
  // Bin night: the lid colours collected that day.
  bins: (detail) => <BinLids lids={binLidsOf(detail)} size="sm" />,
};

/** The module's own trailing part for a slot row, or nothing. */
export function ModuleRowTrailing({ moduleId, detail }: { moduleId: string; detail: Detail }) {
  return <>{TRAILING[moduleId]?.(detail) ?? null}</>;
}
