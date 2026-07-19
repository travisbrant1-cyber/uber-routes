# Uber Routes for Rabbit R1 — Handoff

_Last updated: 2026-07-19 (removed scheduling entirely — the When step, its progress-bar slot, the Confirm/QR "When"/"Scheduled" text, the voice-phrase time parsing, all of it — since the deep link never could carry a pickup time and the feature was actively misleading users. Before that: a third save-flow bug (real keyboard Enter never confirmed the save-route prompt), a creation icon, and 2 more save-flow bugs fixed earlier the same day. Before that: a focused visual-polish pass on the MTA subway UI — slide transitions, a "train dot" on the progress bar, selection glow, background texture, typographic hierarchy, and a dead-space treatment on Home; plus 2 more real bugs found while verifying it)_
_Project root: `C:\Users\travi\Documents\R1-projects\uber-routes\`_
_Git repo: `https://github.com/travisbrant1-cyber/uber-routes` (public). Branches: `master` (active, client-side self-ride), `guest-rides-deeplink` (preserves the deep-link-based guest-ride attempt, parked)._

## 1. Goal
A Rabbit R1 "creation" (240×282 WebView web app) that lets you summon Uber rides by **voice or buttons**, using saved standard routes like *"Take me to Work"*.

Originally required "rides for someone else" too (e.g. *"Take Josh to Work"*, Uber texts Josh). **That's out of scope on `master`** — see §3 for why, and the `guest-rides-deeplink` branch for the parked attempt.

Still-active required features (all working):
- Saved, named routes (Home, Work, unlimited, with aliases). Add/edit/delete **on the R1 itself** (no separate phone page needed anymore).
- Trigger by voice phrase **or** buttons/scroll-wheel.
- An **intake wizard** on the R1 that collects ride details and builds a `m.uber.com` deep link + QR. Always requests **now** — no scheduling (removed, see §8: the deep link genuinely can't carry a pickup time, and a feature that silently didn't do what it displayed was worse than not having it).

## 2. How it works (architecture) — fully client-side
The creation has **no backend dependency**. It is a single static file served from GitHub Pages.

| Folder | File | Role |
|---|---|---|
| `r1/` | `index.html` | The R1 creation source (authoring copy). 240×282, bridge feature-detected. Wizard: **+ NEW RIDE** → Pickup → Where → Confirm → `m.uber.com` deep link + QR. (No When step — removed, see §8.) |
| `r1/` | `qrcode.js` | `qrcode-generator` lib for rendering the ride QR. **Was accidentally deleted from `master` in commit `7ce3012`** even though `index.html` still `<script src="qrcode.js">`s it — restored this session from the initial commit (byte-identical to the copy still live on `gh-pages`, so the live site was never actually broken, only the authoring repo was). |
| `r1/` | `icon.png` | Creation icon (512×512 PNG): a green MTA-style circular bullet with a bold white "U", plus a small yellow accent dot echoing the header's status dot. Referenced by `<link rel="icon">` in `index.html` (browser tab icon when testing) and by `iconUrl` in the install QR's JSON envelope (§6) so the R1 launcher shows it. |
| `setup/` | `index.html` | **ORPHANED.** Old phone-side route manager that talked to the backend. Unused now that the creation manages its own routes via `creationStorage`. Kept in repo per request; safe to delete later. |
| `backend/` | `server.js`, `data.json` | **ORPHANED.** Old Node backend (Nominatim geocode + route storage). No longer called by the creation. Kept in repo per request; safe to delete later. |
| root (gh-pages) | `index.html` | **The file GitHub Pages actually serves.** Published from `r1/index.html` via `git show master:r1/index.html`. |
| root (gh-pages) | `install-qr.png` | Install QR (scannable by the R1 camera). Encodes the R1 **JSON envelope** `{"title","url","description","iconUrl","themeColor"}` — NOT a bare URL. |

**What runs where (no server):**
- **Geocoding** → Nominatim (OpenStreetMap) called **directly from the creation** via `fetch` to `https://nominatim.openstreetmap.org/search?format=jsonv2` (CORS-enabled, no API key). `nominatimGeocode()` / `nominatimReverse()` in `r1/index.html`.
- **Saved routes** → `window.creationStorage.plain` (Base64, per-plugin). `loadRoutes()` / `saveRoutes()`. No server, persists on-device.
- **Ride** → `buildSelfLink()` assembles `https://m.uber.com/looking?pickup=...&drop[i]=...` client-side; `doRequest()` renders the QR. You scan with your phone, Uber opens prefilled, **you tap confirm**.

