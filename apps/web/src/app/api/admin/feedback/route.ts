import { NextResponse } from "next/server";
import type { FeedbackInbox } from "@homeup/core";
import { requireServerOperator } from "@/lib/admin-auth";
import { feedbackGithub, listFeedback, setFeedbackDone } from "@/lib/feedback";
import { crashSharing, setCrashSharing } from "@/lib/crash-reports";

// Settings > Integrations & keys > Feedback: what people sent the Rooftap
// team through the Assistant, and crash reports from the error screen, from
// every household on this server. Operators only, like the other server-wide
// panels. It also carries the operator's choice to share crash reports with
// the Rooftap team (lib/crash-reports.ts).

async function inbox(admin: Parameters<typeof listFeedback>[0]): Promise<FeedbackInbox> {
  const [items, crash] = await Promise.all([listFeedback(admin), crashSharing()]);
  return { items, github: !!feedbackGithub(), crashSharing: crash.sharing, crashSharingFixed: crash.fixed };
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

/**
 * `{ id, done }`: mark one dealt with or back to new. `{ crashSharing }`:
 * "share" or "off". Answers the inbox.
 */
export async function PATCH(request: Request) {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;
  const body = (await request.json().catch(() => null)) as { id?: unknown; done?: unknown; crashSharing?: unknown } | null;
  if (body && (body.crashSharing === "share" || body.crashSharing === "off")) {
    if ((await crashSharing()).fixed) {
      return NextResponse.json({ error: "This server's settings decide where crash reports go" }, { status: 409 });
    }
    try {
      await setCrashSharing(gate.admin, body.crashSharing);
      return NextResponse.json(await inbox(gate.admin));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save that" }, { status: 500 });
    }
  }
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
