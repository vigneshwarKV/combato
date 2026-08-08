# Combato — Release Plan

_Last updated: 2026-06-16_

## Current state

- **Frontend only.** React 19 + Pixi.js renderer, PeerJS P2P multiplayer (room codes), serverless `/api/ai` proxy.
- **No backend, no database, no auth, no metering.** The `/api/ai` endpoint is open — anyone can call it and burn your LLM budget.
- The proxy already has a placeholder: `// FUTURE: credit check + decrement here` — this is where the credit system plugs in.

The two features you named (login, watch-ad credits) both depend on infrastructure that doesn't exist yet: a backend with user accounts and a credits ledger. So the work below is sequenced around that.

---

## P0 — Blockers (must ship before any public release)

### 1. Backend + database
Stand up a backend (Supabase / Firebase / a small Node API) with: `users`, `credits_ledger`, `match_history` tables. Everything else depends on this.

### 2. Lock down the AI proxy
Today `/api/ai` is unauthenticated and uncapped — a single bad actor can run up an unbounded bill.
- Require an auth token (session/JWT) on every call.
- Per-user rate limit + the credit check/decrement at the existing FUTURE marker.
- Global daily spend cap + alerting as a safety net.

### 3. Login / accounts
- Email + Google/Apple OAuth (Apple required if you ever wrap as an iOS app).
- Persistent identity so credits, history, and rank survive sessions.
- Guest/anonymous play with later account linking (lowers signup friction).

### 4. Credit system
- Each AI move (LLM call) costs N credits; decrement server-side, never trust the client.
- Starting balance for new users + a free daily top-up.
- Clear "out of credits" UX with paths to earn/buy more.

### 5. Earn credits — watch ad
- Rewarded video ads (Google AdMob for app, or a web ad-network / AdSense rewarded for PWA).
- Server-verified ad-completion callback before crediting (clients lie).
- Cooldown + daily cap to prevent farming.

### 6. Legal / compliance (gated by login + ads)
- Privacy policy + Terms of Service (required by OAuth providers and ad networks).
- Cookie/consent banner, GDPR/CCPA basics.
- Age gate / content rating.

---

## P1 — Monetization & retention (ship shortly after launch)

### 7. Paid credits (IAP)
- Stripe (web/PWA) or store IAP (App Store / Play) for credit packs.
- Optional subscription tier (e.g. unlimited or large monthly allotment).

### 8. Progression & retention
- Leaderboard + ELO/rank from match history.
- Daily login rewards, win streaks, simple achievements.
- Match history / replays screen.

### 9. Onboarding / tutorial
The prompt-writing mechanic is non-obvious. A guided first match (pre-written strategy → explain actions/meter → first win) is critical for conversion.

---

## P2 — Polish & growth

### 10. Public matchmaking
Current multiplayer is room-code only. A "Quick Match" needs a lightweight lobby/signaling service to pair strangers (PeerJS still handles the actual connection).

### 11. Production hardening
- Remove debug `console.log`s in `api/_handler.js`.
- P2P disconnect/reconnect handling and graceful match recovery.
- Error tracking (Sentry) + analytics funnel (signup → first match → purchase).
- LLM cost dashboard.

### 12. Distribution
- Finish PWA (a `sw.js` exists) — installable, offline shell, app icons, social share/OG cards.
- **Native app (Capacitor) — scaffolded.** iOS + Android wrap the same web build.
  App ID `com.combato.game`. Build runbook in [`MOBILE_BUILD.md`](MOBILE_BUILD.md).
  - Landscape-locked everywhere: OS-level (Info.plist / AndroidManifest via
    `scripts/cap-landscape.mjs`) + runtime `ScreenOrientation.lock` + a web
    `<LandscapeGate>` portrait overlay.
  - **Before store release** the native build needs the P0 items above — the app
    calls `/api/ai` at `VITE_API_BASE` (your deployed backend), which is still
    open/uncapped (#2). Also generate real store icons/splash (`@capacitor/assets`).
  - Remaining last-mile is machine-specific: `npx cap add ios/android` on a Mac
    with Xcode + Android Studio, then build/sign from the IDE.

### 13. Content & moderation
- Moderate/sanitize user-written prompts (injection + abuse) before they hit the LLM.
- Roadmap for new characters / unlockables to keep players returning.

---

## Suggested build order

1. Backend + DB → 2. Auth → 3. Secure proxy + credits ledger → 4. Watch-ad earning → 5. Legal pages → **soft launch** → 6. Paid credits → 7. Onboarding + leaderboards → 8. Matchmaking + polish.

## Open questions (decide before building)
- **Platform:** web/PWA only, or also native app stores? (Changes auth, ads, and payment choices.)
- **Monetization model:** ads-only, credits + IAP, or subscription?
- **Backend choice:** managed (Supabase/Firebase) for speed, or custom Node API?