## 3. Why guest rides were removed (read before resurrecting)
Two failed approaches:
1. **Uber Guest Rides API** (`/v1/guests/trips`) — needs an **Uber for Business/Central account + OAuth app** (never obtained). Removed from `master`.
2. **Deep link + manual picker fallback** — tested on-device, confirmed broken: `m.uber.com` deep links open the mobile web UI (not native app), no prefill, rider-picker unreachable.

Guest-ride code is preserved on **`guest-rides-deeplink`** (nothing lost). Scheduling had the same root cause (deep links can't carry a pickup time) — it was tried as a display-only reminder (the QR would tell you to set the time in Uber yourself) but was removed entirely in §8 once a user relied on it and it "didn't survive": a control that visibly lets you pick a time but silently can't act on it is worse than no control at all.

## 4. This session: the real "PTT doesn't work" root cause, and 3 more bugs found in the same pass
The user reported the visual redesign wasn't quite right and that **the side button (PTT) didn't work for entering addresses**. The previous session's notes (now superseded) had guessed this was a hardware-event-naming mismatch (`sideClick` vs `sideButton`) and shipped two speculative, unverified fixes chasing that theory. **That theory was wrong.** Verified directly against Boondit's own current dev-tools documentation: the *only* raw browser events the platform (and its own official emulator shim, which this creation already includes verbatim) ever dispatches are `scrollUp`, `scrollDown`, `sideClick`, `longPressStart`, `longPressEnd` — there is no raw `sideButton`/`scrollWheel` DOM event; those names only exist inside the separate `r1-create` npm package's own JS wrapper. So the dual-listener commit (`b0393f2`) wasn't wrong to have, just aimed at a problem that didn't exist.

**The actual bug**, found by reproducing the flow directly (ran the real code same-origin, dispatched a real `sideClick` CustomEvent with the address input focused and text typed, then inspected computed styles/DOM state — not guesswork): `geocodeThenPreview()`'s success handler called `renderAddrPreview()` (which builds the "Did you mean" screen's content and registers it as the active selection) but **never called `show('addrPreview')`**. So after typing/saying an address and pressing the button — PTT or a plain tap made zero difference, both were fully wired correctly — the geocode silently succeeded, `pendingStop` got set correctly, but the screen never switched away from "Type the destination." From the user's seat this looks *exactly* like "the button didn't do anything," because visually nothing happened, even though the app had actually moved on internally. **Fixed**: added `show('addrPreview')` right after `renderAddrPreview()` in `geocodeThenPreview()`. Verified the full chain three separate ways: (a) direct function calls, (b) a dispatched `sideClick` CustomEvent with the input focused exactly as hardware would leave it, (c) real mouse clicks through the actual UI, typed text → tap Search → "Did you mean" now appears → tap Add stop → back on Where with the stop added.

Three more real, unrelated bugs turned up doing this review, all now fixed in `r1/index.html`:
1. **Long addresses overflowed the "Did you mean" screen entirely**, pushing the Retry row completely off the fixed 282px viewport (confirmed via `getBoundingClientRect()`: Retry's box started at y=283.7, one pixel past the visible area — not reachable by touch at all). No cap existed on `#addrPreviewText`, unlike every other screen in this app which bounds its text. Fixed with `-webkit-line-clamp:3` + `max-height:60px` (matches the WebView's Chromium engine, so this is safe on-device).
2. **The marquee horizontal-scroll (for long destination text on the Confirm and QR screens) silently never engaged.** `fitMarquee()` was called *before* `show()` in both `goConfirm()` and `doRequest()`, so it measured `scrollWidth` on a `display:none` element (always reads 0) — the overflow check always failed, so `--sd` and the `.scroll` class never got set, and long text was just permanently truncated with the CSS `overflow:hidden` on the wrapper cutting it off, no scroll, no ellipsis, no way to ever read the rest. Fixed by moving both `fitMarquee(...)` calls to *after* their `show(...)` call. Verified: a long address (`scrollWidth` 1071px vs 220px `clientWidth`) now correctly gets `.scroll` + `--sd:-851px` applied.
3. **A previously-fixed mislabeling bug came back.** The Where screen's first stop was labeled "pickup →" (`i===0 ? 'pickup →' : 'stop '+(i+1)`) — conflating the destination-stops list with the separate, dedicated Pickup step earlier in the wizard. This exact confusion was diagnosed and fixed earlier in this project's history (renamed to "Stop 1" back then) and silently reappeared in the MTA rewrite. Reverted to consistent "stop N" labeling for every stop including the first.

