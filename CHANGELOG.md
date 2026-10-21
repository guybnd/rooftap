# Changelog

Rooftap's notable changes, newest first. Versions follow [semver](https://semver.org): a minor version for new features, a patch version for fixes.

The Android app also gets over-the-air updates between releases, so a release is cut when the app needs a new APK (new native code) or at a milestone. Each release and its APK are on the public repository's Releases page.

Each change people would notice gets a `whats-new/` entry (see `whats-new/README.md`), which the app also shows after an update. When cutting a release, `node scripts/whats-new.mjs changelog` prints the entries since the last one as lines for its section. Credit outside contributors with their GitHub handle.

## Unreleased

## 1.1.0 (2026-10-21)

This release ships a new APK: the widget fixes are native.

- Assistant: an optional module (off by default) that answers questions about the household and proposes changes for you to approve, on web and mobile, with quick asks, named chats, a household thread and cost controls.
- Shopper: an optional module (off by default) that watches things you want to buy, keeps the cheapest price across sources with a price history and a deal rating, and turns "Plan to buy" into a to-do and a planned cost.
- The home-screen widget fills its whole box, including with a non-default display size, and taps hit the row you touch.
- Each task row on the widget has a tick circle that finishes the task. Tapping the rest of the row opens the task. A tick shows "Finished <task>  Undo" for ten minutes.
- Groceries has a compact header that collapses as you scroll, and while a shop is tracked a floating pill holds the running total and a finish sheet scans the receipt.
- Tapping a grocery price opens a small editor beside it, and a plain tap on a row no longer opens the edit sheet.
- Checklists add new items above the Completed band.
- Costs categories get distinct colours. Deleting a document removes it from the list at once.
- Connect Claude to Rooftap by signing in. MCP read tools give short answers by default and full rows on request.
- Apartment photos are private: only the uploader's households can open them, through short-lived links.
- Self-hosting: Tailscale Funnel and Cloudflare Tunnel profiles give the server HTTPS for the phone app and the PWA with no open ports and nothing to install on the phone.
- Self-hosted upgrades back up the database before applying new migrations, and a failed migration is rolled back instead of left half done. `scripts/restore-backup.sh` undoes an upgrade.
- The app hides features a self-hosted server is too old for, and Settings > Modules says what updating the server would add.
- Hold a tab to choose its slot in the tab bar. More lists every section.
- Recipes no longer crash on a cached recipe that has no name.

## 1.0.0 (2026-10-20)

- First public release, under the new name Rooftap, with the spectrum roof icon.
- Self-hosting with Docker Compose. See the README.
