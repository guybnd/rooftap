// HOUP-437: Settings > Shopper. The price sources that apply to this
// household on this server, each with a switch. A switched-off source isn't
// asked for prices, stores or deals; prices it already found stay until the
// next check replaces them. Saves on toggle, no Save (M4).
// Web twin: apps/web/src/components/shopper-settings.tsx.
import * as React from 'react';
import { ShoppingBag } from 'lucide-react-native';
import { Text, toast } from '@homeup/ui';
import { sourceCapabilityLabel, useModules } from '@homeup/core';
import { setSourceEnabled, shopperSources, type ShopperSourceInfo } from '@/features/shopper/shopper-api';
import { SettingsInset, SettingsPanel, SettingsSwitchRow } from './settings-panel';

export function ShopperSettings() {
  const modules = useModules();
  const canSwitch = modules.server('shopper.source-switches');
  const [sources, setSources] = React.useState<ShopperSourceInfo[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    shopperSources()
      .then(setSources)
      .catch(() => setFailed(true));
  }, []);

  const toggle = async (id: string, enabled: boolean) => {
    setSources((prev) => prev?.map((s) => (s.id === id ? { ...s, enabled } : s)) ?? prev);
    try {
      await setSourceEnabled(id, enabled);
    } catch (err) {
      setSources((prev) => prev?.map((s) => (s.id === id ? { ...s, enabled: !enabled } : s)) ?? prev);
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  return (
    <SettingsPanel
      icon={ShoppingBag}
      title="Price sources"
      description="Where Shopper looks for prices, stores and deals for your household. You can always add a price by hand."
    >
      {failed ? (
        <Text className="text-sm text-muted-foreground">Couldn't load the sources. Check your connection and try again.</Text>
      ) : sources === null ? (
        <Text className="text-sm text-muted-foreground">Loading…</Text>
      ) : sources.length === 0 ? (
        <Text className="text-sm text-muted-foreground">No price sources cover your region on this server yet.</Text>
      ) : (
        <SettingsInset>
          {sources.map((s) => (
            <SettingsSwitchRow
              key={s.id}
              title={s.name}
              description={[sourceCapabilityLabel(s.capabilities), s.attribution].filter(Boolean).join(' · ')}
              checked={s.enabled !== false}
              disabled={!canSwitch}
              onChange={(next) => void toggle(s.id, next)}
            />
          ))}
        </SettingsInset>
      )}
      {!canSwitch && !!sources && sources.length > 0 && (
        <Text className="text-xs text-muted-foreground">Update your server to switch sources on and off.</Text>
      )}
    </SettingsPanel>
  );
}
