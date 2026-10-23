import { NextResponse } from "next/server";
import type { FeedbackInbox } from "@homeup/core";
import { requireServerOperator } from "@/lib/admin-auth";
import { feedbackGithub, listFeedback, setFeedbackDone } from "@/lib/feedback";

// Settings > Integrations & keys > Feedback: what people sent the Rooftap
// team through the Assistant, from every household on this server. Operators
// only, like the other server-wide panels.

async function inbox(admin: Parameters<typeof listFeedback>[0]): Promise<FeedbackInbox> {
  return { items: await listFeedback(admin), github: !!feedbackGithub() };
}

export async function GET() {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;
  try {
    return NextResponse.json(await inbox(gate.admin));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load feedback" }, { status: 500 });
  }
}

/** `{ id, done }`: mark one dealt with or back to new; answers the inbox. */
export async function PATCH(request: Request) {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;
  const body = (await request.json().catch(() => null)) as { id?: unknown; done?: unknown } | null;
  if (!body || typeof body.id !== "string" || typeof body.done !== "boolean") {
    return NextResponse.json({ error: "Send id and done" }, { status: 400 });
  }
  try {
    await setFeedbackDone(gate.admin, body.id, body.done);
    return NextResponse.json(await inbox(gate.admin));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save that" }, { status: 500 });
  }
}
