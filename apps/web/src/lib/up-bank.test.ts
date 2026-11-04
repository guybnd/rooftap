import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { emptyBankLineCopies, upSignatureValid, upWebhookUrl } from "./up-bank";

describe("upSignatureValid", () => {
  const body = JSON.stringify({ data: { attributes: { eventType: "PING" } } });
  const secret = "s3cret";
  const good = createHmac("sha256", secret).update(body).digest("hex");

  it("takes Up's HMAC of the raw body", () => {
    expect(upSignatureValid(body, good, secret)).toBe(true);
    expect(upSignatureValid(body, good.toUpperCase(), secret)).toBe(true);
  });
  it("refuses a missing, wrong or other-secret signature", () => {
    expect(upSignatureValid(body, null, secret)).toBe(false);
    expect(upSignatureValid(body, "abc", secret)).toBe(false);
    expect(upSignatureValid(body, good, "other")).toBe(false);
    expect(upSignatureValid(`${body} `, good, secret)).toBe(false);
  });
});

describe("upWebhookUrl", () => {
  it("builds the webhook address on a public https server", () => {
    expect(upWebhookUrl("https://homeup.vercel.app", "abc")).toBe("https://homeup.vercel.app/api/up-bank/webhook/abc");
  });
  it("gives none for a server Up can't reach", () => {
    expect(upWebhookUrl("http://rooftap.example.com", "abc")).toBeNull();
    expect(upWebhookUrl("https://localhost:3000", "abc")).toBeNull();
    expect(upWebhookUrl("https://rooftap.local", "abc")).toBeNull();
    expect(upWebhookUrl("https://192.168.1.20", "abc")).toBeNull();
    expect(upWebhookUrl("not a url", "abc")).toBeNull();
  });
});

describe("emptyBankLineCopies", () => {
  const now = Date.parse("2026-11-04T03:00:00Z");
  const line = (id: string, provider: string | null, created_at: string) => ({ id, provider, created_at });

  it("drops the empty copy and keeps the line with the payment", () => {
    const lines = [
      line("a", "Melbourne Airport", "2026-10-24T21:59:46.032Z"),
      line("b", "Melbourne Airport", "2026-10-24T21:59:46.047Z"),
    ];
    expect(emptyBankLineCopies(lines, new Map([["b", 1]]), now)).toEqual([{ keep: "b", drop: ["a"] }]);
  });
  it("matches payees without minding case or spaces", () => {
    const lines = [line("a", "AAMI", "2026-10-28T06:27:51Z"), line("b", " aami ", "2026-10-28T06:27:52Z")];
    expect(emptyBankLineCopies(lines, new Map([["a", 1]]), now)).toEqual([{ keep: "a", drop: ["b"] }]);
  });
  it("keeps the oldest when every copy is empty", () => {
    const lines = [line("b", "Snag", "2026-10-29T06:07:32.369Z"), line("a", "Snag", "2026-10-29T06:07:32.359Z")];
    expect(emptyBankLineCopies(lines, new Map(), now)).toEqual([{ keep: "a", drop: ["b"] }]);
  });
  it("leaves lines that both have payments, and single lines", () => {
    const lines = [line("a", "Coles", "2026-10-01T00:00:00Z"), line("b", "Coles", "2026-10-02T00:00:00Z"), line("c", "Aldi", "2026-10-02T00:00:00Z")];
    expect(emptyBankLineCopies(lines, new Map([["a", 2], ["b", 1]]), now)).toEqual([]);
  });
  it("waits before dropping a copy a run may still be filing", () => {
    const lines = [line("a", "Lobby", "2026-11-04T02:58:00Z"), line("b", "Lobby", "2026-11-04T02:58:01Z")];
    expect(emptyBankLineCopies(lines, new Map([["a", 1]]), now)).toEqual([]);
  });
});
