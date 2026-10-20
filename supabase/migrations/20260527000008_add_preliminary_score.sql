alter table apartments
  add column preliminary_score integer default null
  constraint preliminary_score_range check (preliminary_score >= 1 and preliminary_score <= 10);
