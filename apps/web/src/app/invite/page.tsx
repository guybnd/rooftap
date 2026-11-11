"use client";

import { useEffect, useState } from "react";
import { CopyIcon, Share2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CardCode } from "@/components/card-code";
import { useDataCache } from "@/lib/data-cache";
import { createClient } from "@/lib/supabase/client";
import { INVITE_COPY, dialog, fetchInviteLink, inviteLinkLifeLabel, inviteUrl, stopInviteLink, type InviteLink } from "@homeup/core";

// The owner's invite screen (independent review n1): one link per home, its
// QR code, and Share. The person who opens it joins on /join/<token>, with or
// without an account. The phone twin is apps/mobile/src/app/invite.tsx. Home's
// first-week card links here.
export default function InvitePage() {
  const { group, isGroupOwner, groupMembers } = useDataCache();
  const [link, setLink] = useState<InviteLink | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!group?.id || !isGroupOwner) return;
    let live = true;
    fetchInviteLink(createClient(), group.id).then((l) => {
      if (live) setLink(l);
    });
    return () => {
      live = false;
    };
  }, [group?.id, isGroupOwner]);

  if (!group) return null;

  const url = link && origin ? inviteUrl(origin, link.token) : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it.");
    }
  };

  const share = async () => {
    if (!url) return;
    if (navigator.share) {
      await navigator.share({ title: `Join ${group.name}`, text: INVITE_COPY.share(group.name, url) }).catch(() => {});
    } else {
      await copy();
    }
  };

  const renew = async () => {
    if (!(await dialog.confirm({ title: INVITE_COPY.renewConfirm, confirmLabel: "Make new link" }))) return;
    setBusy(true);
    const next = await fetchInviteLink(createClient(), group.id, true);
    setBusy(false);
    if (!next) toast.error("Could not make a new link");
    else setLink(next);
  };

  const stop = async () => {
    if (!(await dialog.confirm({ title: INVITE_COPY.stopConfirm, confirmLabel: "Turn off", destructive: true }))) return;
    setBusy(true);
    const ok = await stopInviteLink(createClient(), group.id);
    setBusy(false);
    if (!ok) toast.error("Could not turn the link off");
    else setLink(null);
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-4 py-8">
      <div className="space-y-1.5">
        <h1 className="font-heading text-[26px] font-bold leading-tight tracking-tight">{INVITE_COPY.title}</h1>
        <p className="text-sm text-muted-foreground">
          {isGroupOwner ? INVITE_COPY.lede : INVITE_COPY.notOwner}
        </p>
      </div>

      {isGroupOwner && link === null && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">The link is off. Nobody can join with it.</p>
          <Button size="lg" className="w-full" disabled={busy} onClick={renew}>
            Make a link
          </Button>
        </div>
      )}

      {isGroupOwner && url && link && (
        <>
          <CardCode number={url} format="qr" />
          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-card px-3.5 py-3">
              <p className="select-all break-all font-mono text-xs">{url}</p>
              <p className="mt-1 text-xs text-muted-foreground">{inviteLinkLifeLabel(link.expiresAt)}</p>
            </div>
            <div className="flex gap-2">
              <Button size="lg" className="flex-1" onClick={share}>
                <Share2Icon className="h-4 w-4" />
                Share link
              </Button>
              <Button size="lg" variant="outline" onClick={copy} aria-label="Copy link">
                <CopyIcon className="h-4 w-4" />
                Copy
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {groupMembers.length === 1 ? "You are the only one here so far." : `${groupMembers.length} people live here.`}
          </p>
          <div className="flex gap-4">
            <button type="button" disabled={busy} onClick={renew} className="text-sm text-muted-foreground hover:text-foreground">
              Make a new link
            </button>
            <button type="button" disabled={busy} onClick={stop} className="text-sm text-destructive hover:text-destructive/80">
              Turn link off
            </button>
          </div>
        </>
      )}
    </div>
  );
}
