"use client";

import { useState } from "react";
import { UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsPanel } from "@/components/settings-panel";
import { createClient } from "@/lib/supabase/client";
import { DELETE_ACCOUNT_COPY, deletionPlanLines, dialog, fetchAccountDeletionPlan } from "@homeup/core";

/**
 * Asks, then deletes the signed-in account (POST /api/account/delete) and
 * signs out. The confirmation names what happens to each home. Shared by
 * Settings and the public /delete-account page.
 */
export function useDeleteAccount() {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const supabase = createClient();
    const plan = await fetchAccountDeletionPlan(supabase);
    const lines = plan ? deletionPlanLines(plan) : [];
    const ok = await dialog.confirm({
      title: DELETE_ACCOUNT_COPY.confirmTitle,
      message: [DELETE_ACCOUNT_COPY.lede, ...lines].join("\n\n"),
      confirmLabel: DELETE_ACCOUNT_COPY.confirmLabel,
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "delete" }),
      });
      if (!res.ok) {
        toast.error(DELETE_ACCOUNT_COPY.failed);
        return;
      }
      await supabase.auth.signOut().catch(() => {});
      toast.success(DELETE_ACCOUNT_COPY.done);
      window.location.assign("/login");
    } catch {
      toast.error(DELETE_ACCOUNT_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  return { busy, run };
}

export function DeleteAccountSettings() {
  const { busy, run } = useDeleteAccount();
  return (
    <SettingsPanel icon={UserXIcon} title={DELETE_ACCOUNT_COPY.title} description={DELETE_ACCOUNT_COPY.lede}>
      <Button size="lg" variant="destructive" disabled={busy} onClick={run}>
        {busy ? "Deleting..." : DELETE_ACCOUNT_COPY.row}
      </Button>
    </SettingsPanel>
  );
}
