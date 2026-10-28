import { describe, expect, it } from 'vitest';
import {
  accountNameFromFile,
  csvAccountId,
  csvDate,
  csvDateSpan,
  csvLooksFlipped,
  csvTransactionIds,
  guessDateOrder,
  parseCsv,
  parseMoneyCents,
  readBankCsv,
} from './bank-csv';

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('finds a semicolon or tab between cells', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseMoneyCents', () => {
  it.each([
    ['12.50', 1250],
    ['-12.50', -1250],
    ['+1,234.56', 123456],
    ['$1,234.56', 123456],
    ['-$4.00', -400],
    ['(7.25)', -725],
    ['12.00 DR', -1200],
    ['12.00 CR', 1200],
    ['12,50', 1250],
    ['1.234,50', 123450],
    ['AUD 3.10', 310],
    ['5', 500],
  ])('%s is %d cents', (cell, cents) => {
    expect(parseMoneyCents(cell)).toBe(cents);
  });

  it.each(['', 'Amount', 'WOOLWORTHS 1234', '12/03/2026'])('%s is not money', (cell) => {
    expect(parseMoneyCents(cell)).toBeNull();
  });
});

describe('dates', () => {
  it('reads day first by default, month first when a value proves it, and year first', () => {
    expect(guessDateOrder(['03/04/2026', '05/04/2026'])).toBe('dmy');
    expect(guessDateOrder(['03/04/2026', '12/31/2026'])).toBe('mdy');
    expect(guessDateOrder(['2026-04-03'])).toBe('ymd');
    expect(csvDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(csvDate('12/31/2026', 'mdy')).toBe('2026-12-31');
    expect(csvDate('2026-04-03T10:00:00', 'ymd')).toBe('2026-04-03');
    expect(csvDate('3/4/26', 'dmy')).toBe('2026-04-03');
    expect(csvDate('31/02/2026', 'dmy')).toBeNull();
  });
});

describe('readBankCsv', () => {
  it('reads a CSV with no header: date, amount, description, balance', () => {
    const text = [
      '27/10/2026,"-12.50","WOOLWORTHS 1234 SYDNEY","+1,000.00"',
      '28/10/2026,"+2,000.00","Salary ACME PTY LTD","+3,000.00"',
      '28/10/2026,"-80.00","ORIGIN ENERGY 0400","+2,920.00"',
    ].join('\n');
    const read = readBankCsv(text)!;
    expect(read.mapping).toMatchObject({ header: false, date: 0, amount: 1, description: 2, balance: 3 });
    expect(read.transactions[0]).toEqual({ date: '2026-10-27', description: 'WOOLWORTHS 1234 SYDNEY', amountCents: -1250, balanceCents: 100000 });
    expect(read.skipped).toBe(0);
  });

  it('reads debit and credit columns from a header', () => {
    const text = [
      'Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial',
      '032000123456,28/10/2026,DEBIT CARD PURCHASE COLES,45.10,,954.90,POS,',
      '032000123456,29/10/2026,DEPOSIT FROM SAM,,100.00,1054.90,DEP,',
    ].join('\n');
    const read = readBankCsv(text)!;
    expect(read.mapping).toMatchObject({ header: true, date: 1, description: 2, debit: 3, credit: 4, balance: 5, amount: null });
    expect(read.transactions.map((t) => t.amountCents)).toEqual([-4510, 10000]);
  });

  it('reads an amount column by name and month-first dates', () => {
    const text = ['Posted Date,Payee,Amount', '10/30/2026,Netflix,-15.99', '10/13/2026,Refund,4.00', 'Total,,-11.99'].join('\n');
    const read = readBankCsv(text)!;
    expect(read.mapping.dateOrder).toBe('mdy');
    expect(read.transactions).toHaveLength(2);
    expect(read.transactions[0]).toMatchObject({ date: '2026-10-30', description: 'Netflix', amountCents: -1599 });
    expect(read.skipped).toBe(1);
  });

  it('gives up on a file with no dates', () => {
    expect(readBankCsv('name,age\nSam,4')).toBeNull();
  });
});

describe('ids and helpers', () => {
  it('gives identical payments on the same day their own stable ids', () => {
    const t = { date: '2026-10-28', description: 'Coffee', amountCents: -450, balanceCents: null };
    const ids = csvTransactionIds('csv-joint', [t, t]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(csvTransactionIds('csv-joint', [t, t])).toEqual(ids);
    expect(ids[0].startsWith('csv-joint:')).toBe(true);
  });

  it('keeps an account id stable for a name', () => {
    expect(csvAccountId('Joint account')).toBe(csvAccountId(' joint ACCOUNT '));
    expect(csvAccountId('Joint account')).toMatch(/^csv-joint-account-[0-9a-f]{6}$/);
  });

  it('names an account from its file and spots a flipped statement', () => {
    expect(accountNameFromFile('joint-account_2026.csv')).toBe('Joint account 2026');
    const pos = (n: number) => ({ date: '2026-10-01', description: 'x', amountCents: n, balanceCents: null });
    expect(csvLooksFlipped([pos(1), pos(2), pos(3)])).toBe(true);
    expect(csvLooksFlipped([pos(1), pos(-2), pos(3)])).toBe(false);
    expect(csvDateSpan([{ ...pos(1), date: '2026-10-05' }, pos(2)])).toEqual({ from: '2026-10-01', to: '2026-10-05' });
  });
});

describe('bank data status', async () => {
  const { bankDataOn, bankShareModeOf, summariseAccounts } = await import('./up-bank');
  const { bankImportPreview } = await import('./use-bank-import');

  it('counts an imported statement as bank data, with its sharing', () => {
    const base = { allowed: false, canStore: true, connection: null };
    expect(bankDataOn(base)).toBe(false);
    expect(bankDataOn({ ...base, imported: { shareMode: 'joint' } })).toBe(true);
    expect(bankShareModeOf({ ...base, imported: { shareMode: 'joint' } })).toBe('joint');
    const up = { last4: '1234', shared: true, shareMode: 'all' as const, live: false, lastSyncedAt: null };
    expect(bankShareModeOf({ ...base, allowed: true, connection: up, imported: { shareMode: 'none' } })).toBe('all');
  });

  it('leaves an account with no known balance out of the totals', () => {
    const row = { user_id: 'u', group_id: 'g', source: 'csv', name: 'Joint', account_type: 'TRANSACTIONAL' as const, ownership: 'JOINT' as const, balance_cents: 0, currency: 'AUD' };
    const { accounts } = summariseAccounts([
      { ...row, external_id: 'a', has_balance: false },
      { ...row, external_id: 'b', balance_cents: 500 },
    ]);
    expect(accounts.map((a) => a.id)).toEqual(['b']);
  });

  it('previews a draft with its signs turned around', () => {
    const read = readBankCsv('01/10/2026,12.00,Coffee\n02/10/2026,30.00,Fuel\n03/10/2026,5.00,Bread')!;
    const preview = bankImportPreview({ fileName: 'x.csv', read, accountName: 'X', joint: false, flipped: true });
    expect(preview.outCents).toBe(4700);
    expect(preview.sample[0].description).toBe('Bread');
    expect(preview.span).toEqual({ from: '2026-10-01', to: '2026-10-03' });
  });
});
