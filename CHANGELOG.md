# Changelog

Rooftap's notable changes, newest first. Versions follow [semver](https://semver.org): a minor version for new features, a patch version for fixes.

The Android app also gets over-the-air updates between releases, so a release is cut when the app needs a new APK (new native code) or at a milestone. Each release and its APK are on the public repository's Releases page.

Each change people would notice gets a `whats-new/` entry (see `whats-new/README.md`), which the app also shows after an update. When cutting a release, `node scripts/whats-new.mjs changelog` prints the entries since the last one as lines for its section. Credit outside contributors with their GitHub handle.

## Unreleased

## 1.3.0 (2026-11-11)

This release ships a new APK: snooze task and event reminders straight from the notification. It installs over 1.2.0.

- Sign up, reset a password, delete an account. Make an account with your email, and get a link when you forget your password, where the server allows it. Delete your account in Settings, About. A home that you share stays with the others.
- The household chat keeps Just me items private. The household chat no longer shows Just me to-dos, events, Setup items or loyalty cards, even your own. Ask about them in your own chat.
- New households start with the everyday tiles. A new household now starts with Groceries, Recipes, Meal plan and Costs on, next to Tasks, Calendar, Documents and Checklists. Households that already chose their tiles keep them.
- An easier start for new homes. A new home now starts from a set of tiles in one tap, and can look around a sample home first. Home shows a short list of first steps for the first two weeks.
- Faster helper switching on the phone. Switching between helpers in the chat now updates the chat in place instead of building it again, so the new helper shows sooner. Switching to Rooftap also no longer opens the keyboard.
- Invite people with a link or QR code. Share one link or QR code, and the person joins your home. They can make an account on the same page, so they do not need one first.
- First week helps you set up Rooftap on iPhone. On an iPhone, the First week card on Home shows how to add Rooftap to the Home Screen. Once it is there, the card asks you to turn on notifications.
- Rooftap on iPhone, from the Home Screen. On an iPhone or iPad, add Rooftap to the Home Screen from Safari. It gets the Rooftap icon and name, and can send you notifications.
- The phone app opens on sign-in. On a first launch the phone app now opens on sign-in. If you run your own server, tap Use my own server under the form.
- Quieter empty screens. An empty Groceries list no longer offers to add an aisle. Empty Documents and Costs no longer suggest questions with nothing to answer from.
- Put several people on a to-do or event. Under Who, tap more than one face to make a to-do or event for several people. Each of them gets the reminders and sees it under Mine, and Home shows all their faces.
- Snooze a reminder from the notification. Task and event reminders on your phone now have snooze buttons, 1 hour, 1 day and 1 week to start. Pick your own in Settings. Bin night and time to leave get short ones.
- What's new opens on the latest release. The list of changes in Settings now shows only the newest release. Older releases fold to one line each, so tap one to see what it brought.
- Swap chats from the chat bubble. Hold the chat bubble still to see your other chats and switch to one, or close the bubble. On a computer, right-click it.
- Smoother chat on the web. The moving rainbow edge round the chat made the whole chat redraw on every frame. Now only the edge redraws, so switching helpers and scrolling the chat respond much faster in the browser.
- Choose who an event is for, and when to be reminded. An event can now be for one person in your household. Pick them under Who. Reminders now also offer 2 and 3 days before, and Custom sets any number of days up to 30.
- Home shows who an event is for. When you pick someone under Who on an event, Home now shows their face on the event row straight away. Before, it showed who added the event.
- Faster switching between helpers. The helper you tap in the chat now lights up at once, and a long chat opens on its latest messages. Tap Show earlier to see older ones.
- Fewer false load errors. A short network drop no longer leaves a "Couldn't load your household" bar on the screen. The app tries again on its own first. If it still fails, a small chip at the top says so and no longer covers the date.
- Move the chat bubble. Drag the chat bubble to move it out of the way. It snaps to the nearer side and stays where you leave it.
- Settings in colour. The Settings tabs are now five coloured tiles, and each setting has its own coloured icon. Connected is now called Linked.
- Terms and privacy at sign-in. The sign-in screen now links the Terms and the Privacy Policy of the hosted service. The Privacy page now also covers Assistant chats, bank feeds and where your data is kept.
- Change notes show in full. On the phone, the list of app changes now shows the short description under each title.
- Assistant settings in tabs. Assistant settings now open in tabs: General, Helpers, Memories, Spending and Connections. Each helper card shows who sees its chat and a full box for your notes.
- Answers show your real items. Rooftap now shows things you have, such as your list by aisle, as their real rows. You can tick and edit them in the chat. A helper's summary also stays above your questions.
- The chat bubble shows when a reply is in. When you leave a chat and it answers, its bubble or Back to chat pill now shows a dot and says who replied. Close the bubble with its small x; holding it no longer makes it vanish.
- Tidier chat answers and chat picker. Rows in an answer now span the whole chat, so they sit centred like the helper's own rows. When you hold the Rooftap button to pick a chat, the one you will open wears the rainbow outline.
- Deleted items stay deleted. When you delete something on one device, an older edit from another device that was offline no longer brings it back.
- Meet the Groceries helper. Tap the Rooftap mark on your shopping list. The helper opens on what this week's dinners still need and the things you usually buy again, and one tap adds each to the list. Then ask it to plan or trim the shop.
- Helper asks sit above the text box. In a helper chat, Catch me up and the other suggested asks now sit just above the text box. You no longer scroll down past the summary to find them.
- Smoother helper chats with rows you can swipe. Moving between Rooftap and a helper now swaps the chat in place. The brief uses your list's own rows, so you can swipe one away. The helper also offers new things you can add with one tap.
- The open helper wears the rainbow. In the row of helpers, the chat you have open now has the same rainbow outline as the chat card, so you can see which one is up.
- Helpers answer with rows. Helpers now show to-dos, bills and recipes as rows you can tick and open, not as a typed list. The row of helpers keeps its place when you pick one.
- Each helper has its own mark. A helper chat now shows the Rooftap roof over the helper's own icon, in its colour. You can tell at a glance which helper you are talking to.
- Helpers open at the top. A helper chat now opens at the top of its summary, not at the bottom. The chat also moves more smoothly when the keyboard opens.
- Quicker ways into your helpers. Hold the + and slide up to open a helper or Rooftap. In the chat, tap or swipe the row at the top to switch between them. After you open an item from a chat, a Back to chat button takes you back.
- Four new helpers for money, your week, dinners and gifts. Costs, Tasks, Recipes and Occasions now have their own helper chat. Each one opens on what needs you today, such as bills due, overdue to-dos, open nights or a birthday with no gift yet.
- Add a recipe without leaving the screen. Recipe in the + menu now opens the form over the screen you are on. Before, the screen behind went blank or you landed on Recipes. After you save, tap Open to see the recipe.
- Settings in five tabs. Settings now opens on five tabs: You, Home, Tiles, Connected and About. Each setting folds into one short row, so you can find it without scrolling, and a tap opens it.
- Share a helper chat with your household. In Settings, Assistant, owners can make a helper chat one the whole home shares, so anyone can add to the shop there. Each helper also takes short notes, such as where you shop.
- Modules are now tiles. Each part of Rooftap is now called a tile. Turn tiles on or off in Settings > Tiles. The people in your household are under Settings > Home.

