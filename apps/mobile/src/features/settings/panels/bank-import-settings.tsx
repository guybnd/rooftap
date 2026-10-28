// Bank statement import (connector 'csv-bank', .docs/connectors.md):
// Settings > Connectors > Bank statement. A person picks a CSV their bank
// exported; the phone reads it (core's readBankCsv), shows what it found,
// and sends the payments once the person names the account. Each imported
// account lists with a Remove; the sharing choice is the same one Up Bank
// uses, so it shows here only for someone without Up. State lives in core's
// useBankImport. One primary action (PC).
// Web twin: apps/web/src/components/bank-import-settings.tsx.
import { View } from 'react-native';
import { FileText } from 'lucide-react-native';
import { Button, Input, Text, toast } from '@homeup/ui';
import { BANK_IMPORT_HELP, BANK_IMPORT_SHARE_CHOICES, csvSpanLabel, formatMoney, useBankImport, useModules } from '@homeup/core';
import { bankImportApi, pickStatementFile } from '@/features/costs/up-bank-api';
import { SettingsChoiceRow, SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from './settings-panel';

const OLD_SERVER = 'Your Rooftap server needs an update before it can import bank statements.';
const AUTO_COSTS_HELP =
  'Each payee in your joint accounts gets a cost line, and new payments land on it. Move a line to another category and later payments follow it.';
const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function BankImportSettings() {
  const modules = useModules();
  const supported = modules.server('connectors.bank-import');
  const s = useBankImport(bankImportApi, { enabled: supported, notify: (m) => toast.success(m) });

  if (!supported) return <SettingsPanel icon={FileText} title="Bank statement" description={OLD_SERVER} />;
  if (!s.status) return null;
  const { status, draft, preview } = s;

  const pick = async () => {
    try {
      const file = await pickStatementFile();
      if (file) s.open(file.name, file.text);
    } catch {
      toast.error("Couldn't read that file.");
    }
  };

  return (
    <SettingsPanel icon={FileText} title="Bank statement" description={BANK_IMPORT_HELP}>
      <View className="gap-3">
        {status.accounts.length > 0 && (
          <SettingsInset>
            {status.accounts.map((a) => (
              <View key={a.id} className="min-h-[52px] flex-row items-center gap-2 px-3.5 py-2.5">
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                    {a.name}
                  </Text>
                  <Text className="mt-0.5 text-xs text-muted-foreground" style={TABULAR}>
                    {a.joint ? 'Joint · ' : ''}
                    {a.count} {a.count === 1 ? 'payment' : 'payments'}
                    {csvSpanLabel(a) ? ` · ${csvSpanLabel(a)}` : ''}
                  </Text>
                </View>
                <Button variant="ghost" size="sm" disabled={s.busy} className="h-11" onPress={() => void s.remove(a.id)}>
                  <Text className="text-sm font-medium text-foreground">Remove</Text>
                </Button>
              </View>
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
                disabled={status.shareMode === 'none'}
                onChange={(on) => void s.setAutoCosts(on)}
              />
            )}
            {status.upConnected && (
              <Text className="px-3.5 py-2.5 text-xs text-muted-foreground">Shared the way you chose for Up Bank.</Text>
            )}
          </SettingsInset>
        )}

        {draft && preview && (
          <SettingsInset>
            <View className="gap-3 px-3.5 py-3">
              <View>
                <Text className="text-sm font-medium text-foreground" style={TABULAR}>
                  {preview.count} {preview.count === 1 ? 'payment' : 'payments'}
                  {csvSpanLabel(preview.span) ? ` · ${csvSpanLabel(preview.span)}` : ''}
                </Text>
                <Text className="mt-0.5 text-xs text-muted-foreground" style={TABULAR}>
                  {formatMoney(preview.outCents)} out · {formatMoney(preview.inCents)} in
                  {draft.read.skipped ? ` · ${draft.read.skipped} rows skipped` : ''}
                </Text>
              </View>
              <View className="gap-1">
                {preview.sample.map((t, i) => (
                  <View key={i} className="flex-row items-baseline gap-3">
                    <Text className="w-24 text-xs text-muted-foreground" style={TABULAR}>
                      {csvSpanLabel({ from: t.date, to: t.date })}
                    </Text>
                    <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground">
                      {t.description}
                    </Text>
                    <Text className="text-xs text-foreground" style={TABULAR}>
                      {formatMoney(t.amountCents)}
                    </Text>
                  </View>
                ))}
              </View>
              <View className="gap-1">
                <SettingsLabel>Account</SettingsLabel>
                <Input
                  accessibilityLabel="Account name"
                  value={draft.accountName}
                  maxLength={60}
                  onChangeText={(accountName) => s.change({ accountName })}
                  editable={!s.busy}
                  className="h-11"
                />
                {status.accounts.length > 0 && (
                  <View className="flex-row flex-wrap gap-1.5 pt-1">
                    {status.accounts.map((a) => (
                      <Button key={a.id} variant="outline" size="sm" disabled={s.busy} className="h-9 px-3" onPress={() => s.intoAccount(a.id)}>
                        <Text className="text-xs font-medium text-foreground">{a.name}</Text>
                      </Button>
                    ))}
                  </View>
                )}
              </View>
            </View>
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
            <View className="flex-row gap-2 px-3.5 py-3">
              <Button disabled={s.busy || !draft.accountName.trim()} onPress={() => void s.send()} className="h-11 px-3.5">
                <Text className="text-sm font-medium text-primary-foreground">{s.busy ? 'Importing…' : 'Import'}</Text>
              </Button>
              <Button variant="ghost" disabled={s.busy} onPress={s.cancel} className="h-11 px-3.5">
                <Text className="text-sm font-medium text-foreground">Cancel</Text>
              </Button>
            </View>
          </SettingsInset>
        )}

        {!draft && (
          <Button
            variant={status.accounts.length ? 'outline' : 'default'}
            disabled={s.busy}
            onPress={() => void pick()}
            className="h-11 self-start px-3.5"
          >
            <Text className={status.accounts.length ? 'text-sm font-medium text-foreground' : 'text-sm font-medium text-primary-foreground'}>
              {status.accounts.length ? 'Import another statement' : 'Import a statement'}
            </Text>
          </Button>
        )}
        {s.error && <Text className="text-xs text-destructive">{s.error}</Text>}
      </View>
    </SettingsPanel>
  );
}
