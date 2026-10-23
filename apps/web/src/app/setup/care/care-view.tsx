'use client';

// Home care (module `home-care`): Home Setup's Care view. A job list in due
// order, by season or by room; jobs are only ever added from the picker or
// by hand, and each one's schedule and reminder can be changed or switched
// off. Mobile twin: apps/mobile/src/features/setup/care-view.tsx.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, MoreHorizontal, Plus, Sparkles, Wrench } from 'lucide-react';
import {
  CARE_SNOOZE_OPTIONS,
  careDue,
  careDueGroups,
  careEveryLabel,
  careOverview,
  careRoomGroups,
  careRoomOptions,
  careSeasonGroups,
  careDateLabel,
  nextDueAfter,
  seasonLabel,
  todayISO,
  useCareJobs,
  useCarePicker,
  type CareJob,
  type GroupMember,
} from '@homeup/core';
import { HeroLede, SegmentMeter } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { LeadingTile } from '@/components/ui/leading-tile';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { toastUndoAction } from '@/lib/undo-toast';
import { cn } from '@/lib/utils';
import { PopMenu, MenuItem, MenuLabel } from '../pop-menu';
import { CareJobSheet } from './care-job-sheet';
import { CarePickerList, CarePickerSheet } from './care-picker';

type Profiles = Record<string, { email: string; name: string | null; avatar: string | null }>;
type CareMode = 'due' | 'seasons' | 'rooms';

const MODE_KEY = 'homeup-care-mode';
const MODES: { value: CareMode; label: string }[] = [
  { value: 'due', label: 'Due' },
  { value: 'seasons', label: 'Seasons' },
  { value: 'rooms', label: 'Rooms' },
];

const DUE_TONE = { overdue: 'text-destructive', soon: 'text-warning', later: '' } as const;

const HEAD_BUTTON =
  'flex h-11 sm:h-9 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>;
}