## 1.2.0 (2026-11-07)

This release ships a new APK: ask the Assistant by voice with the phone's own speech recognition. It installs over 1.1.1 to 1.1.3.

- A fresh look for Ask Rooftap. The chat now greets you and suggests things worth asking, like planning dinners or adding everything for a recipe. Its edge glows in Rooftap's colours and spins faster while it thinks. Tap the mic to ask by voice.
- Connect a shared speaker safely. When you connect an app by signing in, you can now mark it as a shared device. Use it for a speaker the whole home can hear. It then leaves out gift plans, surprises and anything kept from someone.
- One cost line for each shop. A new payment from your bank sometimes made two cost lines for the same shop. The extra line was empty, but the Assistant could count it as a second payment. Each shop now gets one line, and the empty copies are removed.
- Deleted to-dos stay gone. Once a day, Home could show a list of blank to-dos with no title under No date. These were to-dos that you deleted. They no longer come back.
- A shorter Version card. About & updates now shows the app and the server on two rows, with the build details on one small line. The line names the update you run again, and you can long-press it to copy it.
- Bin days always save. Save in the bin days sheet now works while a council calendar or Home Assistant read is still running. A read that fails now shows a message, and the sheet does not stay stuck on "Reading".
- Checklists open again on the phone. A checklist with checked items could show "This screen didn't load" on the phone. It now opens, and checked items stay newest first.
- Crashes report themselves. When a screen does not load, the app now tells the people who run your server what broke. Reports never hold your name, household or items, and you can turn them off.
- Update your own server with one tap. If you run your own Rooftap server, About & updates can now install a new release for you. It backs up first and goes back to the old version if anything fails.
- Repeat a to-do on real calendar dates. A to-do can now repeat on the 1st of every month, the first Sunday, the last day, chosen weekdays or yearly. It can also stop on a date. Pick it from the Repeat list. The Assistant knows these repeats too.
- Save works on a home server without https. On a server you open by its local address over plain http, Save and Add did nothing in many sheets, such as bin days. They now work.
- Assistant tools listed by module. Settings now lists the tools an AI assistant can use module by module, in the same order as your modules.
- Import a bank statement. Any bank now works with Costs. Export a CSV statement from your bank and import it in Settings, Connectors. Your payments show in Costs next to your bills, and a newer statement adds only the new payments.
- Checklists from a template save every item. A new checklist from a template sometimes lost its items and showed a save error. Now the items save as soon as the checklist does. The date spinner arrows on a checklist work again.
- Click a checklist on Home to open it. On the web, a click on a checklist to-do in Upcoming now opens its items under the row, and a second click closes them. Long checklist items now show in full instead of being cut off.
- Deleted costs no longer come back. A cost you deleted on one device could still show on another and count twice in the month total. The app now checks for deleted items as soon as it opens.
- Home opens with your budget and names right away. Home now shows the budget you saw last time straight away, then updates it once your bank payments load. Names on Home also show at once, so they no longer read Former member while the app starts.
- Cleaner birthday rows on Home. Birthdays and other occasions on Home no longer show a blank person badge.
- Birthdays on Home. Birthdays and other occasions now show in Home's feed on their day, and on the home screen widget. An occasion you keep off the Calendar stays off Home too.
- Recent spending says when it leaves bills out. Today on the Costs Latest card no longer reads $0 with no reason when you paid a bill. A line under the totals now shows how much in bills it did not count.
- Search finds events, occasions and rewards. Search now finds your household's calendar events, your occasions and your rewards schemes. Type a store name to find the scheme that works there.
- Know when your server can update. If you run your own Rooftap server, the app now tells you when a newer release is out. About & updates shows what changed and how to update.
- Shopper opens on the web again. Shopper on the web no longer stays on Loading. Recipes in cook mode also stay saved in the browser between visits.
- Bin night on the widget. The home screen widget now shows "Bins out tonight" on bin night, next to your tasks. Tap it to open Bins.
- Widget ticks show at once. When you tick a task on the home screen widget, the tick now shows straight away. A quick second tap no longer undoes it, and the Undo line goes away after a few seconds.

