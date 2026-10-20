"use client";

import { useState, useCallback } from "react";
import { useDataCache } from "@/lib/data-cache";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { UserPlusIcon, Copy, Check } from "lucide-react";
import { toast } from "sonner";

type CreatedAccount = { email: string; password: string; displayName: string };

export function UsersManager() {
  const { group, isGroupOwner, refresh } = useDataCache();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = useCallback(async () => {
    setError(null);
    if (!identifier.trim() || password.length < 6) {
      setError("Enter a username or email, and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group?.id, identifier, password, displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server responded ${res.status}`);
      setCreated({ email: data.email, password: data.password, displayName: data.displayName });
      setIdentifier("");
      setPassword("");
      setDisplayName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user.");
    } finally {
      setBusy(false);
    }
  }, [group?.id, identifier, password, displayName, refresh]);

  const copyPassword = useCallback(() => {
    if (!created) return;
    navigator.clipboard.writeText(created.password);
    setCopied(true);
    toast.success("Password copied");
  }, [created]);

  const closeReveal = useCallback(() => {
    setCreated(null);
    setCopied(false);
  }, []);

  if (!isGroupOwner) return null;

  return (
    <>
      {/* The member list lives once, in the household panel above (with its
          own remove action); this panel is just the direct-create form. */}
      <SettingsPanel
        icon={UserPlusIcon}
        title="Create a user"
        description="Make an account for someone in your household directly, no email invite needed."
      >
        <div className="space-y-2">
          <Input
            placeholder="Username or email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={busy}
            className="h-9"
            aria-label="Username or email"
          />
          <Input
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
            className="h-9"
            aria-label="Display name"
          />
          <Input
            type="password"
            placeholder="Password, 6 characters or more"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className="h-9"
            aria-label="Password"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <Button
          onClick={handleCreate}
          disabled={busy || !identifier.trim() || password.length < 6}
          size="lg"
          variant="outline"
          className="px-3"
        >
          <UserPlusIcon className="h-4 w-4" />
          Create user
        </Button>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </SettingsPanel>

      <Dialog open={!!created} onOpenChange={(open) => !open && closeReveal()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User created</DialogTitle>
            <DialogDescription>
              Share this password with {created?.displayName} now. It won&apos;t be shown again, and
              they should change it after signing in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Sign-in email</p>
            <p className="text-sm font-mono break-all">{created?.email}</p>
            <p className="text-xs text-muted-foreground pt-1">Password</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
              <code className="flex-1 min-w-0 truncate text-xs font-mono">{created?.password}</code>
              <Button size="icon-sm" variant="ghost" onClick={copyPassword}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeReveal}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
