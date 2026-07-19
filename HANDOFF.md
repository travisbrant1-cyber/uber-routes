# Uber Routes for Rabbit R1 — Handoff

_Last updated: 2026-07-18 (guest rides stripped from main — self-ride only for now)_
_Project root: `C:\Users\travi\Documents\R1-projects\uber-routes\`_
_Now a git repo (initialized this session). Branches: `master` (active, self-ride only), `guest-rides-deeplink` (preserves the deep-link-based guest-ride attempt described below, for later)._

## 1. Goal
A Rabbit R1 "creation" (240×282 WebView web app) that lets you summon Uber rides by **voice or buttons**, using saved standard routes like *"Take me to Work"*.

Originally required "rides for someone else" too (e.g. *"Take Josh to Work"*, Uber texts Josh). **That's currently out of scope on `master`** — see §3 for why, and the `guest-rides-deeplink` branch for the parked attempt.

Still-active required features:
- Saved, named routes (Home, Work, unlimited, with aliases). Add/edit/delete on a phone, not the tiny screen.
- Trigger by voice phrase **or** buttons.
- **Scheduling** ("tomorrow 8am") — display/reminder only, see the limitation noted in §3.
- An **intake wizard** on the R1 that collects ride details and builds a `m.uber.com` deep link + QR.

## 2. How it works (architecture)
Three pieces, all in this repo:

| Folder | File | Role |
|---|---|---|
| `r1/` | `index.html` | The R1 creation. 240×282, bridge feature-detected. Wizard: **+ NEW RIDE** → Pickup → Where → When → Confirm → a `m.uber.com` deep link + QR, built entirely client-side. Self-ride only. |
| `r1/` | `qrcode.js` | `qrcode-generator` lib for rendering the ride QR. |
| `backend/` | `server.js` | Node backend. **Never talks to Uber's API at all** — just geocoding (Nominatim) and JSON storage for saved routes. |
| `backend/` | `data.json` | Persisted routes only (no more guests — see §3). |
| `setup/` | `index.html` | Phone-side page to add/edit/delete routes (with aliases). Geocodes addresses. |

R1 assembles `https://m.uber.com/looking?pickup=...&drop[i]=...` client-side and shows a QR. You scan with your phone, Uber opens prefilled, **you tap confirm**. No backend call, no token, no business account. If the ride was scheduled for later, the QR screen just reminds you to set the time manually in Uber — deep links can't carry a pickup time.

## 3. Why guest rides were removed (read this before resurrecting them)
This took two failed approaches this session, in order:

1. **Uber Guest Rides API** (`/v1/guests/trips`) — the "correct" way to book a ride for someone else with automatic SMS + real scheduling. Requires an **Uber for Business/Central account + OAuth app** — a real external dependency that was never obtained. Removed from the codebase entirely (was in `backend/server.js`: `buildPayload()`, `createTrip()`, `POST /ride`).
2. **Deep link + manual picker fallback** — since deep links can't specify a recipient, the idea was: build the same self-ride deep link, but show an on-screen reminder to manually pick the recipient inside Uber's own "request for someone else" feature (which is free on any consumer account, no business account needed) once the app opens. **Tested on a real device and confirmed broken**: opening the `m.uber.com` deep link launched the **mobile web UI**, not the native app, landed on a generic login-gated "Get a ride" page with **no prefilled locations**, and the rider-picker wasn't meaningfully reachable in that flow either. Also tried the alternate `action=setPickup` deep link format (vs. `/looking`) hoping it would stop at an earlier, less-committed screen — same result: web UI, no prefill, no working handoff to the native app.