export function CareView({
  groupId,
  currentUserId,
  region,
  groupMembers,
  memberProfiles,
  setupRooms,
}: {
  groupId: string | undefined;
  currentUserId: string | null;
  region: string | null | undefined;
  groupMembers: GroupMember[];
  memberProfiles: Profiles;
  setupRooms: string[];
}) {
  const care = useCareJobs(groupId, currentUserId, region);
  const { jobs, loaded, southern } = care;
  const today = todayISO();

  const [mode, setModeState] = useState<CareMode>('due');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === 'due' || saved === 'seasons' || saved === 'rooms') setModeState(saved);
    } catch {
      // storage blocked: stay on Due
    }
  }, []);
  const setMode = (m: CareMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // ignore
    }
  };

  const [editing, setEditing] = useState<CareJob | null>(null);
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const overview = useMemo(() => careOverview(jobs, today), [jobs, today]);
  const due = useMemo(() => careDueGroups(jobs, today), [jobs, today]);
  const seasons = useMemo(() => careSeasonGroups(jobs, today, southern), [jobs, today, southern]);
  const rooms = useMemo(() => careRoomGroups(jobs, today), [jobs, today]);
  const roomOptions = useMemo(() => careRoomOptions(jobs, setupRooms), [jobs, setupRooms]);
  const paused = useMemo(() => jobs.filter((j) => j.state === 'paused'), [jobs]);
  const hidden = useMemo(() => jobs.filter((j) => j.state === 'hidden'), [jobs]);

  const firstRun = loaded && jobs.length === 0;
  const picker = useCarePicker(jobs, region, true);

  const finish = (job: CareJob) => {
    care.markDone(job.id);
    toastUndoAction(`Done. Next: ${careDateLabel(nextDueAfter(job, today), today)}`, () => care.undoDone(job.id));
  };

  const sheets = (
    <>
      <CareJobSheet
        isOpen={adding || !!editing}
        job={editing ?? undefined}
        southern={southern}
        rooms={roomOptions}
        groupMembers={groupMembers}
        memberProfiles={memberProfiles}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSave={(edit) => {
          if (editing) care.saveJob(editing.id, edit);
          else care.addJob(edit);
        }}
        onDelete={editing ? () => care.remove(editing.id) : undefined}
      />
      <CarePickerSheet
        isOpen={suggesting}
        jobs={jobs}
        region={region}
        southern={southern}
        onClose={() => setSuggesting(false)}
        onAdd={(p, h) => care.addSuggestions(p, h)}
      />
    </>
  );

  if (!loaded) return <div className="h-40" aria-busy="true" />;

  if (firstRun) {
    const count = picker.state.picked.size;
    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-bold text-foreground">What does your home need?</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Tick the jobs you want reminders for. Each one starts at a relaxed pace, and you can change how often, who does it,
            or switch it off later. Nothing is added unless you pick it.
          </p>
        </div>
        <CarePickerList picker={picker} southern={southern} />
        <div className="sticky bottom-20 z-10 -mx-2 flex gap-2 rounded-2xl bg-background/90 p-2 backdrop-blur md:bottom-2">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`${HEAD_BUTTON} flex-1 border-border bg-secondary px-4 text-secondary-foreground hover:bg-accent`}
          >
            Add your own
          </button>
          <button
            type="button"
            disabled={count === 0 && picker.state.skipped.size === 0}
            onClick={() => {
              const { picked, hidden: h } = picker.result();
              care.addSuggestions(picked, h);
            }}
            className={`${HEAD_BUTTON} flex-1 border-transparent bg-primary px-4 text-primary-foreground hover:bg-primary/80 disabled:opacity-50`}
          >
            {count > 0 ? `Add ${count} ${count === 1 ? 'job' : 'jobs'}` : 'Add jobs'}
          </button>
        </div>
        {sheets}
      </div>
    );
  }

  const row = (job: CareJob) => (
    <CareRow
      key={job.id}
      job={job}
      today={today}
      southern={southern}
      showRoom={mode !== 'rooms'}
      onOpen={() => setEditing(job)}
      onDone={() => finish(job)}
      onSkip={() => care.skip(job.id)}
      onSnooze={(days) => care.snooze(job.id, days)}
      onPause={() => care.setState(job.id, 'paused')}
      onHide={() => care.setState(job.id, 'hidden')}
    />
  );

  const caption = [
    overview.overdue > 0 ? <span key="o" className="text-destructive">{overview.overdue} overdue</span> : null,
    `${overview.active} on the schedule`,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <HeroLede
          value={overview.dueThisMonth}
          label="due this month"
          caption={
            <>
              {caption.map((c, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {c}
                </span>
              ))}
            </>
          }
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSuggesting(true)}
            className={`${HEAD_BUTTON} border-border bg-secondary px-3.5 text-secondary-foreground hover:bg-accent`}
          >
            <Sparkles className="h-4 w-4" />
            Suggestions
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`${HEAD_BUTTON} border-transparent bg-primary px-4 text-primary-foreground hover:bg-primary/80`}
          >
            <Plus className="h-4 w-4" />
            Add job
          </button>
        </div>
      </div>

      <SegmentedControl options={MODES} value={mode} onChange={setMode} size="sm" ariaLabel="Show jobs" className="w-full sm:w-auto" />

      {overview.active === 0 && (
        <p className="rounded-3xl bg-card px-4 py-3 text-sm text-muted-foreground">
          Nothing is scheduled. Add a job, or bring one back from the paused list.
        </p>
      )}

      {mode === 'due' && (
        <div className="space-y-4">
          {due.soon.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>Next 30 days</SectionLabel>
              <ListGroup>{due.soon.map(row)}</ListGroup>
            </div>
          )}
          {due.later.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>Later</SectionLabel>
              <ListGroup>{due.later.map(row)}</ListGroup>
            </div>
          )}
        </div>
      )}

      {mode === 'seasons' && (
        <div className="space-y-4">
          {seasons.map((s) => (
            <div key={s.from} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h2 className="font-heading text-base font-semibold text-foreground">
                  {seasonLabel(s.season)}
                  {s.current ? ', now' : ''}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {s.months}
                  {s.current && s.done + s.jobs.length > 0 ? ` · ${s.done} of ${s.done + s.jobs.length} done` : ''}
                </span>
              </div>
              {s.current && s.done + s.jobs.length > 0 && <SegmentMeter done={s.done} total={s.done + s.jobs.length} className="px-1" />}
              {s.jobs.length > 0 ? (
                <ListGroup>{s.jobs.map(row)}</ListGroup>
              ) : (
                <p className="px-1 text-sm text-muted-foreground">Nothing due.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {mode === 'rooms' && (
        <div className="space-y-4">
          {rooms.map((r) => (
            <div key={r.room} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h2 className="font-heading text-base font-semibold text-foreground">{r.room}</h2>
                <span className="text-xs text-muted-foreground">
                  {r.overdue > 0 ? (
                    <span className="text-destructive">{r.overdue} overdue</span>
                  ) : (
                    `${r.jobs.length} ${r.jobs.length === 1 ? 'job' : 'jobs'}`
                  )}
                </span>
              </div>
              <ListGroup>{r.jobs.map(row)}</ListGroup>
            </div>
          ))}
        </div>
      )}

      {paused.length > 0 && (
        <OffList
          title="Paused"
          open={showPaused}
          onToggle={() => setShowPaused((v) => !v)}
          jobs={paused}
          southern={southern}
          today={today}
          actionLabel="Resume"
          onAction={(j) => care.setState(j.id, 'active')}
          onOpen={setEditing}
        />
      )}
      {hidden.length > 0 && (
        <OffList
          title="Hidden"
          hint="Things your home doesn't have. They stay out of suggestions."
          open={showHidden}
          onToggle={() => setShowHidden((v) => !v)}
          jobs={hidden}
          southern={southern}
          today={today}
          actionLabel="Bring back"
          onAction={(j) => care.setState(j.id, 'active')}
          onOpen={setEditing}
        />
      )}

      {sheets}
    </div>
  );
}

function CareRow({
  job,
  today,
  southern,
  showRoom,
  onOpen,
  onDone,
  onSkip,
  onSnooze,
  onPause,
  onHide,
}: {
  job: CareJob;
  today: string;
  southern: boolean;
  showRoom: boolean;
  onOpen: () => void;
  onDone: () => void;
  onSkip: () => void;
  onSnooze: (days: number) => void;
  onPause: () => void;
  onHide: () => void;
}) {
  const when = careDue(job, today);
  return (
    <ListItem
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      className="cursor-pointer"
    >
      <ListItemLeading>
        <LeadingTile sectionId="setup" Icon={Wrench} size="sm" />
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle>{job.title}</ListItemTitle>
        <ListItemMeta>
          <span className="min-w-0 truncate">
            {when && <span className={cn('font-medium', DUE_TONE[when.tone])}>{when.text}</span>}
            {[showRoom ? job.room : null, careEveryLabel(job, southern), job.remind ? null : 'no reminder']
              .filter(Boolean)
              .map((part, i) => (when || i > 0 ? ` · ${part}` : part))
              .join('')}
          </span>
        </ListItemMeta>
      </ListItemContent>
      <ListItemTrailing onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
        >
          Done
        </button>
        <PopMenu
          align="right"
          width="w-56"
          mobileSheet
          triggerLabel={`More for ${job.title}`}
          triggerClassName="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          trigger={<MoreHorizontal className="size-4" />}
        >
          {(close) => (
            <>
              <MenuLabel>{job.title}</MenuLabel>
              <MenuItem onClick={() => { onSkip(); close(); }}>Skip this time</MenuItem>
              {CARE_SNOOZE_OPTIONS.map((o) => (
                <MenuItem key={o.days} onClick={() => { onSnooze(o.days); close(); }}>
                  Push back {o.label.toLowerCase()}
                </MenuItem>
              ))}
              <MenuItem onClick={() => { onOpen(); close(); }}>Change schedule</MenuItem>
              <MenuItem onClick={() => { onPause(); close(); }}>Pause</MenuItem>
              <MenuItem onClick={() => { onHide(); close(); }}>We don&apos;t have this</MenuItem>
            </>
          )}
        </PopMenu>
      </ListItemTrailing>
    </ListItem>
  );
}

function OffList({
  title,
  hint,
  open,
  onToggle,
  jobs,
  southern,
  today,
  actionLabel,
  onAction,
  onOpen,
}: {
  today: string;
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  jobs: CareJob[];
  southern: boolean;
  actionLabel: string;
  onAction: (job: CareJob) => void;
  onOpen: (job: CareJob) => void;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {title} <span className="tabular-nums">({jobs.length})</span>
        <ChevronDown className={cn('ml-auto size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          {hint && <p className="px-1 text-xs text-muted-foreground">{hint}</p>}
          <ListGroup>
            {jobs.map((j) => (
              <ListItem key={j.id} role="button" tabIndex={0} onClick={() => onOpen(j)} className="cursor-pointer">
                <ListItemContent>
                  <ListItemTitle className="text-muted-foreground">{j.title}</ListItemTitle>
                  <ListItemMeta>
                    {j.room && <span>{j.room} · </span>}
                    <span>{careEveryLabel(j, southern)}</span>
                    {j.last_done && <span> · last done {careDateLabel(j.last_done, today)}</span>}
                  </ListItemMeta>
                </ListItemContent>
                <ListItemTrailing onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onAction(j)}
                    className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
                  >
                    {actionLabel}
                  </button>
                </ListItemTrailing>
              </ListItem>
            ))}
          </ListGroup>
        </>
      )}
    </div>
  );
}
