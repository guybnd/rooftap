"use client";

// Up Bank connector: the web app's calls to /api/up-bank, through core's shared
// client so request shapes match native. Native twin:
// apps/mobile/src/features/costs/up-bank-api.ts.
import { createBankImportApi, createUpBankApi, type UpBankCall } from "@homeup/core";

const call: UpBankCall = async (path, init) => {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as never;
};

export const upBankApi = createUpBankApi(call);

/** Bank statement import (/api/bank-import), on the same call. */
export const bankImportApi = createBankImportApi(call);