Given neither approach works right now, guest-ride support was **fully stripped from `master`** (user's call) rather than left half-working. Everything from attempt #2 — the guest wizard step, the reminder-note QR logic, the guest data model (aliases-aware `matchesName`, guest CRUD endpoints, the People section in `/setup`) — is preserved as-is on the **`guest-rides-deeplink` branch**, checked out from the commit right before the strip. Nothing was lost; it just isn't in the active app.

**If this is ever worth revisiting**, the real options are: (a) get Uber for Business/Guest Rides API access and resurrect approach #1 (cleaner, since it also gets you real scheduling back), or (b) find a deep link / universal link variant that actually reaches the native app with prefilled locations *and* leaves the rider-picker reachable (both tested variants failed — worth checking Uber's changelog/docs again later, or asking Uber support directly, before trying a third variant blind).

## 4. Where we are (status)
**Working and verified:**
- Full self-ride wizard: **+ NEW RIDE** → Pickup (current location/saved/typed/spoken, skippable) → Where (multi-stop, saved/typed/spoken, with a confident-match auto-skip of the "did you mean" screen) → When (display-only scheduling) → Confirm → QR. Also a one-tap quick-self-ride from the Home screen's saved-places list.
- Voice phrase shortcut (`askLLM`/`onPluginMessage`) parses a spoken phrase against known routes (including aliases) and jumps straight to a QR; has a 12s timeout with a clear fallback message since the on-device LLM bridge is known-unreliable (never assume `onPluginMessage` fires).
- Saved routes: add from the wizard (`💾 Save address`, with optional aliases) or from `/setup` (full add/edit/delete, aliases input). Aliases let one place answer to multiple names ("Home"/"House") via voice, the Home screen, and the Pickup screen's saved-pickup list.
- "🏠 Ride home" shortcut on the QR screen: one tap rebuilds a fresh QR to whatever route is named/aliased "home"; hidden if none saved.
- Layout: single-line scrolling marquee (`.marquee`/`fitMarquee()`) keeps long addresses from ever pushing the QR code off the fixed 282px screen — this actually happened before the fix (QR fully invisible with a real 6-line address) and is verified fixed via `getBoundingClientRect()`, not just screenshots (this browser preview tool renders screenshots at a misleading scale — trust the rects). Header also fixed from a silent 2-line wrap that was eating ~20px on every screen.
- Backend is now genuinely minimal: `/config` (just `clientId`), `/routes` (GET/POST/PUT/DELETE by id), `/geocode`, `/reverse-geocode`. No env vars required to run it.
- Git repo initialized this session; `master` has this self-ride-only state, `guest-rides-deeplink` preserves the fuller (but broken) guest-ride attempt.

**NOT done / blocked:**
- No auth on the backend (open on the internet if exposed). Add before public hosting.
- R1 `BACKEND` constant points at `location.origin`; for device testing it must be set to a tunnel/URL reachable by the R1.
- On-device voice round-trip and the "Use current location" GPS path not manually tested on real hardware (no R1 attached; this sandboxed preview browser has geolocation permission permanently denied with no way to grant it).
- Guest/"for someone else" rides — see §3. Genuinely blocked pending either Business API access or a working deep-link variant, not just unimplemented.
- Real scheduling ("tomorrow 8am" actually requested at that time, not just a reminder) — same root cause as guest rides: deep links can't do it, only the Guest Rides API could.

## 5. Run it
```
cd C:\Users\travi\Documents\R1-projects\uber-routes\backend
node server.js
# http://localhost:8788/        -> the R1 creation
# http://localhost:8788/setup   -> add/edit/delete routes
```
No env vars required. `UBER_CLIENT_ID` is optional (decorates the deep link if you have one).

To look at the parked guest-ride attempt: `git checkout guest-rides-deeplink` (then `git checkout master` to come back — don't develop new work on the branch without merging intentionally, it'll diverge).

## 6. Next steps
- [ ] Add backend auth (token/header) before exposing publicly.
- [ ] Point R1 `BACKEND` at a tunnel URL; test the full voice flow and "Use current location" on a real device / Boondit emulator.
- [ ] Optional dev self-test button to fake `onPluginMessage` so the flow can be watched without speaking.
- [ ] Decide whether to pursue Uber for Business / Guest Rides API access — that's the one path back to real guest rides *and* real scheduling in one move (see §3).
