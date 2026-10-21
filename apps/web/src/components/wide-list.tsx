"use client";

// Hearth §13.7 "Desktop shell": a list that turns into a grid of cards on a
// wide screen. Narrow, it is one ListGroup (rows divided inside one card);
// wide, each row becomes its own card, 2 to 3 across. Rows are unchanged.
import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ListGroup } from "@/components/ui/list-item";
import { useWideLayout } from "@/lib/desktop-layout";

export function WideList({ children, className }: { children: ReactNode; className?: string }) {
  const wide = useWideLayout();
  if (!wide) return <ListGroup className={className}>{children}</ListGroup>;
  return (
    <div className={cn("grid grid-cols-2 gap-3 xl:grid-cols-3", className)}>
      {Children.map(children, (child) => (child ? <ListGroup>{child}</ListGroup> : null))}
    </div>
  );
}
