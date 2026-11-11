// The "First week" card on Home (Guy's pick on 2026-11-10): a new household's
// first steps, each with one link, under the Hero lede. It shows for the
// household's first FIRST_WEEK_DAYS days until every step is done or the
// person dismisses it. A step shows only while what it needs is on. Done
// comes from the household's own data where Home already has it (a dinner
// planned tonight, a cost, a second member), and otherwise from the person
// tapping the step. Dismissed and tapped steps are kept per device and per
// household (getStoreEnvironment().keyValue), like What's new.

import { IOS_HOME_SCREEN_STEPS, type WebDevice } from './web-install';

export type FirstWeekStepId = 'tiles' | 'dinner' | 'bill' | 'invite' | 'widget';

export interface FirstWeekStep {
  id: FirstWeekStepId;
  title: string;
  /** One line on what the step gets you. */
  meta: string;
  /** The short link label at the end of the row. */
  action: string;
  /** Where the link goes, or null for a step that explains in place (the widget). */
  href: string | null;
  done: boolean;
}

/** How long a new household sees the card, in days from when it was made. */
export const FIRST_WEEK_DAYS = 14;

export const FIRST_WEEK_STORAGE_PREFIX = 'homeup-first-week:';

export interface FirstWeekInput {
  platform: 'web' | 'phone';
  /** On web: where it runs (web-install.ts). An iPhone gets Add to Home Screen, an installed app gets notifications. */
  webDevice?: WebDevice;
  /** On web: notifications are already allowed in this browser. */
  notificationsOn?: boolean;
  /** Tonight's dinner can be planned (hub.meals). */
  dinnerOn: boolean;
  /** Bills can be added (capture.cost). */
  billOn: boolean;
  dinnerPlanned: boolean;
  hasCost: boolean;
  memberCount: number;
  /** Steps the person has tapped on this device. */
  tapped: ReadonlySet<string>;
}

/** The steps, in order, with the ones whose tiles are off left out. */
export function firstWeekSteps(input: FirstWeekInput): FirstWeekStep[] {
  const steps: FirstWeekStep[] = [
    { id: 'tiles', title: 'Choose your tiles', meta: 'Change them any time in Settings', action: 'Tiles', href: '/settings/tiles', done: true },
  ];
  if (input.dinnerOn) {
    steps.push({
      id: 'dinner',
      title: "Add tonight's dinner",
      meta: 'Watch its ingredients land on Groceries',
      action: 'Plan',
      href: '/recipes?tab=week',
      done: input.dinnerPlanned || input.tapped.has('dinner'),
    });
  }
  if (input.billOn) {
    steps.push({
      id: 'bill',
      title: 'Add a bill',
      meta: 'Snap it and get a reminder before it is due',
      action: 'Add',
      href: '/costs',
      done: input.hasCost || input.tapped.has('bill'),
    });
  }
  steps.push({
    id: 'invite',
    title: 'Invite someone',
    meta: 'Rooftap works best with everyone in it',
    action: 'Invite',
    // The invite link and QR code screen. On a server too old for links it
    // says how to invite by email in Settings > Home.
    href: '/invite',
    done: input.memberCount > 1 || input.tapped.has('invite'),
  });
  steps.push(deviceStep(input));
  return steps;
}

// The last step gets Rooftap onto the person's phone: Skylight in the Android
// app, Add to Home Screen on an iPhone (no native app yet, so the Home Screen
// web app is the app there), notifications once it is installed, and on a
// computer the way to the phone.
function deviceStep(input: FirstWeekInput): FirstWeekStep {
  const tapped = input.tapped.has('widget');
  if (input.platform === 'phone') {
    return { id: 'widget', title: 'Put Skylight on your home screen', meta: "Today's tasks without opening the app", action: 'Show me', href: null, done: tapped };
  }
  if (input.webDevice === 'ios-browser') {
    return { id: 'widget', title: 'Add Rooftap to your Home Screen', meta: 'It opens like an app and can send you reminders', action: 'Show me', href: null, done: tapped };
  }
  if (input.webDevice === 'ios-installed' || input.webDevice === 'installed') {
    return {
      id: 'widget',
      title: 'Turn on notifications',
      meta: 'Reminders and due tasks on this phone',
      action: 'Turn on',
      // Settings > You holds the Push notifications panel.
      href: '/settings/you',
      done: tapped || input.notificationsOn === true,
    };
  }
  return { id: 'widget', title: 'Get Rooftap on your phone', meta: 'Add things the moment you think of them', action: 'Show me', href: null, done: tapped };
}

/** What "Show me" on the last step says, by platform and, on web, by device. */
export function firstWeekWidgetHelp(platform: 'web' | 'phone', webDevice?: WebDevice): { title: string; message: string } {
  if (platform === 'phone') {
    return {
      title: 'Put Skylight on your home screen',
      message: 'Press and hold an empty spot on your home screen, tap Widgets, then drag Rooftap\'s Skylight onto it.',
    };
  }
  if (webDevice === 'ios-browser') {
    return {
      title: 'Add Rooftap to your Home Screen',
      message: `${IOS_HOME_SCREEN_STEPS} Then turn on notifications in Settings.`,
    };
  }
  return {
    title: 'Get Rooftap on your phone',
    message: 'On Android, install the Rooftap app. On an iPhone, open this page in Safari, tap the Share button, then Add to Home Screen.',
  };
}

/** Whether the card shows: a household younger than FIRST_WEEK_DAYS, not dismissed, with a step still open. */
export function firstWeekVisible(input: {
  groupCreatedAt: string | null | undefined;
  now: Date;
  dismissed: boolean;
  steps: readonly FirstWeekStep[];
}): boolean {
  if (input.dismissed || !input.groupCreatedAt) return false;
  const created = Date.parse(input.groupCreatedAt);
  if (Number.isNaN(created)) return false;
  if (input.now.getTime() - created > FIRST_WEEK_DAYS * 86_400_000) return false;
  return input.steps.some((s) => !s.done);
}

export interface FirstWeekState {
  dismissed: boolean;
  tapped: string[];
}

/** Reads the stored state; anything unreadable is a fresh start. */
export function parseFirstWeekState(raw: string | null | undefined): FirstWeekState {
  if (!raw) return { dismissed: false, tapped: [] };
  try {
    const v = JSON.parse(raw) as Partial<FirstWeekState>;
    return {
      dismissed: v.dismissed === true,
      tapped: Array.isArray(v.tapped) ? v.tapped.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return { dismissed: false, tapped: [] };
  }
}
