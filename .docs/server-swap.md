# Emergency server swap

> **TL;DR** If hosted Rooftap (Vercel and Supabase) fails, a self-hosted stack can take its place. Copy the data with `scripts/server-swap/export-hosted.sh` and `import-to-local.sh`. Then one OTA update moves every phone on "Official" to the new address. Do the preparation below now, while hosted works.

This page is the runbook for the hosted service. For a normal self-hosted install, read [self-hosting.md](self-hosting.md).

## What moves and what stays

| Part | During the swap |
|---|---|
| Accounts, passwords, Google sign-in links | Copied. People keep their passwords. |
| Household data, push tokens, bot API keys | Copied. |
| Files in Supabase Storage | Copied by the export. |
| Files in Cloudflare R2 (Documents) | Stay in R2. The stand-in reads them when it has the same `R2_*` settings. |
| Sessions | Lost. Everyone signs in again once, because the stand-in has its own signing key. |
| Push notifications, OTA updates | Work as before. Both go through Expo, not through the server. |
| Edge functions, reminders, bin night pushes | Run in the stack (`edge-runtime` and `pg_cron`). |

## Prepare now

Do these steps once, while hosted works. In an emergency, you then only run the steps in "The swap".

1. **Choose the address.** Use a Cloudflare Tunnel on a domain that you own (self-hosting.md, "With Cloudflare Tunnel"). Google needs a domain that it can verify for sign-in. A `ts.net` or `vercel.app` name does not work for this.
2. **Set up the stack once** on the stand-in machine with that tunnel profile. Check that a phone can reach `https://<address>/api/public-config`.
3. **Copy the hosted settings into `.env`.** Copy them from the Vercel project settings:
   - `HOUSEHOLD_KEYS_SECRET`. The saved AI keys, Home Assistant tokens and operator keys are encrypted with it. With another value, nobody can read them.
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Use the same Google client. Then the saved Calendar tokens continue to work.
   - The AI provider keys, `SERVER_OPERATOR_EMAILS`, `R2_*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET` and the VAPID keys.
   - `ROOFTAP_BILLING`, if hosted sets it. Without it, the stand-in gives every household the server's AI key with no limit.
4. **Add the stand-in to the Google client.** In Google Cloud, add `https://<address>/auth/v1/callback` to the allowed redirect URIs. Add the address to the authorized domains of the consent screen.
5. **Turn on Google sign-in in the stack.** Uncomment the `GOTRUE_EXTERNAL_GOOGLE_*` lines of the `auth` service. Set `ADDITIONAL_REDIRECT_URLS=https://<address>/**,mobile://**` in `.env`.
6. **Decide on sign-ups.** The stack closes sign-up after the first account. Hosted lets new people sign up. To keep that, set `GOTRUE_DISABLE_SIGNUP=false` in `.env`.
7. **Export on a schedule.** Run the export (below) every day on the stand-in machine. If hosted is not available, you can then load the last export.

## Export the data

```bash
HOSTED_DB_URL='postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres' \
HOSTED_SUPABASE_URL='https://<ref>.supabase.co' \
HOSTED_SERVICE_ROLE_KEY='<service_role key>' \
./scripts/server-swap/export-hosted.sh
```

- `HOSTED_DB_URL` is the "Session pooler" string. You find it in the Supabase dashboard, under the Connect button.
- The script writes a folder under `server-export/<UTC time>`. Git ignores this folder.
- The folder holds every password hash and every upload. Encrypt it, like any backup.
- The script needs only Docker and Node. It runs the Postgres tools in the `postgres:17` image.

## The swap

1. **Get the data.** If hosted is available, export now. If not, use the newest export folder.
2. **Match the version.** Check out the Rooftap commit that hosted runs. Its newest migration must match `migration.txt` in the export. Start the stack with `./scripts/self-host-init.sh -d --build` and the tunnel profile.
3. **Load the data.** Run `./scripts/server-swap/import-to-local.sh server-export/<time>`. It replaces all data on the stand-in, then uploads the files. If the versions do not match, it stops and changes nothing.
4. **Move the phones.** In `apps/mobile/src/lib/server-config.ts`, set `OFFICIAL_SERVER_STAND_IN` to `'https://<address>'`. Merge it to `main`. CI publishes the OTA update.
5. **If CI cannot publish**, publish the update by hand. When hosted Supabase is down, the `migrate` job fails, and that job blocks the OTA job. Run this from `apps/mobile`:

   ```bash
   npx eas-cli update --branch production --platform android --message "Move Official to the stand-in"
   ```

6. **Tell people.** A phone downloads the update on the next start and applies it on the start after. It then asks the stand-in for its settings and shows the sign-in screen. Phones that use a server that the person typed in do not move. On the web, people open `https://<address>`.
7. **Point Telegram at the stand-in.** Run the `setWebhook` command in self-hosting.md with the new address. Alternatively, delete the webhook and start the `telegram` profile.
8. **Start the scheduled jobs.** Add the two requests from self-hosting.md, "Scheduled jobs", to the machine's scheduler (Task Scheduler on Windows). Hosted uses Vercel Cron for them.
9. **Add the Assistant connector again.** In claude.ai, add `https://<address>/api/mcp` as a custom connector. Bot API keys are in the copied data, so other MCP clients continue to work with the new address.

## How the phones follow Official

When a person picks "Official", the phone stores a marker with the server address. On each start, the phone compares the stored address with the Official address in its JavaScript. If they differ and the marker is set, the phone asks the new address for `/api/public-config`. If it answers within four seconds, the phone moves there. If it does not answer, the phone stays and tries again on the next start.

Phones from before the marker count as Official when they use `https://homeup.vercel.app`. The logic is `officialServerMove` in `packages/core/src/server-origin.ts`. A phone needs no new APK, because this is JavaScript only.

## Going back

To move the phones back, set `OFFICIAL_SERVER_STAND_IN` to `null` and publish again. Data written on the stand-in is only on the stand-in. No script copies it back to hosted Supabase yet. Before you move back, copy that data to hosted by hand, or accept that it is lost.

## What we tested

We tested the scripts in a cloud container against the self-hosted stack:

- We exported from a stack with one account, a household, a task and an uploaded file. The account had quotes and backslashes in its data.
- We deleted all the volumes, started a fresh stack and imported the export.
- The account signed in with its old password. It read the task through the REST API and downloaded the file through Storage.
- A second import gave the same counts, with no duplicates.
- An export at another migration stopped the import before it changed anything.

We did not run the export against hosted Supabase, and we did not test the phone move on a real phone. Hosted runs newer auth and storage versions than the stack. The import copies only the columns that both have, but the first real export is the true check. Run one as part of "Prepare now".
