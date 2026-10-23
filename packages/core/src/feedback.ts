// Feedback people send to the Rooftap team through the Assistant. The server
// keeps it in the operator's inbox (apps/web/src/lib/feedback.ts); both
// apps' Feedback panels show it.

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
  done: boolean;
  createdAt: string;
}

/** The operator's inbox (GET /api/admin/feedback). */
export interface FeedbackInbox {
  items: FeedbackItem[];
  /** Whether new feedback also opens a GitHub issue on this server. */
  github: boolean;
}
