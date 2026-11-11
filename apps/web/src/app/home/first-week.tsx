'use client';

// The "First week" card on Home (core first-week.ts, Guy's pick on
// 2026-11-10): a new household's first steps under the lede, each with one
// link. A step whose tile is off is left out; the card goes once every step is
// done, the person hides it, or the household is two weeks old.
// Native twin: apps/mobile/src/features/home/first-week.tsx.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import {
  dialog,
  firstWeekWidgetHelp,
  todayISO,
  useFirstWeek,
  useModules,
  useTonightMeal,
  webDevice,
  type WebDevice,
} from '@homeup/core';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { sectionIconFor } from '@/lib/section-icons';
import { cn } from '@/lib/utils';

/** Where this page runs and whether it may notify, read after the first paint so SSR and hydration agree. */
function useThisDevice(): { device: WebDevice | undefined; notificationsOn: boolean } {
  const [state, setState] = useState<{ device: WebDevice | undefined; notificationsOn: boolean }>({
    device: undefined,
    notificationsOn: false,
  });
  useEffect(() => {
    setState({
      device: webDevice({
        userAgent: navigator.userAgent || '',
        maxTouchPoints: navigator.maxTouchPoints || 0,
        standalone:
          window.matchMedia?.('(display-mode: standalone)').matches === true ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true,
      }),
      notificationsOn: 'Notification' in window && Notification.permission === 'granted',
    });
  }, []);
  return state;
}

export function FirstWeek({
  groupId,
  groupCreatedAt,
  memberCount,
  hasCost,
}: {
  groupId: string;
  groupCreatedAt: string | null | undefined;
  memberCount: number;
  hasCost: boolean;
}) {
  const modules = useModules();
  const dinnerOn = modules.feature('hub.meals');
  const tonight = useTonightMeal(groupId, dinnerOn, todayISO(), modules.server('meals.multi-dish'));
  const here = useThisDevice();
  const week = useFirstWeek({
    groupId,
    groupCreatedAt,
    platform: 'web',
    webDevice: here.device,
    notificationsOn: here.notificationsOn,
    dinnerOn,
    billOn: modules.feature('capture.cost'),
    dinnerPlanned: !!tonight,
    hasCost,
    memberCount,
  });
  if (!week.visible) return null;
  const total = week.steps.length;

  return (
    <ListGroup aria-label="First week">
      <div className="flex items-center gap-3 p-3">
        <LeadingTile sectionId="home" Icon={sectionIconFor('home')} size="md" />
        <div className="min-w-0 flex-1">
          <div className="font-heading text-[15px] font-semibold">First week</div>
          <div className="mt-1.5 flex items-center gap-2">
            {/* H3: a local segmented meter, one segment per step, in the checklist green. */}
            <div className="flex w-24 gap-1" aria-hidden>
              {week.steps.map((s) => (
                <span key={s.id} className={cn('h-[3px] flex-1 rounded-full', s.done ? 'bg-success' : 'bg-foreground/15')} />
              ))}
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {week.done} of {total}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={week.dismiss}
          aria-label="Hide First week"
          className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-4" />
        </button>
      </div>
      {week.steps.map((step) => {
        const mark = (
          <span
            aria-hidden
            className={cn(
              'grid size-5 shrink-0 place-items-center rounded-full border-2',
              step.done ? 'border-success bg-success text-background' : 'border-border'
            )}
          >
            {step.done && <Check className="size-3" strokeWidth={3} />}
          </span>
        );
        const body = (
          <ListItemContent>
            <ListItemTitle className={cn(step.done && 'font-normal text-muted-foreground line-through')}>{step.title}</ListItemTitle>
            <ListItemMeta>{step.meta}</ListItemMeta>
          </ListItemContent>
        );
        if (step.done) {
          return (
            <ListItem key={step.id} className="gap-3">
              {mark}
              {body}
            </ListItem>
          );
        }
        const action = <ListItemTrailing className="text-xs font-semibold text-primary">{step.action}</ListItemTrailing>;
        return step.href ? (
          <ListItem key={step.id} asChild className="gap-3">
            <Link href={step.href} onClick={() => week.tap(step.id)}>
              {mark}
              {body}
              {action}
            </Link>
          </ListItem>
        ) : (
          <ListItem key={step.id} asChild className="gap-3">
            <button
              type="button"
              onClick={() => {
                const help = firstWeekWidgetHelp('web', here.device);
                dialog.alert(help.title, help.message);
                week.tap(step.id);
              }}
            >
              {mark}
              {body}
              {action}
            </button>
          </ListItem>
        );
      })}
    </ListGroup>
  );
}
