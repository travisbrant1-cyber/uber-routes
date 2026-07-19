# Uber Routes for Rabbit R1 — Handoff

_Last updated: 2026-07-18 (creation is now fully client-side / backend-free, hosted on GitHub Pages)_
_Project root: `C:\Users\travi\Documents\R1-projects\uber-routes\`_
_Git repo: `https://github.com/travisbrant1-cyber/uber-routes` (public). Branches: `master` (active, client-side self-ride), `guest-rides-deeplink` (preserves the deep-link-based guest-ride attempt, parked)._

## 1. Goal
A Rabbit R1 "creation" (240×282 WebView web app) that lets you summon Uber rides by **voice or buttons**, using saved standard routes like *"Take me to Work"*.

Originally required "rides for someone else" too (e.g. *"Take Josh to Work"*, Uber texts Josh). **That's out of scope on `master`** — see §3 for why, and the `guest-rides-deeplink` branch for the parked attempt.

Still-active required features (all working):
- Saved, named routes (Home, Work, unlimited, with aliases). Add/edit/delete **on the R1 itself** (no separate phone page needed anymore).
- Trigger by voice phrase **or** buttons/scroll-wheel.
- **Scheduling display** ("tomorrow 8am") — reminder only; deep links can't carry a pickup time (see §3).
- An **intake wizard** on the R1 that collects ride details and builds a `m.uber.com` deep link + QR.

## 2. How it works (architecture) — NOW FULLY CLIENT-SIDE
As of the latest commit the creation has **no backend dependency**. It is a single static file served from GitHub Pages.

| Folder | File | Role |
|---|---|---|
| `r1/` | `index.html` | The R1 creation source (authoring copy). 240×282, bridge feature-detected. Wizard: **+ NEW RIDE** → Pickup → Where → When → Confirm → `m.uber.com` deep link + QR. |
| `r1/` | `qrcode.js` | `qrcode-generator` lib for rendering the ride QR. |
| `setup/` | `index.html` | **ORPHANED.** Old phone-side route manager that talked to the backend. Unused now that the creation manages its own routes via `creationStorage`. Kept in repo per request; safe to delete later. |
| `backend/` | `server.js`, `data.json` | **ORPHANED.** Old Node backend (Nominatim geocode + route storage). No longer called by the creation. Kept in repo per request; safe to delete later. |
| root | `index.html` | **The file GitHub Pages actually serves** (gh-pages branch root). Published from `r1/index.html` via `git show master:r1/index.html`. |
| root | `install-qr.png` | Install QR (scannable by the R1 camera). Encodes the R1 **JSON envelope** `{"title","url","description","iconUrl","themeColor"}` — NOT a bare URL (a bare URL QR is not recognized by the R1 installer; see §5). |

**What runs where (no server):**
- **Geocoding** → Nominatim (OpenStreetMap) called **directly from the creation** via `fetch` to `https://nominatim.openstreetmap.org/search?format=jsonv2` (CORS-enabled, no API key). `nominatimGeocode()` / `nominatimReverse()` in `r1/index.html`.
- **Saved routes** → `window.creationStorage.plain` (Base64, per-plugin, as the R1 bridge requires). `loadRoutes()` / `saveRoutes()`. No server, persists on-device.
- **Ride** → `buildSelfLink()` assembles `https://m.uber.com/looking?pickup=...&drop[i]=...` client-side; `doRequest()` renders the QR. You scan with your phone, Uber opens prefilled, **you tap confirm**. No token, no business account, no backend.

**Why this is robust:** the only external calls are (a) Nominatim for geocoding and (b) `m.uber.com` for the final ride. Both are public, keyless, CORS-friendly. There is no secret to leak and nothing to keep running.

## 3. Why guest rides were removed (read before resurrecting)
Two failed approaches this session:
1. **Uber Guest Rides API** (`/v1/guests/trips`) — needs an **Uber for Business/Central account + OAuth app** (never obtained). Removed from `master`.
2. **Deep link + manual picker fallback** — tested on-device, confirmed broken: `m.uber.com` deep links open the mobile web UI (not native app), no prefill, rider-picker unreachable.

Guest-ride code is preserved on **`guest-rides-deeplink`** (nothing lost). To revisit: get Business/Guest Rides API access (also restores real scheduling), or find a deep-link variant that reaches the native app with prefill + reachable rider-picker.

