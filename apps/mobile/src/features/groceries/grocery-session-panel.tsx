// HOUP-80: native port of apps/web/src/app/groceries/grocery-session-panel.tsx
// — trimmed to tracking on/off, the running total (tap-to-override), got/
// unpriced counts, and stop-tracking/done-shopping.
//
// HOUP-226: adds the receipt path web already had — capture (camera/library/
// PDF, via index.tsx's picker), OCR scan (`parseReceiptFile` → receipt_total_
// cents + retailer + applyReceiptLearning), a total-source label, a Pencil
// edit affordance alongside the existing tap-to-edit, and an attached/error
// status sub-line with tap-to-retry. Reads `session` directly (was a
// separate `receiptName` prop) to compute the source label the same way web
// does. Hearth v2 (H2/H4): every state is a neutral rounded-3xl card (web
// matches); no green borders or fills. Add item keeps the screen's one accent
// fill, so Track and Done shopping are neutral outline buttons, and Stop
// tracking is an X icon (as on web) so the action row fits at 390px.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Camera, Check, Loader2, Pencil, Receipt, ScanLine, X } from 'lucide-react-native';
import { Text, Button, Card, Input } from '@homeup/ui';
import { effectiveSessionTotal, formatMoney, useModules, type GrocerySession } from '@homeup/core';

interface GrocerySessionPanelProps {
  session: GrocerySession | null;
  summedCents: number;
  boughtCount: number;
  unpricedCount: number;
  onStartTracking: () => void;
  onSkipTracking: () => void;
  onOverrideTotal: (cents: number | null) => void;
  onStopTracking: () => void;
  onDoneShopping: () => void;
  onAddReceipt: () => void;
  onScanReceipt: () => void;
  receiptBusy?: boolean;
  scanning?: boolean;
  receiptError?: string | null;
}

export function GrocerySessionPanel({
  session,
  summedCents,
  boughtCount,
  unpricedCount,
  onStartTracking,
  onSkipTracking,
  onOverrideTotal,
  onStopTracking,
  onDoneShopping,
  onAddReceipt,
  onScanReceipt,
  receiptBusy,
  scanning,
  receiptError,
}: GrocerySessionPanelProps) {
  const [editingTotal, setEditingTotal] = React.useState(false);
  const [totalDraft, setTotalDraft] = React.useState('');
  const modules = useModules();
  // Modules: the trip only lands in Costs when costs and groceries are both on (module-features.ts).
  const toCosts = modules.feature('costs.from-groceries');

  if (!session) {
    if (boughtCount === 0) return null;

    return (
      <Card className="gap-2.5 rounded-3xl px-4 py-3">
        <View className="flex-row items-start gap-3">
          <Receipt size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-foreground">Track today's shop?</Text>
            <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {boughtCount} in cart · ~{formatMoney(summedCents)} so far
            </Text>
            {toCosts && <Text className="text-caption text-muted-foreground">Adds to Costs as a grocery purchase</Text>}
          </View>
        </View>
        <View className="flex-row justify-end gap-2">
          <Button size="sm" variant="ghost" onPress={onSkipTracking}>
            Not today
          </Button>
          <Button size="sm" variant="outline" onPress={onStartTracking}>
            Track
          </Button>
        </View>
      </Card>
    );
  }

  if (session.tracking === 'skipped') {
    return (
      <Pressable
        onPress={onStartTracking}
        accessibilityRole="button"
        className="min-h-11 flex-row items-center gap-2 self-start rounded-full border border-border bg-muted px-4 py-2"
      >
        <Receipt size={14} className="text-muted-foreground" />
        <Text className="text-sm text-foreground">Track today's shop</Text>
      </Pressable>
    );
  }

  const total = effectiveSessionTotal(session);
  const source = session.override_total_cents != null ? 'manual total' : session.receipt_total_cents != null ? 'from receipt' : 'estimated';

  const commit = () => {
    onOverrideTotal(totalDraft.trim() === '' ? null : Math.round(parseFloat(totalDraft) * 100));
    setEditingTotal(false);
  };

  const startEditing = () => {
    setTotalDraft(String(total / 100));
    setEditingTotal(true);
  };

  return (
    <Card className="gap-2 rounded-3xl px-4 py-3">
      <View className="flex-row items-center justify-between gap-2">
        {editingTotal ? (
          <View className="flex-1 flex-row items-center gap-2">
            <Input
              autoFocus
              keyboardType="decimal-pad"
              value={totalDraft}
              onChangeText={setTotalDraft}
              onSubmitEditing={commit}
              onBlur={commit}
              className="flex-1"
              placeholder="0.00"
            />
            <Button size="icon-sm" variant="outline" onPress={commit} accessibilityLabel="Save total">
              <Check size={16} className="text-primary" />
            </Button>
          </View>
        ) : (
          <Pressable onPress={startEditing} className="flex-1 flex-row items-baseline gap-2">
            {/* H1: the screen lede is the only display-weight element — this
                running total steps down to body weight. T3: money stays out
                of mono; tabular figures do the aligning. */}
            <Text className="text-sm font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(total)}
            </Text>
            <Text className="text-caption text-muted-foreground">{source}</Text>
          </Pressable>
        )}
        <Text className="shrink-0 text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {boughtCount} got
          {unpricedCount > 0 ? ` · ${unpricedCount} unpriced` : ''}
        </Text>
      </View>
      {/* Actions right-aligned on their own row; the receipt status line
          sits under them at full width so it never truncates to nothing. */}
      <View className="flex-row items-center justify-end gap-1">
        {!editingTotal && (
          <Button size="icon-sm" variant="ghost" onPress={startEditing} accessibilityLabel="Override total">
            <Pencil size={14} className="text-muted-foreground" />
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          onPress={onAddReceipt}
          disabled={receiptBusy}
          accessibilityLabel={session.receipt_path ? 'Replace receipt' : 'Add receipt'}
        >
          {receiptBusy ? <Loader2 size={14} className="animate-spin text-foreground" /> : <Camera size={14} className={session.receipt_path ? 'text-foreground' : 'text-muted-foreground'} />}
        </Button>
        {session.receipt_path && (
          <Button size="icon-sm" variant="ghost" onPress={onScanReceipt} disabled={scanning} accessibilityLabel="Scan receipt">
            {scanning ? <Loader2 size={14} className="animate-spin text-foreground" /> : <ScanLine size={14} className="text-foreground" />}
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" onPress={onStopTracking} accessibilityLabel="Stop tracking today">
          <X size={16} className="text-muted-foreground" />
        </Button>
        <Button size="sm" variant="outline" onPress={onDoneShopping} className="ml-1">
          Done shopping
        </Button>
      </View>
      {receiptError ? (
        <Pressable onPress={onAddReceipt} accessibilityRole="button">
          <Text className="text-caption text-destructive" numberOfLines={1}>
            {receiptError}
          </Text>
        </Pressable>
      ) : session.receipt_path ? (
        <Text className="text-caption text-muted-foreground" numberOfLines={1}>
          {session.receipt_name ?? 'Receipt'} attached
          {session.receipt_total_cents == null ? ' · tap scan to read total' : ''}
        </Text>
      ) : null}
    </Card>
  );
}
