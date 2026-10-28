"use client";

// Bank statement import (connector 'csv-bank', .docs/connectors.md):
// Settings > Connectors > Bank statement. A person picks a CSV their bank
// exported; the browser reads it (core's readBankCsv), shows what it found,
// and sends the payments once the person names the account. Each imported
// account lists with a Remove; the sharing choice is the same one Up Bank
// uses, so it shows here only for someone without Up. State lives in core's
// useBankImport. One primary action (PC).
// Native twin: apps/mobile/src/features/settings/panels/bank-import-settings.tsx.

import { useRef } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import {
  BANK_IMPORT_HELP,
  BANK_IMPORT_SHARE_CHOICES,
  csvSpanLabel,
  formatMoney,
  useBankImport,
  useModules,
} from "@homeup/core";
import { bankImportApi } from "@/lib/up-bank-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsChoiceRow, SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";

const OLD_SERVER = "Your Rooftap server needs an update before it can import bank statements.";
const AUTO_COSTS_HELP =
  "Each payee in your joint accounts gets a cost line, and new payments land on it. Move a line to another category and later payments follow it.";

export function BankImportSettings() {
  const modules = useModules();
  const supported = modules.server("connectors.bank-import");
  const s = useBankImport(bankImportApi, { enabled: supported, notify: (m) => toast.success(m) });
  const fileRef = useRef<HTMLInputElement>(null);

  if (!supported) return <SettingsPanel icon={FileText} title="Bank statement" description={OLD_SERVER} />;
  if (!s.status) return null;
  const { status, draft, preview } = s;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    s.open(file.name, await file.text());
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <SettingsPanel icon={FileText} title="Bank statement" description={BANK_IMPORT_HELP}>
      <div className="space-y-3">
        {status.accounts.length > 0 && (
          <SettingsInset>
            {status.accounts.map((a) => (
              <div key={a.id} className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {a.joint ? "Joint · " : ""}
                    {a.count} {a.count === 1 ? "payment" : "payments"}
                    {csvSpanLabel(a) ? ` · ${csvSpanLabel(a)}` : ""}
                  </p>
                </div>
                <Button variant="ghost" disabled={s.busy} onClick={() => void s.remove(a.id)}>
                  Remove
                </Button>
              </div>
            ))}
            {!status.upConnected &&
              BANK_IMPORT_SHARE_CHOICES.map((c) => (
                <SettingsChoiceRow
                  key={c.mode}
                  selected={status.shareMode === c.mode}
                  onSelect={() => void s.setShareMode(c.mode)}
                  title={c.title}
                  description={c.description}
                />
              ))}
            {!status.upConnected && (
              <SettingsSwitchRow
                title="File joint payments as costs"
                description={AUTO_COSTS_HELP}
                checked={status.autoCosts}
                disabled={status.shareMode === "none"}
                onChange={(on) => void s.setAutoCosts(on)}
              />
            )}
            {status.upConnected && (
              <p className="px-3.5 py-2.5 text-xs text-muted-foreground">Shared the way you chose for Up Bank.</p>
            )}
          </SettingsInset>
        )}

        {draft && preview && (
          <SettingsInset>
            <div className="space-y-3 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-foreground tabular-nums">
                  {preview.count} {preview.count === 1 ? "payment" : "payments"}
                  {csvSpanLabel(preview.span) ? ` · ${csvSpanLabel(preview.span)}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {formatMoney(preview.outCents)} out · {formatMoney(preview.inCents)} in
                  {draft.read.skipped ? ` · ${draft.read.skipped} rows skipped` : ""}
                </p>
              </div>
              <div className="space-y-1">
                {preview.sample.map((t, i) => (
                  <div key={i} className="flex items-baseline gap-3 text-xs">
                    <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{csvSpanLabel({ from: t.date, to: t.date })}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{t.description}</span>
                    <span className="shrink-0 text-foreground tabular-nums">{formatMoney(t.amountCents)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <SettingsLabel>Account</SettingsLabel>
                <Input
                  aria-label="Account name"
                  value={draft.accountName}
                  maxLength={60}
                  onChange={(e) => s.change({ accountName: e.target.value })}
                  disabled={s.busy}
                />
                {status.accounts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {status.accounts.map((a) => (
                      <Button key={a.id} variant="outline" size="sm" disabled={s.busy} onClick={() => s.intoAccount(a.id)}>
                        {a.name}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <SettingsSwitchRow
              title="Joint account"
              description="An account you share with someone in your home, such as a 2Up account."
              checked={draft.joint}
              disabled={s.busy}
              onChange={(joint) => s.change({ joint })}
            />
            <SettingsSwitchRow
              title="Money out shows as positive"
              description="Some banks and cards list spending without a minus sign. Turn this on if the amounts above look the wrong way round."
              checked={draft.flipped}
              disabled={s.busy}
              onChange={(flipped) => s.change({ flipped })}
            />
            <div className="flex gap-2 px-3.5 py-3">
              <Button disabled={s.busy || !draft.accountName.trim()} onClick={() => void s.send()}>
                {s.busy ? "Importing…" : "Import"}
              </Button>
              <Button variant="ghost" disabled={s.busy} onClick={s.cancel}>
                Cancel
              </Button>
            </div>
          </SettingsInset>
        )}

        {!draft && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <Button variant={status.accounts.length ? "outline" : "default"} disabled={s.busy} onClick={() => fileRef.current?.click()}>
              {status.accounts.length ? "Import another statement" : "Import a statement"}
            </Button>
          </>
        )}
        {s.error && <p className="text-xs text-destructive">{s.error}</p>}
      </div>
    </SettingsPanel>
  );
}
