"use client";

// HOUP-443: the web app's calls to /api/assistant, through core's shared
// client so request shapes match native. Native twin:
// apps/mobile/src/features/assistant/assistant-api.ts.
import { assistantError, createAssistantApi, setAssistantUnread } from "@homeup/core";

export const assistantApi = createAssistantApi(
  async (path, init) => {
    const res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw assistantError(res.status, body);
    return body as never;
  },
  // HOUP-509: a chat reply read as it is written.
  async (path, body, onChunk) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    const contentType = res.headers.get("content-type");
    if (!res.body) return { status: res.status, contentType, text: await res.text() };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      onChunk(chunk);
    }
    const rest = decoder.decode();
    if (rest) {
      text += rest;
      onChunk(rest);
    }
    return { status: res.status, contentType, text };
  }
);

/** Re-reads how many conversations hold news for this person (the + dot). */
export function refreshAssistantUnread(): Promise<void> {
  return assistantApi
    .status()
    .then((s) => setAssistantUnread(s.unread ?? 0))
    .catch(() => {});
}
