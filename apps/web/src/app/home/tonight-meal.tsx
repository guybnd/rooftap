'use client';

// Meal plan on Home (hub.meals): one feed-style row for tonight's dinner,
// "Tonight: Thai green curry" with its time as the row's one trailing fact.
// Nothing shows while tonight isn't planned. Tapping opens Recipes' week.
// Native twin: apps/mobile/src/features/home/tonight-meal.tsx.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { todayISO, useModules, useTonightMeal } from '@homeup/core';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListGroup, ListItem, ListItemContent, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { sectionIconFor } from '@/lib/section-icons';
import { navLinkClickHandler } from '@/lib/view-transitions';

const HREF = '/recipes?tab=week';

export function TonightMeal({ groupId }: { groupId: string }) {
  const on = useModules().feature('hub.meals');
  const tonight = useTonightMeal(groupId, on, todayISO());
  const router = useRouter();
  if (!tonight) return null;
  return (
    <ListGroup>
      <ListItem asChild className="items-center">
        <Link href={HREF} onClick={navLinkClickHandler('descend', router, HREF)}>
          <LeadingTile sectionId="recipes" Icon={sectionIconFor('recipes')} size="lg" />
          <ListItemContent>
            <ListItemTitle>
              <span className="truncate">{tonight.title}</span>
            </ListItemTitle>
          </ListItemContent>
          {tonight.time && <ListItemTrailing className="text-xs tabular-nums">{tonight.time}</ListItemTrailing>}
        </Link>
      </ListItem>
    </ListGroup>
  );
}