Also removed two empty, permanently-unpopulated `<div class="prog">` containers on the `typeAddr` and `addrPreview` screens (they're not part of the 4-step `WIZ` array so `setProg()` never filled them) — this was leaving an ~18px dead blank gap right under the header on both screens, which is likely part of what read as visually "not quite right." Reclaimed that space for content instead.

**Testing method note:** none of this needed a physical R1 — it was fully reproducible by (a) restoring `r1/qrcode.js` and serving the repo locally, (b) same-origin `javascript_exec` to call internal functions/dispatch real `CustomEvent`s and inspect live DOM/computed-style state, and (c) real mouse clicks through the actual rendered UI at 240×282. A separate cross-origin iframe harness mimicking the Boondit emulator's exact `postMessage` protocol also confirmed the scroll/side-click relay itself works correctly — the bug was never in the event-delivery layer.

## 5. This session: focused visual-polish pass, and 2 more bugs found while verifying it
After the bug-fix pass in §4, the user said the MTA subway UI was "close" but still read as flat and static. Rather than a deeper redesign, this was a targeted polish pass within the existing aesthetic (user explicitly chose "focused polish" over redesign, and to skip sound effects for now). All changes are in `r1/index.html` only — no new screens, no architecture changes.

**What changed:**
1. **Screen-slide transitions.** `show(id)` used to hard-swap `display:none`/`flex` with no motion. Added a `SCREEN_ORDER` array and a `screenDir()` helper that decides `fwd`/`back` by comparing wizard-step position (with special handling for the `typeAddr`/`addrPreview` branch screens, which compare against whichever step they branched from — `pickup` or `where`, via `addrTarget`). The incoming screen now slides in from the right (fwd) or left (back) while the outgoing one slides out the opposite way, `transform`/`opacity` only, ~180ms, cleaned up via `#view`'s existing `overflow:hidden` (already clips correctly, no extra CSS needed there).
2. **Progress-line "train dot."** `setProg()` now adds a small dot that slides from the previous step's position to the current one every time it runs (`transform`-only, ~320ms, via a double-`requestAnimationFrame` to force the "from" state to paint first).
3. **Selection depth.** `.row.sel` now transitions (120ms) instead of snapping, and glows with the row's own bullet color via a `--rc` CSS custom property set per-row in `station()`.
4. **Faint background texture.** A ~3.5%-opacity diagonal hatch (`repeating-linear-gradient`) on `#app`, static CSS only, no runtime cost.
5. **Typographic hierarchy.** Row subtitles (`.meta .s`) no longer inherit the global bold weight, so titles now actually read as the primary text.
6. **Home dead-space treatment.** A `.lineTrail` element (3 progressively-fainter dots on a fading vertical line) appended after the last Home row, extending the metro-line motif into the empty space below a short route list instead of stopping dead.

**2 real bugs found during the verification pass** (not part of the plan — found by actually exercising the app end-to-end after the changes landed):
- **`show('when')` was never called anywhere in the codebase.** `goWhen()` built the When screen's content and selection model but never switched to it — tapping "Continue" on the Where screen silently did nothing visible, identical in shape to the `show('addrPreview')` bug from §4. Fixed by adding `show('when')` at the end of `goWhen()`.
- **A double-`show()` race in `addrConfirm()`** (`if(addrTarget==='pickup') goWhere(); else renderStops(); show('where');` — the trailing `show('where')` ran unconditionally due to missing braces, so the pickup-confirm path called `show('where')` twice in the same tick). Harmless before this session (idempotent), but it canceled the new slide-transition mid-flight. Fixed the branching to only call `show('where')` once. While fixing this, also found and closed a related **general race**: if `show()` is called again for a screen before its previous transition's `requestAnimationFrame`/cleanup `setTimeout` fires, the stale callback could later overwrite the new state, leaving two screens visible at once. Fixed by storing the pending rAF/timeout handle on each element (`el._pendingRAF` / `el._pendingCleanup`) and canceling it at the top of every `show()` call before scheduling new work — matters because this codebase already documented that the R1 hardware can send duplicate rapid events, so back-to-back `show()` calls are a real scenario, not just a test artifact.

**Testing method:** same as §4 — no physical device, `npx serve` locally (this time serving `r1/` directly as the server root via `.claude/launch.json`, sidestepping the trailing-slash gotcha entirely), `javascript_exec` calling internal functions directly and inspecting live DOM/style state, real clicks through the rendered UI at 240×282, and `getBoundingClientRect()`/console checks after every change. Verified: the original PTT fix still works post-transition, long-address line-clamp still holds, marquee `--sd` still engages correctly, "stop 1" labeling still correct, forward/back slide direction is correct in every wizard branch including the address-entry sub-flow, and rapid back-to-back navigation no longer leaves two screens visible.

**Not yet done from this pass:** nothing pushed to `master`/`gh-pages` — per the established checkpoint in this project, visual-polish work (like the §4 bug fixes before it) waits for explicit user review before committing/deploying.

## 6. This session: the save-route flow was actually broken, plus a real icon
The user tried saving a route on-device and reported it "didn't stick" after entering the name, and asked whether saved places share storage with routes (they do — see §2/§4, `savePrompt()` always writes into the same `routes` array regardless of pickup-only vs. destination saves). While reproducing this, found **two distinct, compounding bugs** in the inline prompt modal (`r1/index.html`), both now fixed:

1. **The on-screen tip told you to do the wrong thing.** `#promptModal`'s tip read `HOLD ● CONFIRM · SWIPE ⟶ CANCEL` — but `longPressStart` on that screen is wired to *cancel* (`show(promptBackTo)`, discarding whatever you typed), while a plain tap (`sideClick`) or left-swipe actually confirms. So a user following the tip's own instruction — holding the button to "confirm" — was silently canceling every time. Fixed the tip to `● CONFIRM · SWIPE ⟶ CANCEL`.
2. **Even with the correct tap, `confirmPrompt()` had a logic bug**: `if(val && cb) cb(val); else if(back) show(back);` — this only invoked the callback when the typed value was non-empty. The Aliases step is explicitly optional ("Other names? (comma-separated, optional)"), so confirming it blank (the common case) never called the save callback at all — it just silently re-displayed the modal (since `promptBackTo` for that step is `'promptModal'` itself), looking exactly like "nothing happened." Fixed by always invoking `cb` when one exists; each callback already knows how to handle an empty answer for its own field (the name callback bails to `goPickup()`/`goWhere()` on empty name; the aliases callback just proceeds with an empty aliases array).

Verified both fixes together end-to-end for **both** save entry points (`savePrompt('pickup')` from the pickup address-preview screen, and `savePrompt('stop')` from a destination/the QR screen's "Save route" row): typed a name, confirmed via a real dispatched `sideClick` (not hold), left Aliases blank, confirmed again — the route now correctly lands in the `routes` array and appears on Home. Also renamed the prompt title **"Name this place" → "Name this route"** per the user's request, since there's only one underlying concept (a route, optionally missing a pickup or dropoff) — "place" was a holdover from before that was unified.

**Also added a creation icon** (`r1/icon.png`, 512×512): a green MTA-style circular "station bullet" with a bold white "U", plus a small yellow dot in the corner echoing the header's own status-dot accent — generated locally with Pillow, not sourced from anywhere external. Wired up two ways:
- `<link rel="icon" type="image/png" href="icon.png">` added to `r1/index.html` (shows in a browser tab when testing; cosmetic only on-device, since the R1 WebView has no browser chrome).
- `install-qr.png` regenerated with the same JSON envelope as before, now with `iconUrl` filled in: `"https://travisbrant1-cyber.github.io/uber-routes/icon.png"` (previously `""`). `themeColor` was left as-is (`#FE5000`) — it predates this session and wasn't part of what was asked; worth a look sometime since it doesn't match the MTA-green icon or the app's own yellow/black chrome, but that's a separate call. Decoded the regenerated QR back with OpenCV to confirm it round-trips correctly before saving it over the old file.

**Publish reminder:** the gh-pages publish step (§10) currently only copies `index.html` (and, per the earlier `qrcode.js` reminder, should also copy that if it changes). Now `icon.png` needs the same treatment the first time this ships — `git show master:r1/icon.png > icon.png` while on `gh-pages` — otherwise the install QR's `iconUrl` will 404 even though everything else works.

## 7. This session: a third save-flow bug (real keyboard Enter), and the scheduling limitation re-confirmed
After §6's fixes, the user reported the save still didn't stick when testing in a browser preview, and separately that a scheduled ride's deep link "didn't survive." Two different findings:

**A third real bug, same family as §6:** the shared `document`-level `keydown` handler has always special-cased `#addrInput` — it explicitly skips its own Enter-handling logic when that field is focused, because `addrInput` has its own dedicated `keydown` listener (this exclusion is what an earlier session's Enter-key fix for address entry relied on). `#promptInput` (the save-route name/alias field) had **no such exclusion and no dedicated listener of its own**. So focusing that field, typing a name, and pressing Enter — the natural way to submit a text field in any browser — fell through to the generic handler's last branch, `else if(selItems.length) activate();`, which activates whatever was left in the *stale* `selItems` array from a completely different screen, never calling `confirmPrompt()` at all. This is almost certainly what "still doesn't appear to save in the preview" was: the side-button/tap path (fixed in §6) works, but Enter — what you'd naturally reach for on a keyboard — didn't. Fixed by adding a dedicated `#promptInput` keydown listener (mirroring `addrInput`'s own pattern exactly) and excluding `promptInput` from the shared handler the same way `addrInput` already is. (Initially added a `promptModal` case to the shared handler *instead*, but that double-fired `confirmPrompt()` on every Enter — one call from the dedicated listener, a second from the event bubbling up to `document` — with the second call reading an already-cleared input value; caught this in testing and switched to the exclusion-based fix instead, which cannot double-fire.)

**The scheduling report is the known limitation, not a new regression.** Verified directly: picking "+30 min" on the When screen correctly sets `intake.when`, and it correctly displays on both the Confirm screen (`When: 7/19/2026, 7:29:36 PM`) and the QR screen (`Scheduled: 7/19/2026, 7:29:36 PM (set in Uber)`) — so the display/reminder path has no bug. But `buildSelfLink()` — checked the actual generated URL — only ever emits `pickup` and `drop[i]` parameters; there is no code path anywhere that could attach a time, because `m.uber.com/looking` has no schedule parameter at all (confirmed earlier this project directly against Uber's own developer docs). This is exactly the limitation already documented in §3: the only way to get a *real* scheduled ride requested automatically is Uber's Guest Rides / Business API, which this project explicitly parked earlier for lack of a Business account. Nothing to fix here without that access — the app is already doing the only thing it can (showing the chosen time prominently as a "set this manually" reminder on both screens that lead to the QR).

## 8. This session: scheduling removed entirely
After §7 re-confirmed that scheduling was a hard platform limitation rather than a bug, the user's call was simple: remove references to it. Rather than just hiding the display text, took this as a chance to strip the whole feature cleanly out of `r1/index.html`, since a "When" step that lets you pick a time and then can't act on it is misleading — the report that a scheduled ride "didn't survive" is exactly the confusion this was causing.

**Removed:**
- The **When** screen entirely (HTML `<div id="when">`, its `<div class="prog" id="progWhen">`, `whenList`).
- `goWhen()`, `tomorrowAt()`, `sayTime()`, `parseTime()` — all gone.
- `intake.when` and every reference to it: the "When: ..." line on Confirm, the "scheduled · press ●" vs "press ●" toggle (Confirm's Request row now just always reads "press ●" via static HTML, no JS needed), the "Scheduled: ... (set in Uber)" note on the QR screen (now always "Ride now").
- The voice-phrase LLM prompt no longer asks for or parses a time (`{"route":string|null}` instead of also `"when"`) — a matched route now always jumps straight to the QR (`quickSelf(r)`) instead of conditionally routing through Confirm first.
- The `expect==='time'` branch in `onPluginMessage` (was reachable only from the now-removed "Say a time" button).

**Wizard is now 3 steps, not 4:** `WIZ` and `SCREEN_ORDER` no longer include `'when'`. `setProg()`'s progress bar rebuilds for 3 dots (`Pickup`/`Where`/`Go`) instead of 4. Navigation updated to match: `renderStops()`'s "Continue" row and `goForward()` from `where` now call `goConfirm()` directly (previously `goWhen()`); `goBack()`/`goForward()` from `confirm` now go straight to/from `where`; the `longPressStart` "cancel to Home" screen list and the `show()` screen-list both drop `'when'`.

Verified end-to-end after the removal: Pickup → Where → Confirm → QR walks straight through with no When step, the progress bar correctly shows 3 dots, Confirm/QR text no longer mentions a time, `goBack()` from Confirm lands on Where, the voice-phrase shortcut still jumps straight to a QR for a matched route, and no console errors across the full run.

Guest rides remain separately blocked pending Uber for Business API access (§3) — that's a different, still-open door; scheduling had no such door (Uber's public deep link has no schedule parameter at all), which is why it was removed instead of left parked.

## 9. Status
**Working and verified (post-fix):**
- Full self-ride wizard: **+ NEW RIDE** → Pickup (current location / saved / typed / spoken, skippable) → Where (multi-stop, saved / typed / spoken) → Confirm → QR, always for now (no When step — removed, §8). One-tap quick-ride from the Home list. Re-verified end-to-end via real clicks after all fixes above.
- **Confident-match auto-skip:** exact geocodes (building with a house number, or Nominatim importance > 0.6) add instantly without the "Did you mean" screen; fuzzy matches still preview (and now that screen actually displays and never overflows).
- Voice phrase shortcut (`askLLM`/`onPluginMessage`) parses a spoken phrase against known routes + aliases and jumps to a QR. 12s timeout + fallback message (on-device LLM bridge is known-unreliable).
- Saved routes: add from the wizard ("Save address", optional aliases) or quick-save; persisted in `creationStorage`. Aliases let one place answer to multiple names ("Home"/"House"). Save flow re-verified end-to-end after §6's fixes — confirming a name and leaving Aliases blank now actually saves, for both pickup-only and destination saves.
- Creation icon (`r1/icon.png`) wired into the browser favicon and the install QR's `iconUrl` (§6, §10) — needs the gh-pages publish step to copy it across the first time this ships (see §6's publish reminder).
- "Ride home" on the QR screen: rebuilds a QR to whatever route is named/aliased "home"; hidden if none saved.
- MTA subway-map UI: black/Helvetica, colored station bullets, scroll-wheel selection + side-button confirm + swipe (right=back, left=forward) + long-press (QR view → Ride home; elsewhere → cancel). Transit-line progress bar on the 3 real wizard steps (Pickup/Where/Go), now with a sliding "train dot."
- Real QR codes render again (see §2 — `qrcode.js` restoration).
- Screen-to-screen slide transitions, selection glow, background texture, and the Home dead-space treatment from §5 — all verified via direct DOM/style inspection and real clicks, including rapid-navigation edge cases.

**NOT done / caveats:**
- **On-device confirmation is still the one open item**, but the bar for it is much lower now — the fix isn't a hardware-event guess anymore, it's a plain missing function call, verified via the actual code path with a real dispatched event and real clicks. What's specifically still unverified on real hardware: whether the physical side button reaches the WebView at all while the on-screen Android keyboard has focus (a platform/IME-layer question `#debug` can still answer if this somehow still doesn't feel right on-device — see §10), and general on-device feel (touch target sizing, animation smoothness, whether the new transitions run smoothly on the actual MediaTek-class SoC rather than a desktop browser).
- **GPS "Current location" denied** — the R1's WebView doesn't surface a geolocation permission prompt; `getCurrentPosition()` fires `PERMISSION_DENIED`. Not fixable from inside the creation (host-app permission). Workaround needing no device GPS: Type/Say address.
- On-device voice round-trip not manually tested on real hardware.
- **Nominatim rate limit** (~1 req/s, no key) — fine for personal use, not high volume.
- `setup/` and `backend/` are orphaned (see §2) — kept per request.
- Guest/"for someone else" rides — blocked pending Business API access (§3). (Scheduling isn't in this bucket anymore — it was removed outright in §8 rather than left pending, since no API access would ever fix the public deep link's lack of a schedule parameter.)

## 10. Run / deploy
**The creation is live — no local server needed:**
```
https://travisbrant1-cyber.github.io/uber-routes/
```
Install on the R1: open `install-qr.png` (repo root) and scan it with the R1 camera, OR point the R1's creation loader at the URL above.

**⚠️ The install QR must encode the R1 JSON envelope, NOT a bare URL** — see the format in `install-qr.png`'s generation history if it ever needs regenerating.

**Local dev / edit:**
```
cd C:\Users\travi\Documents\R1-projects\uber-routes
# edit r1/index.html, then:
git add r1/index.html && git commit -m "..." && git push origin master
git checkout gh-pages
git show master:r1/index.html > index.html
git add index.html && git commit -m "publish" && git push origin gh-pages
git checkout master
# GitHub Pages rebuilds in ~30-60s
```
Note: the publish step only ever copies `index.html`, not `qrcode.js` — if `qrcode.js` ever changes on `master`, copy it across too (`git show master:r1/qrcode.js > qrcode.js` while on `gh-pages`).

To inspect the parked guest attempt: `git checkout guest-rides-deeplink` (then `git checkout master` to return).

**For local testing:** `npx serve .` from the repo root, then load `http://localhost:<port>/r1/` **with the trailing slash** — `serve` redirects `/r1/index.html` to the extensionless `/r1` (no trailing slash), which breaks the page's own relative `qrcode.js` reference (resolves against repo root instead of `/r1/`). Not an issue on GitHub Pages, which serves the real URL with a trailing slash. Alternative that sidesteps the gotcha entirely: point `serve` directly at the `r1/` folder as its own server root (e.g. `npx serve r1`) — then `qrcode.js` resolves correctly regardless of trailing slash, since `r1/` itself is the root.

**Boondit emulator (for pre-device testing):** https://creations.boondit.site/devtools → **Emulator** tab. Load the live URL — it renders at 240×282 and dispatches real hardware events via `postMessage`; the creation's built-in bridge shim (top of `<head>`) relays them. The dev-tools page itself is the authoritative source for what events actually exist — confirmed this session it's just the 5 legacy names, nothing else.

## 11. Next steps
- [ ] On-device pass to confirm everything feels right in practice: type/say an address, press the side button, confirm "Did you mean" appears immediately with no lag or visual glitch; confirm the new slide transitions and train-dot animation run smoothly on the actual SoC (not just a desktop browser); confirm the now-3-step wizard (Pickup/Where/Go) feels right with the When step gone.
- [ ] If PTT still somehow doesn't register on real hardware (unlikely now, but if so): the `#debug` flag (append `#debug` to the URL) logs every `scrollUp/scrollDown/sideClick/longPressStart/longPressEnd/click/touchend/keydown` event with detail to the console — use it to see whether the press is reaching the WebView at all while the on-screen keyboard has focus.
- [ ] Manual on-device test: voice phrase, "Use current location" GPS, and a real scan-to-Uber ride.
- [ ] Watch Nominatim rate limits under real use; add a tiny client-side cache if needed.
- [ ] Decide on Uber for Business / Guest Rides API — the one path back to real guest rides (§3). No longer tied to scheduling — that was removed outright in §8, not left waiting on this.
- [ ] Optional: delete orphaned `backend/` + `setup/` once confident they're not needed.
- [ ] Nothing from §5, §6, §7, or §8 (visual polish, the save-flow fixes, the new icon, the Enter-key fix, or the scheduling removal) has been committed/pushed yet — pending user review, same checkpoint as the §4 bug-fix pass.
- [ ] First time this ships: don't forget `icon.png` in the gh-pages publish step (§6, §10) or the install QR's `iconUrl` will 404.
- [ ] Optional, not part of any request so far: `themeColor` in the install QR envelope is still `#FE5000`, a holdover that doesn't match the icon's green or the app's black/yellow chrome — worth revisiting whenever the icon/branding gets another look.
- [ ] Update `HANDOFF.md` (this file) whenever the architecture changes again.
