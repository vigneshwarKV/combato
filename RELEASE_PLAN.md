# Combato — Release Plan

_Last updated: 2026-08-19_

Goal: ship an **Android** release with a real backend (leaderboard + accounts) and
working online play. **Ads and the credit/metering system are out of scope** — the
earlier version of this plan was built around them; that direction was dropped.

---

## Architecture (current)

**Frontend** — React 19 + Vite + Pixi.js, deployed on **Vercel**; wrapped in
**Capacitor** for native (Android committed under `android/`, iOS not scaffolded).
App ID `com.combato.game`. Landscape-locked (OS + runtime + `<LandscapeGate>`).

**Backend** — **Supabase** (Postgres + Auth + Realtime) + **Vercel serverless
functions**. No separate server, no ads, no credits.

- **Auth** (`src/lib/supabase.js`, `src/lib/auth.js`): guest (anonymous), Google
  (web redirect), guest→Google linking, sign-out. Every user (guest or Google)
  gets a Supabase JWT.
- **DB** (`supabase/migrations/0001_init.sql`): `profiles` (display handle) +
  `match_results` (append-only scoring ledger). RLS locks `match_results` to the
  service role; clients read the board only via the `get_leaderboard(period)` RPC.
- **Serverless functions** (`api/`):
  - `ai.js` — LLM proxy, now **requires a valid Supabase JWT** (no more open proxy).
  - `match-start.js` — issues a signed, single-use **match token** when a match begins.
  - `score.js` — validated leaderboard write: verifies the token, **recomputes
    points server-side**, dedups by nonce, rate-limits, inserts via service role.
  - `delete-account.js` — deletes a guest (anonymous) account (used by guest→Google
    when the Google account already exists).
  - `ping.js` — daily keep-warm cron (`vercel.json` `crons`) so the free Supabase
    project never pauses.
  - shared cores: `_handler.js`, `_scoreHandler.js`, `_matchToken.js`, `_supabaseAuth.js`.
- **Leaderboard** — points-based, **daily + weekly**. Points formula is the shared
  `src/engine/scoring.js` (used by client preview AND server recompute). UI in
  `src/components/Leaderboard.jsx`. Bot points are weighted low (×0.5) but uncapped.
- **Multiplayer** — **Supabase Realtime** (Broadcast + Presence), keyed `room:<code>`,
  replacing PeerJS/STUN (`peerjs` removed). Works on every network, no TURN. Host is
  authoritative; `src/hooks/useMatchClient.js` has a connection watchdog. PvP results
  post to the board from each fighter (`src/pages/RoomPage.jsx`).
- **Entry flow** — `SignInScreen` (Google / guest) → fighter-name step
  (`FighterNamePrompt`, name shown everywhere) → home. Dungeon background image on
  the sign-in gate and home.

### Anti-cheat model (accepted trade-off)
Combat is client-side / host-authoritative (not server-reproducible). We stop
casual cheating cheaply, not a determined reverse-engineer:
- **A** — auth required, server **recomputes** points (client value ignored),
  input bounds, **dedup** by match nonce, per-user **rate limit**.
- **B** — **match-token handshake**: every score must present a signed token from
  `/api/match-start`, redeemable once, only after a realistic elapsed time.

---

## Status — done

- Supabase schema + RLS + `get_leaderboard` RPC.
- Auth: guest + Google (web) + guest→Google linking + sign-out.
- Scoring module + `/api/match-start` + `/api/score` (A + B) + client submit hooks
  (bot, 1v1, tournament).
- Leaderboard UI (daily/weekly).
- `/api/ai` gated behind auth; debug logs removed.
- Realtime PvP transport + watchdog (verified: fights sync cross-window via the
  Supabase channel).
- Keep-warm cron + privacy/terms template pages.
- Sign-in screen + name-step redesign; background image.
- Android prep: `versionName 1.0.0`, conditional release `signingConfig`
  (`android/keystore.properties`), `@capacitor/assets` installed, gitignored keys.

---

## ⚠️ Issues to fix BEFORE the Android release

These are the real blockers/gaps. Detailed runbook in
[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

1. **Native Google sign-in (functional blocker).** The web OAuth **redirect** flow
   does NOT run inside the Capacitor WebView (`capacitor://localhost`). Wire a native
   Google Sign-In plugin → get an ID token → `supabase.auth.signInWithIdToken`.
   Until then, in the packaged app **only "Play as guest" works**.
2. **Enable Manual Linking in Supabase** — required for guest→Google `linkIdentity`.
3. **Google Cloud OAuth for the app** — add an **Android client** with the release
   **SHA-1** (from Play App Signing), and **publish the OAuth consent screen to
   Production** (Testing caps at 100 users).
4. **Android signing** — generate the upload keystore, create
   `android/keystore.properties`, enrol in **Play App Signing**.
5. **Real icons + splash** — replace the Capacitor placeholders: add
   `resources/icon.png` (1024²) and run `npx capacitor-assets generate`.
6. **Production env** — set `VITE_API_BASE`, `VITE_SUPABASE_URL/ANON_KEY`,
   `MATCH_TOKEN_SECRET`, `COMBATO_SUPABASE_*` in Vercel and in the native build's
   `.env.production` (native has no local server — `VITE_API_BASE` is mandatory).
7. **Legal pages** — fill the `[bracketed]` placeholders in `public/privacy.html` +
   `public/terms.html` (contact email, entity) and confirm the hosted URLs.
8. **Verify the keep-warm cron** actually runs on Vercel (Supabase free-tier pause).
9. **End-to-end verification still pending:** PvP scoring rows (1v1/tournament) and
   guest→Google linking (both convert + existing-account cases).
10. **Play Console** — Data safety form, content rating, store listing assets
    (512² icon, 1024×500 feature graphic, landscape screenshots).

**Known, non-blocking** (ship-safe, note for later): pre-existing lint warnings
(`react-hooks/refs`/`purity`); Realtime channels are public (room code is the shared
secret — could add Realtime Authorization RLS later); host-authoritative PvP trust
(accepted); >500 kB JS bundle (code-split later); portrait sign-in undesigned
(landscape-locked, so `<LandscapeGate>` covers it).

---

## Android release steps (summary)

Full detail in [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md); build mechanics in
[`MOBILE_BUILD.md`](MOBILE_BUILD.md).

1. Fix the blockers above (native Google sign-in, signing, icons, env, legal, OAuth).
2. Set `.env.production` (`VITE_API_BASE` + `VITE_SUPABASE_*`) and Vercel env.
3. `npm run native:android` → build a **signed `.aab`** in Android Studio
   (bump `versionCode` each upload).
4. Play Console: create app → **Play App Signing** → upload to **Internal testing**
   → store listing + Data safety + content rating → promote to production.

**Accounts:** Google account → Play Console ($25 one-time); Google Cloud (OAuth);
Supabase + Vercel (free). iOS later would add Apple Developer ($99/yr) + Sign in with
Apple + `cap add ios` on a Mac.

---

## Deferred / future

- **iOS** — `cap add ios` on a Mac; add Sign in with Apple (App Store guideline 4.8).
- **Guest→Google linking hardening** and native Google sign-in polish.
- **Public matchmaking** — a `matchmaking_queue` table + presence to pair strangers
  (natural Supabase extension; today is room-code only).
- **Server-authoritative PvP** — both peers submit → server referees, closing the
  host-can-lie hole (only if abuse appears).
- **Retention** — onboarding tutorial, win streaks / achievements, match history.
- **Monetization** — intentionally not planned right now (no ads, no credits).
