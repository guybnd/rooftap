-- Add is_bonus column to checklist_items
-- Bonus items only contribute positively to score when true;
-- they don't penalize the score when false or unanswered.
alter table checklist_items
  add column is_bonus boolean not null default false;
