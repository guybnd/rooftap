#!/usr/bin/env node
// HOUP-446: Telegram for a self-hosted Rooftap with no public HTTPS address.
// Long-polls Telegram for bot updates and hands each one to the app's webhook
// route on this machine, with the same secret header Telegram would send, so
// the app has a single code path. Run by the `telegram` compose profile:
//   docker compose --profile telegram up -d
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET (the app reads the
// same two). APP_PORT defaults to 3737.
//
// The app dedupes on update_id, so a restart that re-reads an update never
// answers twice.

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const target = process.env.TELEGRAM_FORWARD_URL || `http://127.0.0.1:${process.env.APP_PORT || 3737}/api/assistant/telegram/webhook`;

if (!token || !secret) {
  console.error("[telegram-poller] TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must both be set.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function telegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

async function forward(update) {
  // The app answers 200 once it has handled (or chosen to ignore) an update.
  // Keep retrying while it's down (starting up, restarting) so nothing is lost.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
        body: JSON.stringify(update),
      });
      if (res.ok) return;
      if (res.status === 401 || res.status === 404) {
        console.error(`[telegram-poller] the app refused updates (${res.status}): check TELEGRAM_* match on both sides.`);
      }
    } catch {
      // App not up yet.
    }
    await sleep(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
  }
}

async function main() {
  // getUpdates and a webhook are exclusive: drop any webhook left from a hosted setup.
  await telegram("deleteWebhook", { drop_pending_updates: false });
  const me = await telegram("getMe", {});
  console.log(`[telegram-poller] polling for @${me.username}, forwarding to ${target}`);

  let offset = 0;
  for (;;) {
    try {
      const updates = await telegram("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
      for (const update of updates) {
        await forward(update);
        offset = update.update_id + 1;
      }
    } catch (err) {
      console.error("[telegram-poller]", err instanceof Error ? err.message : err);
      await sleep(5000);
    }
  }
}

main().catch((err) => {
  console.error("[telegram-poller]", err);
  process.exit(1);
});
