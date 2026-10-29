import { timeAgo } from '../../relative-time';

// Feedback people send to the Rooftap team through the Assistant, and crash
// reports from the error screen (core crash-report.ts). The server keeps both
// in the operator's inbox (apps/web/src/lib/feedback.ts); both apps' Feedback
// panels show it.

/** The Assistant's tool that sends feedback; it always asks the person first. */
export const SEND_FEEDBACK_TOOL = 'send_feedback';

/** The longest feedback message the server keeps, in characters. */
export const FEEDBACK_MAX = 2000;

/** One piece of feedback as the operator's inbox shows it. */
export interface FeedbackItem {
  id: string;
  message: string;
  /** The sender's first name; null once their account is gone. */
  from: string | null;
  serverVersion: string | null;
  /** The GitHub issue it opened, on a server set up for that. */
  issueUrl: string | null;
  /** Where it came from: the Assistant, or a crash report from the error screen. */
  kind: 'feedback' | 'crash';
  /** How many times a crash was reported; 1 for feedback. */
  seen: number;
  done: boolean;
  createdAt: string;
}

/** The operator's inbox (GET /api/admin/feedback). */
export interface FeedbackInbox {
  items: FeedbackItem[];
  /** Whether new feedback also opens a GitHub issue on this server. */
  github: boolean;
  /**
   * Whether this server passes crash reports on to the Rooftap team: always on
   * the hosted server ('hosted'), the operator's choice elsewhere ('ask' until
   * they make one). `crashSharingFixed` means the server's env decides it.
   * Absent on a server from before crash reports.
   */
  crashSharing?: CrashSharing;
  crashSharingFixed?: boolean;
}

export type CrashSharing = 'hosted' | 'share' | 'off' | 'ask';

/** The Feedback panel's description, for what this server does with what it gets. */
export function feedbackInboxDescription(inbox: Pick<FeedbackInbox, 'github'>): string {
  return inbox.github
    ? 'What people sent through the Assistant, and crash reports from the app, from every household on this server. Each one also opened a GitHub issue.'
    : 'What people sent through the Assistant, and crash reports from the app, from every household on this server.';
}

/** A row's small print: who or what sent it, how often a crash came in, and when. */
export function feedbackItemMeta(item: FeedbackItem): string {
  const who =
    item.kind === 'crash'
      ? `Crash report${item.seen > 1 ? `, seen ${item.seen} times` : ''}`
      : (item.from ?? 'A deleted account');
  return [who, timeAgo(item.createdAt)].filter(Boolean).join(' · ');
}

/** The one-time question a self-hosted operator answers about crash reports. */
export const CRASH_SHARE_QUESTION = {
  title: 'Share crash reports with the Rooftap team?',
  body: "When a screen doesn't load, the app reports the error to this server. Sharing passes those reports on, without names, households or items. You can change this later.",
  share: 'Share',
  keep: 'Keep here',
} as const;

/** Whether an operator still gets a "Report upstream" link on a crash row. */
export function offersUpstreamReport(inbox: Pick<FeedbackInbox, 'crashSharing'>, item: FeedbackItem): boolean {
  return item.kind === 'crash' && (inbox.crashSharing === 'off' || inbox.crashSharing === 'ask');
}