**Real scheduling** ("tomorrow 8am" actually requested at that time) has the same root cause — deep links can't carry a pickup time; only the Guest Rides API could. Currently the When step is display-only (the QR reminds you to set the time in Uber).

## 4. Status
**Working and verified:**
- Full self-ride wizard: **+ NEW RIDE** → Pickup (current location / saved / typed / spoken, skippable) → Where (multi-stop, saved / typed / spoken) → When → Confirm → QR. One-tap quick-ride from the Home list.
- **Confident-match auto-skip:** exact geocodes (building with a house number, or Nominatim importance > 0.6) add instantly without the "Did you mean" screen; fuzzy matches still preview. (This fast-path was dropped in the MTA redesign and restored with Option 2.)
- Voice phrase shortcut (`askLLM`/`onPluginMessage`) parses a spoken phrase against known routes + aliases and jumps to a QR. 12s timeout + fallback message (on-device LLM bridge is known-unreliable).
- Saved routes: add from the wizard ("Save address", optional aliases) or quick-save; persisted in `creationStorage`. Aliases let one place answer to multiple names ("Home"/"House").
- "Ride home" on the QR screen: rebuilds a QR to whatever route is named/aliased "home"; hidden if none saved.
- MTA subway-map UI: black/Helvetica, colored station bullets (MTA palette), scroll-wheel selection + side-button confirm + swipe (right=back, left=forward) + long-press (QR view → Ride home; elsewhere → cancel). Transit-line progress bar. Exactly 282px (header 22 + progress 16 + list 230 + tip 14 = 282; QR screen 282).
- **UI refinement (commit 339205d):** (a) replaced native `overflow-y:auto` list scroll with viewport-locked focus nav — `ensureVis()` now sets `list.scrollTop` by `rowHeight*index` (centered, no animation) so the selected row is always visible regardless of how many routes exist; (b) **removed all blocking `prompt()` calls** — added an inline `promptModal` screen (label/title/input) used by `savePrompt` (name + aliases) and the `!HAS.msg` dev fallbacks for address/time/phrase; HOLD ● confirms, swipe ⟶ cancels; (c) **`fetch` timeout** — `fetchWithTimeout()` (8s `Promise.race`) wraps both Nominatim calls, with a pulsing yellow `.loading` dot during the request; (d) **emulator bridge shim** added as first `<head>` script (guarded by `if(window.parent===window) return;` so it's a no-op on-device; relays `scrollUp/down/sideClick/longPress` + `pluginMessage` over `postMessage` for the Boondit emulator); (e) **dedupe + `findBestRoute`** — saving a place whose name/alias already exists *updates* it instead of creating a twin (fixes the two "Work" routes), and voice/shortcut lookups prefer the most complete match (pickup > dropoff); (f) tap targets bumped to 44px rows / 22px bullets; (g) marquee animations pause when their screen is hidden (battery); (h) storage reads/writes go through `safeLoad`/`safeStore` with `.catch()`. **`sideClick` (tap-select) and `longPress` (home/cancel) were deliberately kept** — the spec's "hold-only, remove sideClick" was based on a wrong premise (the SDK documents both as real creation events; the earlier dead-controls bug was the Home selection reset, now fixed).
- **Flow fixes (commit a09ac18):** addresses three user-reported gaps. (1) **Save works for BOTH pickup and dropoff** — added a "Save pickup" row on the Pickup screen (saves `intake.pickup` as a route's `pickup`, carrying the first stop as its `dropoff` when present); `savePrompt(mode)` now builds the right shape for `'pickup'` vs `'stop'`. Also, `geocodeThenPreview` now **always** renders the address-preview screen (previously it auto-skipped on a "confident" match), so the "Save address" row is reachable for *every* address, exact or fuzzy. (2) **Schedule is surfaced, not silently dropped** — Confirm now shows "When: <time>" and labels the Request row "scheduled · press ●"; the QR screen shows "Scheduled: <time> (set in Uber)" so the user sees it. (Note: the `m.uber.com` deeplink can't pre-set a pickup *time* — final scheduling happens in the Uber app after scan; the creation captures the intent and shows it.) (3) **Save route on the QR screen** — added a "Save route" row (`#qrList`) that persists the current destination (and pickup) as a named route and returns to the QR; uses a `saveReturn` callback so it doesn't re-append the stop or bounce to the wizard.
- **Hosted + installable:** GitHub Pages (`gh-pages` branch) serves the creation; `install-qr.png` is a scannable install QR. Live URL verified 200, backend-free.

**Ad-hoc verified (10/10 loader checks):** script parses; no backend refs; deeplink builder correct (my_location when no pickup, multi-stop); name/alias match; `nominatimGeocode`/`saveRoutes`/`loadRoutes` defined; boot backend-free. Live Nominatim returns valid coords. QR decode-verified against the exact Pages URL.

**NOT done / caveats:**
- **GPS "Current location" denied — root cause + fix (commit 49f640c):** the creation calls `navigator.geolocation.getCurrentPosition()`. The R1's host WebView (Boondit/creations runtime, built on Android `WebView`) does **not** surface a geolocation permission prompt the way a real browser does, so the call fires the error callback with `code 1 = PERMISSION_DENIED`. SDK has **no** geolocation API of its own (confirmed 0 hits in `creations-sdk`). This is a **host-app permission** issue, not fixable from inside the creation. The old handler toasted a silent `'GPS denied'` for *every* failure (timeout/unavailable looked identical). Fixed to map the real `err.code` → "GPS permission denied" / "GPS unavailable" / "GPS timeout", guard `window.isSecureContext` (needs https; Pages is https), and `console.log` under `#debug`. Workaround that needs NO device GPS: "Type address" / "Say address" geocode a text address via Nominatim — no coordinates required. To actually enable GPS, the runtime must declare + grant `ACCESS_FINE_LOCATION` for the WebView (their side). Ad-hoc verified 10/10.
- On-device voice round-trip not manually tested on real hardware (no R1 attached).
- **Nominatim rate limit** (~1 req/s, no key) — fine for personal use, not high volume.
- `setup/` and `backend/` are orphaned (see §2) — kept per request.
- Guest/"for someone else" rides + real scheduling — blocked pending Business API access (§3).

## 5. Run / deploy
**The creation is live — no local server needed:**
```
https://travisbrant1-cyber.github.io/uber-routes/
```
Install on the R1: open `install-qr.png` (repo root) and scan it with the R1 camera, OR point the R1's creation loader at the URL above.

**⚠️ The install QR must encode the R1 JSON envelope, NOT a bare URL.** The R1 camera/installer only recognizes a QR whose payload is JSON of the form `{"title","url","description","iconUrl","themeColor"}` (per the official SDK `qr/` generator in `creations-sdk/qr/final/`). A QR containing just `https://...` is silently not recognized. The current `install-qr.png` is correct. To regenerate (e.g. if the URL changes), use the SDK generator at `creations-sdk/qr/final/index_fixed.html` (fill Title + URL, download), or produce the equivalent JSON payload:
```json
{"title":"Uber Routes","url":"https://travisbrant1-cyber.github.io/uber-routes/","description":"Order Uber rides by voice or buttons using saved routes.","iconUrl":"","themeColor":"#FE5000"}
```
Encode that exact JSON string (Byte mode) into the QR. (Earlier bare-URL QR was the reason the R1 "didn't recognize" the install.)

**Local dev / edit:**
```
# edit r1/index.html, then publish to Pages:
cd C:\Users\travi\Documents\R1-projects\uber-routes
git add r1/index.html && git commit -m "..." && git push origin master
git checkout gh-pages
git show master:r1/index.html > index.html
git add index.html && git commit -m "publish" && git push origin gh-pages
git checkout master
# GitHub Pages rebuilds in ~30-60s
```
(Regenerate `install-qr.png` only if the URL changes — it hasn't.)

To inspect the parked guest attempt: `git checkout guest-rides-deeplink` (then `git checkout master` to return).

## 6. Next steps
- [ ] Manual on-device test: voice phrase, "Use current location" GPS, and a real scan-to-Uber ride on the R1 / Boondit emulator.
- [ ] Watch Nominatim rate limits under real use; add a tiny client-side cache if needed.
- [ ] Decide on Uber for Business / Guest Rides API — the one path back to real guest rides *and* real scheduling (§3).
- [ ] Optional: delete orphaned `backend/` + `setup/` once confident they're not needed.
- [ ] Update `HANDOFF.md` (this file) whenever the architecture changes again.
