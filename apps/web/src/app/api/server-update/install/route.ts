import { NextResponse } from "next/server";
import { currentUpdaterStatus, updaterRequestStuck } from "@homeup/core";
import { getSessionUser } from "@/lib/supabase/session";
import { isServerAdmin } from "@/lib/admin-auth";
import { serverUpdate } from "@/lib/server-update";
import { readServerUpdater, requestServerUpdate } from "@/lib/server-updater";

// The Update button (core server-updater.ts): asks the updater on the host
// to install the newest release. The app never runs the update itself. It
// leaves the version number in the updater's inbox, and the updater checks
// it again against the release list before it changes anything.

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isServerAdmin(user))) return NextResponse.json({ error: "Only the people who run this server can update it." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { version?: unknown } | null;
  const version = typeof body?.version === "string" ? body.version : "";

  const updater = await readServerUpdater();
  if (!updater?.installed) {
    return NextResponse.json({ error: "One-click updates are off on this server." }, { status: 409 });
  }
  if ((updater.pending && !updaterRequestStuck(updater)) || currentUpdaterStatus(updater.status)?.state === "running") {
    return NextResponse.json({ error: "An update is already running." }, { status: 409 });
  }
  const update = await serverUpdate();
  if (!update || update.latest !== version) {
    return NextResponse.json({ error: "That is not the newest release for this server." }, { status: 409 });
  }
  if (!(await requestServerUpdate(version))) {
    return NextResponse.json({ error: "An update is already running." }, { status: 409 });
  }
  return NextResponse.json({ updater: await readServerUpdater() }, { status: 202 });
}