## 1.1.3 (2026-10-26)

This release ships a new APK: the home screen widget now stays in place in launchers such as Nova Launcher. It installs over 1.1.1 and 1.1.2.

- Files open again on the phone. On Android, tapping Open on a file in Docs loaded for a long time and then failed. Files and their previews now open straight away.
- The home screen widget fits in more launchers. In some launchers, such as Nova Launcher, the widget's list ran over the to-buy and budget chips at the bottom. The list and its buttons now stay in place at any widget size. This needs the new Android app.
- Documents works like a file explorer. On a wide screen you get folders on the left, files in a table and a preview on the right. Drag files onto a folder to move them. On the phone, a tap shows a file's preview and details.
- Home stays in place as it opens on a wide screen. On a wide screen, Home no longer stacks its spaces on top of each other while it opens. A space that grows to fit its content now moves the ones under it at the same moment.
- No more endless "Syncing" banner. A change the server keeps refusing no longer leaves the web app stuck on "Syncing". After a few tries the app stops and tells you which change it could not save.

## 1.1.2 (2026-10-24)

This release ships a new APK: the phone now finds places near you with its location. It installs over 1.1.1.

- The Assistant can search the web. Ask what something costs or when a shop opens, and it searches the web and reads the page. It names the site for each price.
- The Assistant finds places near you. On the phone and in the browser it asks for your location once and only uses it while you ask. Otherwise it uses your home, or asks for your suburb once.
- Send photos to the Assistant. Attach a receipt, a bin calendar or a recipe page, and it files what it finds. Chat photos stay private and are deleted after 30 days.
- The Assistant knows which screen you have open, and it reaches more of the app: rewards cards, bins, home care, checklists, recipes, Home Setup, documents and your agenda.
- Pick which changes the Assistant makes. Each suggested change has its own tick, and you can confirm a week of changes on one card.
- Send feedback through the Assistant. It shows you the whole message and sends it only when you say yes.
- Smarter price checks in Shopper. Items close to your target price get a check every day. On Free, your first 10 items get a check every few days, and you can open any item to check it now.
- Keep a Scout search or a price watch from someone, for a present.
- Occasions: track birthdays and other days, keep gift ideas kept from the person they are for, and share a wishlist. Occasions show on the Calendar.
- Bin night shows which bins go out this week and whose turn it is, and Home reminds you the evening before.
- Plan the week's dinners in Recipes, with several dishes a night. Cook with step timers, cook mode and several recipes at once.
- Scanned recipes show how they match your Groceries, and staples such as salt and oil never go on the list.
- Home care in Home Setup reminds you when upkeep such as smoke alarm tests is due.
- Costs shows your latest payments, a To sort card for new shops, Worth a look tips and spending by category in colour. Move a cost to another category in two taps. The Budget bar on Home fills only with what you paid.
- Settings > Notifications lists every push Rooftap sends, with a switch for each.
- Fixes: follow-up questions to the Assistant work again, new Home Setup items save on every server, and Home no longer stops on a half-synced grocery.
- Self-hosting: a new install serves the web app on port 3737, not 3000. `scripts/self-host-init.sh` keeps an existing install on 3000. If you start the stack with `docker compose up` and your `.env` has no `APP_PORT` line, add `APP_PORT=3000` to keep the old port.

