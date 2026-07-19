# Uber Routes for Rabbit R1 — Handoff

_Last updated: 2026-07-18 (Guest Rides API removed — deeplink-only architecture)_
_Project root: `C:\Users\travi\Documents\R1-projects\uber-routes\`_

## 1. Goal
A Rabbit R1 "creation" (240×282 WebView web app) that lets you summon Uber rides by **voice or buttons**, using saved standard routes like *"Take Josh to Work"*.

Required features (from the user):
- Saved, named routes (Home, Work, unlimited). Add/tweak on a phone, not the tiny screen.
- Trigger by voice phrase **or** buttons.
- **Rides for someone else** (e.g. Josh) where **Uber texts them** ride details.
- **Scheduling** ("tomorrow 8am").
- An **intake form/wizard** on the R1 that collects ride details and assembles the string (deep links).

## 2. How it works (architecture)
Three pieces, all in this repo:

| Folder | File | Role |
|---|---|---|
| `r1/` | `index.html` | The R1 creation. 240×282, bridge feature-detected. Wizard: Who → Pickup → Where → When → Confirm → a `m.uber.com` deep link + QR, built entirely client-side. Same path for self **and** guest rides. |
| `r1/` | `qrcode.js` | `qrcode-generator` lib for rendering the ride QR. |
| `backend/` | `server.js` | Node backend. **Never talks to Uber's API at all** — just geocoding (Nominatim) and JSON storage for saved routes/guests. |
| `backend/` | `data.json` | Persisted routes + guests (single-user, simple file). |
| `setup/` | `index.html` | Phone-side page to add/edit/delete routes + people (with consent checkbox, aliases). Geocodes addresses. |

### One ride path (self and guest both use it)
R1 assembles `https://m.uber.com/looking?pickup=...&drop[i]=...` client-side and shows a QR. You scan with your phone, Uber opens prefilled, **you tap confirm**. No backend call, no token, no business account.

For a **guest ride**, the QR/link is identical to a self-ride — the deep link has no way to specify a recipient — but the screen carries a reminder: *"Scan, then in Uber pick **Josh** as rider before confirming."* You do that one extra tap inside Uber's own UI (Uber's consumer app has a free, built-in "request a ride for someone else" contact picker — no business account needed for that either). If the ride was scheduled for later, the reminder instead says to set the time manually in Uber, since deep links can't carry a pickup time.

### Key API facts (verified against Uber's own docs, this session)
- **Deep links (`m.uber.com`) have no parameter for a recipient/guest phone number, and no parameter for a future pickup time.** Confirmed against Uber's deep-link parameter reference and FAQ — the only parameters are `pickup`, `drop[i]`, `product_id`, `payment_method_id`, `client_id`. Scheduling and "for someone else" are both API-only or in-app-only capabilities.
- Uber's **Guest Rides API** (`/v1/guests/trips`) can do both (recipient SMS + scheduling), but it's a **business product** (Uber for Business/Central) requiring an org account + OAuth app — that was the whole reason this used to need a backend token. **No longer used** (see below).
- Uber's consumer app has a **separate, free, in-app-only** "request a ride for someone else" feature (any regular rider account, not gated to Business) — a contact picker inside the app's own "Where to?" flow. Not reachable via deep link or URL; it's manual, every time.
- Given both of the above, this project dropped the Guest Rides API entirely in favor of always building the same deep link + QR, with an on-screen reminder for the one manual step deep links can't do. Trade-off: guest rides now require you to tap through Uber's own recipient picker after scanning (previously automatic via the API), and scheduling for later is display-only (a reminder, not an actual scheduled request) for both self and guest rides — deep links were never able to schedule either.

