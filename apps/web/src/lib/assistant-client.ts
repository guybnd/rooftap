// HOUP-443: the web app's calls to /api/assistant, through core's shared
// client so request shapes match native. Native twin:
// apps/mobile/src/features/assistant/assistant-api.ts.
import { assistantError, createAssistantApi, setAssistantUnread } from "@homeup/core";

export const assistantApi = createAssistantApi(async (path, init) => {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw assistantError(res.status, body);
  return body as never;
});

/** Re-reads how many conversations hold news for this person (the + dot). */
export function refreshAssistantUnread(): Promise<void> {
  return assistantApi
    .status()
    .then((s) => setAssistantUnread(s.unread ?? 0))
    .catch(() => {});
}
