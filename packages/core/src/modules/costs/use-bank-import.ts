'use client';

// Bank statement import (connector 'csv-bank'): the state behind the
// Settings > Connectors > Bank statement panel on both apps. Each app picks
// the file its own way and hands over the name and text; this reads it,
// holds the draft the person checks (account name, joint, flipped signs),
// sends it, and keeps the list of imported accounts and the sharing choice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  accountNameFromFile,
  csvDateSpan,
  csvLooksFlipped,
  flipCsvAmounts,
  readBankCsv,
  type BankImportApi,
  type BankImportStatus,
  type CsvReadResult,
  type CsvTransaction,
} from './bank-csv';
import type { BankShareMode } from './up-bank';

/** The sharing choices for imported accounts, in the panel's order. */
export const BANK_IMPORT_SHARE_CHOICES: readonly { mode: BankShareMode; title: string; description: string }[] = [
  { mode: 'joint', title: 'Share joint accounts', description: 'The household sees the accounts you mark as joint. Your own stay under Mine.' },
  { mode: 'all', title: 'Share everything', description: 'The household sees every account you import.' },
  { mode: 'none', title: 'Keep it to myself', description: 'Only you see what you import.' },
];

export const BANK_IMPORT_HELP =
  "Export a CSV statement from your bank's website and pick it here. Rooftap reads it on this device, shows what it found, then saves the payments. Import a newer statement any time, and Rooftap skips the payments it already has.";

export interface BankImportDraft {
  fileName: string;
  read: CsvReadResult;
  accountName: string;
  joint: boolean;
  /** Money out shows as positive in the file, so every sign is turned around. */
  flipped: boolean;
}

export interface BankImportPreview {
  transactions: CsvTransaction[];
  count: number;
  span: { from: string; to: string } | null;
  /** The newest few, for the person to check the columns were read right. */
  sample: CsvTransaction[];
  outCents: number;
  inCents: number;
}

/** What a draft would import, signs turned around when flipped. */
export function bankImportPreview(draft: BankImportDraft): BankImportPreview {
  const transactions = draft.flipped ? flipCsvAmounts(draft.read.transactions) : draft.read.transactions;
  let outCents = 0;
  let inCents = 0;
  for (const t of transactions) {
    if (t.amountCents < 0) outCents -= t.amountCents;
    else inCents += t.amountCents;
  }
  return {
    transactions,
    count: transactions.length,
    span: csvDateSpan(transactions),
    sample: [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3),
    outCents,
    inCents,
  };
}

export function useBankImport(api: BankImportApi, opts: { enabled: boolean; notify?: (message: string) => void }) {
  const { enabled, notify } = opts;
  const [status, setStatus] = useState<BankImportStatus | null>(null);
  const [draft, setDraft] = useState<BankImportDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api
      .status()
      .then((s) => live && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, enabled]);

  /** Reads a picked file. False (with an error) when its columns can't be worked out. */
  const open = useCallback((fileName: string, text: string): boolean => {
    setError(null);
    const read = readBankCsv(text);
    if (!read || !read.transactions.length) {
      setDraft(null);
      setError("Rooftap couldn't find dates, descriptions and amounts in that file. Export it from your bank as CSV and try again.");
      return false;
    }
    setDraft({ fileName, read, accountName: accountNameFromFile(fileName), joint: false, flipped: csvLooksFlipped(read.transactions) });
    return true;
  }, []);

  const change = useCallback((patch: Partial<Pick<BankImportDraft, 'accountName' | 'joint' | 'flipped'>>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  /** Picks an account already imported, so a newer statement adds to it. */
  const intoAccount = useCallback(
    (id: string) => {
      const account = status?.accounts.find((a) => a.id === id);
      if (account) change({ accountName: account.name, joint: account.joint });
    },
    [status, change],
  );

  const preview = useMemo(() => (draft ? bankImportPreview(draft) : null), [draft]);

  const send = useCallback(async () => {
    if (!draft || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importFile({ accountName: draft.accountName.trim(), joint: draft.joint, transactions: preview.transactions });
      setStatus(result.status);
      setDraft(null);
      notify?.(
        result.existing
          ? `Imported ${result.added} new ${result.added === 1 ? 'payment' : 'payments'}. ${result.existing} ${result.existing === 1 ? 'was' : 'were'} already there.`
          : `Imported ${result.added} ${result.added === 1 ? 'payment' : 'payments'}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't import that file.");
    } finally {
      setBusy(false);
    }
  }, [api, draft, preview, notify]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        setStatus(await api.remove(id));
        notify?.('Account and its payments removed.');
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't remove that account.");
      } finally {
        setBusy(false);
      }
    },
    [api, notify],
  );

  const save = useCallback(
    async (patch: { shareMode?: BankShareMode; autoCosts?: boolean }) => {
      if (!status) return;
      const before = status;
      setStatus({ ...status, ...patch });
      try {
        setStatus(await api.save(patch));
      } catch (err) {
        setStatus(before);
        setError(err instanceof Error ? err.message : 'Could not save that.');
      }
    },
    [api, status],
  );

  return {
    status,
    draft,
    preview,
    busy,
    error,
    open,
    change,
    intoAccount,
    cancel: () => {
      setDraft(null);
      setError(null);
    },
    send,
    remove,
    setShareMode: (shareMode: BankShareMode) => save({ shareMode }),
    setAutoCosts: (autoCosts: boolean) => save({ autoCosts }),
  };
}

export type BankImportState = ReturnType<typeof useBankImport>;
