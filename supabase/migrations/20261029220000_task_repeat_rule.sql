-- Calendar repeat rules for household tasks: an iCalendar RRULE such as
-- 'FREQ=MONTHLY;BYMONTHDAY=1' (the 1st of every month) or
-- 'FREQ=MONTHLY;BYDAY=1SU' (the first Sunday). When set it decides the next
-- due date; recurrence_days stays as its rough day count, so apps and servers
-- that predate this column still repeat the task. Additive and nullable.
alter table public.household_tasks add column if not exists repeat_rule text;