## 3. Where we are (status)
**Working and verified (this session):**
- **Removed the entire Guest Rides API integration** (user-requested, following the deep-link research above). Deleted from `backend/server.js`: `buildPayload()`, `createTrip()`, the `POST /ride` handler, the unused `GET /qr` handler (was already dead — the frontend never called it), the `UBER_TOKEN`/`UBER_SANDBOX`/`UBER_ORG_UUID`/`UBER_FAKE` env vars, and the now-unused `matchesName()` helper (its only callers were the removed endpoints). `/config` simplified to just `{ clientId }`. Also removed from `r1/index.html`: the `result` screen (`resultBody`/`resultHome`/`resultBack` — only ever shown by the removed API branch), the `confirmSpin` spinner (no more async wait to show it during), and the now-dead `.spinner`/`.linkbox` CSS. `doRequest()` now just calls one unified `showRideLink()` for both self and guest rides.
- **`showRideLink()`** (renamed from `selfRide()`, `r1/index.html`) builds the QR for both self and guest rides. Title becomes "Ride to X for Josh" for a guest ride; the QR screen's note line (reused, not a new element, to avoid re-triggering the overflow bug fixed earlier — see below) shows the manual-selection reminder for guests, or a "can't schedule via link" reminder if `intake.when` is set, or the original default text otherwise.
- Verified end-to-end: guest-ride wizard (Josh → pickup → destination → "Now" → Confirm → **REQUEST**) via the real UI produces the correct QR, title, and reminder text with **zero** network calls beyond geocoding — confirmed no `/ride` request fires (the old backend endpoint now 404s, confirmed directly with curl too). Self-ride and scheduled-ride paths re-verified working after the refactor. Layout re-checked via `getBoundingClientRect()` (not just screenshots) — nothing crops.
- Backend `/routes`, `/geocode`, `/reverse-geocode`, route/guest CRUD all still work unchanged; `setup/index.html`'s config display simplified to match (no more fake/sandbox/token text — just "Backend: connected").
- **Aliases + full route/guest CRUD** (multiple trigger names per route, edit/rename, delete — all user-confirmed in scope): every route/guest now has a stable `id` (`crypto.randomUUID()`, backfilled onto pre-existing `data.json` entries automatically on first load); routes have an `aliases: string[]` field. `backend/server.js` has `PUT`/`DELETE` for both `/routes/:id` and `/guests/:id`, keyed by `id` (not name, since renaming would otherwise break name-based lookups). `setup/index.html` has full edit/delete UI (Edit loads the entry into the form with "Update"/"Cancel"; Delete is `confirm()`-gated) plus an aliases input. `r1/index.html`'s `addrSaveAsRoute()` prompts for optional aliases when saving from the wizard; a client-side `routeMatchesName()` (mirrors the backend logic) is used by the voice phrase-matching lookup and the "🏠 Ride home" shortcut, and the LLM prompt's known-routes list includes aliases so the model recognizes them in spoken phrases. Verified: add with 2 aliases → rename (id stable, no duplicate) → match via alias through the wizard → delete.
- **"🏠 Ride home" shortcut** on the QR screen: looks up a route named/aliased "home" (case-insensitive) and one-taps a fresh QR to it; hidden if none saved.
- **Short address display** (`shortAddr()`): Nominatim's verbose `display_name` trimmed to "house number + street" everywhere except the "did you mean" review screen, which keeps the full address for disambiguation.
- **Confident-match skip**: `/geocode` returns a `confident` flag (has a house number, or a high Nominatim `importance` score) that lets the frontend skip the "did you mean" screen entirely for unambiguous matches.
- **QR/Confirm screen overflow fixed**: a `.marquee` single-line, horizontally-scrolling title pattern replaces unbounded text wrapping that could (and once did) push the QR code completely off the 282px screen. Also fixed a header bug that was silently wrapping to 2 lines on every screen, eating ~20px of vertical budget everywhere.
- Enter-key now submits the type-address field (previously silently did nothing — no `<form>`, no keydown handler).
- Full voice-flow state machine with timeouts (`startVoice()`), Pickup step (current-location/saved/typed/spoken, with reverse-geocoding), and the original wizard flow (Who→Pickup→Where→When→Confirm) all still verified working after every change above.

**NOT done / blocked:**
- No auth on the backend (open on the internet if exposed). Add before public hosting.
- R1 `BACKEND` constant points at `location.origin`; for device testing it must be set to a tunnel/URL reachable by the R1.
- On-device voice round-trip and the "Use current location" GPS path not manually tested on real hardware (no R1 attached; this sandboxed preview browser has geolocation permission permanently denied with no way to grant it).
- **Known, permanent limitation of the deep-link-only approach** (not a bug): guest rides need one manual tap in Uber's own app (pick the recipient) instead of being fully hands-free; scheduling a ride for later is a reminder only, not an actual scheduled request, for both self and guest rides.

## 4. Open decisions — resolved
Both prior open decisions are now moot given the architecture change:
1. ~~Consent gate shape~~ — kept as a soft client-side check before letting you pick a guest in the wizard (`g.consent` in `startWizard()`), since Uber's own "for someone else" feature still texts the recipient trip details regardless of path (API or manual) — the checkbox's "consent to receive Uber SMS" wording still applies either way.
2. ~~Deployment shape~~ — resolved: always deep-link + QR now (no more "backend-free self-ride vs full-API guest-ride" split). The backend's only remaining job is geocoding + route/guest storage, not talking to Uber.

## 5. Run it
```
cd C:\Users\travi\Documents\R1-projects\uber-routes\backend
node server.js
# http://localhost:8788/        -> the R1 creation
# http://localhost:8788/setup   -> add/edit/delete routes + people
```
No env vars required. `UBER_CLIENT_ID` is optional (decorates the deep link if you have one).

## 6. Next steps
- [ ] Add backend auth (token/header) before exposing publicly.
- [ ] Point R1 `BACKEND` at a tunnel URL; test the full voice flow and "Use current location" on a real device / Boondit emulator.
- [ ] Optional dev self-test button to fake `onPluginMessage` so the flow can be watched without speaking.
- [ ] Consider whether the "When" step's scheduling options are still worth keeping front-and-center now that they're reminder-only rather than functional — could de-emphasize, or leave as-is since knowing *when* you plan to ride is still useful context even if Uber can't be told automatically.
