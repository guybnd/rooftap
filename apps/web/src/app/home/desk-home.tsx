'use client';

// Hearth §13.7 "Desktop shell" (Guy, 2026-10-22): Home on a wide screen is a
// free grid of modules (desk-arrangement.ts). Arrange leaves every module at
// its real size and adds a grip inside its top corner to drag it by, and
// handles on its edges to resize it. A module fits its content until you
// pull its height; then it keeps that height and scrolls, and Fit hands the
// height back to the content. Done keeps the grid on this browser. Outside
// Arrange nothing drags, so taps and right-clicks work as before.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout, type ResizeHandleAxis } from 'react-grid-layout';
import { GripVertical, MoveVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DEFAULT_DESK_ITEMS,
  DESK_COLS,
  DESK_GAP_PX,
  DESK_MIN_H,
  DESK_MIN_W,
  DESK_ROW_PX,
  mergeLayout,
  readDeskItems,
  rowsForHeight,
  saveDeskItems,
  type DeskItem,
} from './desk-arrangement';

export interface DeskModule {
  label: string;
  /**
   * Null when the module is off or hidden; it keeps its place for when it
   * returns. A function gets the module's width in columns, for one that lays
   * out differently when narrow (the week board turns into the feed).
   */
  node: ReactNode | ((cols: number) => ReactNode) | null;
}

const HANDLES: ResizeHandleAxis[] = ['e', 'w', 's', 'se', 'sw'];

export function DeskHome({ modules }: { modules: Record<string, DeskModule> }) {
  const [items, setItems] = useState<DeskItem[]>(DEFAULT_DESK_ITEMS);
  const [arranging, setArranging] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();
  // Read after mount so the server render and the first paint agree.
  useEffect(() => setItems(readDeskItems()), []);

  const shown = items.filter((it) => modules[it.i]?.node);
  const layout: Layout = shown.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: DESK_MIN_W, minH: DESK_MIN_H }));

  // A fitting module reports its content height; its rows follow it.
  const onMeasure = useCallback((id: string, px: number) => {
    setItems((prev) => {
      const rows = rowsForHeight(px);
      const it = prev.find((p) => p.i === id);
      if (!it || !it.fit || it.h === rows) return prev;
      return prev.map((p) => (p.i === id ? { ...p, h: rows } : p));
    });
  }, []);

  // Only a drag or a resize moves modules. Outside Arrange the grid's own
  // echoes are ignored, so a measured height can't bounce off a stale one.
  const onLayoutChange = (next: Layout) => {
    if (arranging) setItems((prev) => mergeLayout(prev, next));
  };

  // Pulling a height by hand pins it; a width-only pull leaves fit alone.
  const onResizeStop = (_layout: Layout, oldItem: { i: string; h: number } | null, newItem: { i: string; h: number } | null) => {
    if (!oldItem || !newItem || oldItem.h === newItem.h) return;
    setItems((prev) => prev.map((p) => (p.i === newItem.i ? { ...p, h: newItem.h, fit: false } : p)));
  };

  const fit = (id: string) => setItems((prev) => prev.map((p) => (p.i === id ? { ...p, fit: true } : p)));
  const finish = () => {
    saveDeskItems(items);
    setArranging(false);
  };
  const reset = () => {
    saveDeskItems(null);
    setItems(DEFAULT_DESK_ITEMS);
  };

  const pill =
    'inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="space-y-3">
      <div className="flex h-8 items-center justify-end gap-2">
        {arranging && <p className="mr-auto px-1 text-xs text-muted-foreground">Drag a module by its grip. Pull an edge to resize it.</p>}
        {arranging && (
          <button type="button" onClick={reset} className={cn(pill, 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={arranging ? finish : () => setArranging(true)}
          aria-pressed={arranging}
          className={cn(
            pill,
            arranging ? 'bg-primary text-primary-foreground hover:bg-primary/80' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {arranging ? 'Done' : 'Arrange'}
        </button>
      </div>
      <div ref={containerRef} className={cn('desk-grid -mx-2.5', arranging && 'desk-arranging select-none')}>
        {mounted && (
          <ReactGridLayout
            layout={layout}
            width={width}
            gridConfig={{ cols: DESK_COLS, rowHeight: DESK_ROW_PX, margin: [20, 0], containerPadding: [0, 0] }}
            dragConfig={{ enabled: arranging, handle: '.desk-grip', threshold: 4 }}
            resizeConfig={{
              enabled: arranging,
              handles: HANDLES,
              handleComponent: (axis, ref) => <span ref={ref} className={`desk-resize desk-resize-${axis}`} />,
            }}
            compactor={verticalCompactor}
            onLayoutChange={onLayoutChange}
            onResizeStop={onResizeStop}
          >
            {shown.map((it) => (
              <div key={it.i}>
                <DeskCell
                  id={it.i}
                  label={modules[it.i].label}
                  cols={it.w}
                  fit={it.fit}
                  arranging={arranging}
                  onMeasure={onMeasure}
                  onFit={() => fit(it.i)}
                >
                  {renderNode(modules[it.i].node, it.w)}
                </DeskCell>
              </div>
            ))}
          </ReactGridLayout>
        )}
      </div>
    </div>
  );
}

function renderNode(node: DeskModule['node'], cols: number): ReactNode {
  return typeof node === 'function' ? node(cols) : node;
}

function DeskCell({
  id,
  label,
  cols,
  fit,
  arranging,
  onMeasure,
  onFit,
  children,
}: {
  id: string;
  label: string;
  cols: number;
  fit: boolean;
  arranging: boolean;
  onMeasure: (id: string, px: number) => void;
  onFit: () => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || !fit) return;
    const report = () => onMeasure(id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, fit, onMeasure, cols]);

  return (
    <div className="relative h-full px-2.5" style={{ paddingBottom: DESK_GAP_PX }}>
      {/* Fitting: the content sets the height. Pinned: it fills the cell and scrolls. */}
      <div className={cn('relative', !fit && 'scroll-quiet h-full overflow-y-auto overflow-x-hidden overscroll-contain rounded-3xl')}>
        <div
          ref={contentRef}
          data-desk-content
          className={cn(!fit && 'flex min-h-full flex-col [&>*]:flex-1', arranging && 'pointer-events-none select-none')} inert={arranging || undefined}>
          {children}
        </div>
      </div>
      {arranging && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-x-2.5 top-0 rounded-3xl outline-2 outline-dashed -outline-offset-1 outline-primary/45" style={{ bottom: DESK_GAP_PX }} />
          {/* The grip sits on the module's top edge, so it covers none of it. */}
          <div className="absolute left-1/2 top-0 z-[5] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1">
            <button
              type="button"
              aria-label={`Move ${label}`}
              className="desk-grip flex h-8 cursor-grab items-center gap-1.5 rounded-full border border-border/60 bg-popover/95 pl-1.5 pr-3 text-xs font-medium text-foreground shadow-[var(--card-shadow)] backdrop-blur active:cursor-grabbing"
            >
              <GripVertical className="size-4 text-muted-foreground" />
              {label}
            </button>
            {!fit && (
              <button
                type="button"
                onClick={onFit}
                title="Let the content set the height again"
                className="flex h-8 items-center gap-1 rounded-full border border-border/60 bg-popover/95 px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--card-shadow)] backdrop-blur hover:text-foreground"
              >
                <MoveVertical className="size-3.5" />
                Fit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
