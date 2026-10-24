"use client";

// Settings > About & updates: which Rooftap this server runs, and where the
// phone app is (core app-release.ts). The web app is served by the server it
// talks to, so it is always that server's version; the phone twin is
// apps/mobile's AppUpdates panel, which also compares the phone's own build.
import { Info } from "lucide-react";
import { serverVersionLabel, useModules, useServerRelease } from "@homeup/core";
import { ListGroup, ListItem, ListItemContent, ListItemTitle, ListItemTrailing } from "@/components/ui/list-item";
import { SettingsPanel } from "@/components/settings-panel";

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ListItem className="min-h-12 gap-3 px-3.5 py-2.5">
      <ListItemContent>
        <ListItemTitle>{label}</ListItemTitle>
      </ListItemContent>
      <ListItemTrailing className="text-sm tabular-nums text-muted-foreground">{children}</ListItemTrailing>
    </ListItem>
  );
}

export function VersionSettings() {
  const release = useServerRelease();
  const { schema } = useModules();
  const latest = release?.latestApp ?? null;
  return (
    <SettingsPanel icon={Info} title="Version">
      <ListGroup className="rounded-xl border-0 bg-muted/30 shadow-none divide-border/60">
        <InfoRow label="Rooftap">{serverVersionLabel(release, schema)}</InfoRow>
        <InfoRow label="Android app">
          {latest ? (
            <a href={latest.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              Get {latest.version}
            </a>
          ) : (
            "Not offered here"
          )}
        </InfoRow>
      </ListGroup>
    </SettingsPanel>
  );
}