## 1.1.1 (2026-10-22)

This release ships a new APK. It is the first one signed with Rooftap's own key, and the first APK since 1.0.0. Everything listed under 1.1.0 is in it too, because 1.1.0 shipped without an APK.

- Uninstall the old Rooftap app once before you install this APK. Android refuses the update because the signing key changed. Your household data is on the server. You sign in again, and settings kept only on the phone (theme, haptics, tab order, widget) go back to their defaults. Later releases install over it as usual.
- The home screen widget scrolls. Swipe up and down on the Rooftap widget to see everything coming up.
- Home opens on a fresh install. On a new install, Home no longer shows "This screen didn't load" while your groceries are still syncing.
- Find a Home Setup item with Scout. Open the menu on a Home Setup item you still need and pick Find with Scout. Scout starts with the item name and your estimate as the budget.

## 1.1.0 (2026-10-21)

This release ships a new APK: the widget fixes are native.

- Assistant: an optional module (off by default) that answers questions about the household and proposes changes for you to approve, on web and mobile, with quick asks, named chats, a household thread and cost controls.
- Hold the + to ask the Assistant in a pop-up chat, and pick a closed quick ask back up with Continue. You get a notification when an answer arrives after you leave.
- The Assistant reaches recipes, checklists, Home Setup and the Shopper watchlist, and can check and control Home Assistant devices you expose to Assist. It asks before changing anything.
- Talk to the Assistant on Telegram: link it in the Assistant's settings to ask questions and approve changes from a chat.
- A household owner can save the household's own Gemini, OpenAI, Anthropic or OpenRouter key in Settings > AI keys, used with no limit. Without one, AI reads on the hosted service need Plus.
- Shopper: an optional module (off by default) that watches things you want to buy, keeps the cheapest price across sources with a price history and a deal rating, and turns "Plan to buy" into a to-do and a planned cost.
- Scout researches what to buy: describe what you need and it comes back with a short list of options and prices, and tells you when it's done.
- After an update, Rooftap shows what changed since you last looked. Settings keeps the full list.
- Confirm and delete prompts and toasts use Rooftap's own look instead of the system's.
- More opens with the spaces you used last, above a grid of every section.
- A to-do added on the phone starts due today, so it shows on Home straight away.
- Number fields open the keyboard again on mobile.
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
