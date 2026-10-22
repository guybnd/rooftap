import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { upSignatureValid, upWebhookUrl } from "./up-bank";

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
