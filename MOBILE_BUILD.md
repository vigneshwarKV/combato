# Combato — Native Mobile Build (iOS + Android)

Combato ships to the App Store and Play Store as a **Capacitor** wrapper
around the exact same web build. The web bundle (`dist/`) is loaded from inside a
native WebView; only a thin native shell (orientation lock, status bar, splash)
is added on top.

> **Landscape everywhere.** The game is landscape-only. Native apps are
> hard-locked at the OS level (Info.plist / AndroidManifest); the web/PWA shows a
> full-screen "rotate your device" gate on portrait phones. See
> [Landscape lock](#landscape-lock) below.

---

## One-time prerequisites (your Mac)

| Target  | Needs |
| ------- | ----- |
| Android | [Android Studio](https://developer.android.com/studio) (bundles the SDK + Gradle + a JDK) |
| iOS     | [Xcode](https://apps.apple.com/app/xcode/id497799835) (full app, not just Command Line Tools) + CocoaPods (`sudo gem install cocoapods` or `brew install cocoapods`) |

The web toolchain (Node, npm) is already set up by the repo. Capacitor itself is
already a dependency — no global install needed.

---

## The one required config: `VITE_API_BASE`

The app calls the managed AI proxy at `/api/ai`. On the web that's a same-origin
relative call. **Inside a native app there is no local server** — the WebView
origin is `capacitor://localhost` (iOS) / `https://localhost` (Android) — so the
bundle must point at your **deployed** backend.

Set it in `.env` (or `.env.production`) before building for native:

```sh
VITE_API_BASE=https://your-deployed-app.vercel.app   # no trailing slash, no /api/ai
```

Leave it **empty** for web/PWA builds. The proxy already sends permissive CORS
headers (`api/ai.js`) so the cross-origin call from the app is allowed.

> When the credit system lands (see `RELEASE_PLAN.md`), tighten the wildcard CORS
> in `api/ai.js` to the known app origins and add the auth token to this call.

---

## First-time setup

```sh
npm install                 # pulls in @capacitor/* (already in package.json)
npm run build               # produce dist/ (with VITE_API_BASE set for native)

npm run cap:add:android     # creates android/ and locks it to landscape
npm run cap:add:ios         # creates ios/    and locks it to landscape (needs CocoaPods)
```

`cap:add:*` runs `cap add <platform>` and then `scripts/cap-landscape.mjs`, which
patches the freshly-generated native project for landscape (see below).

The `android/` and `ios/` folders are committed to git (Capacitor's own
`.gitignore` inside each excludes build output and the copied web assets).

---

## Everyday workflow

After any change to the web app:

```sh
npm run native:android      # vite build → cap sync → re-apply landscape → open Android Studio
npm run native:ios          # same, opens Xcode
```

or the lower-level pieces:

```sh
npm run build               # rebuild dist/
npm run cap:sync            # copy dist into native projects + refresh plugins + re-lock landscape
npx cap open android        # open in Android Studio to run/build/sign
npx cap open ios            # open in Xcode
```

Then **build & run from the IDE** (device or simulator/emulator), and use the
IDE's signing + archive flow to produce a store-ready `.aab` / `.ipa`.

---

## Landscape lock

Three layers, so orientation is enforced no matter how the app is launched:

1. **OS-level (authoritative).** `scripts/cap-landscape.mjs` patches:
   - Android — `android:screenOrientation="sensorLandscape"` on `MainActivity`
     (the activity already declares `configChanges` for orientation, so it
     rotates without restarting).
   - iOS — `UISupportedInterfaceOrientations` (iPhone) and `~ipad` reduced to
     `LandscapeLeft` + `LandscapeRight` only.

   It is **idempotent** and re-run automatically by `cap:sync` / `cap:add:*`, so
   a `cap sync` that regenerates config never loses the lock.

2. **Runtime (belt-and-suspenders).** `src/native/index.js` calls
   `ScreenOrientation.lock({ orientation: 'landscape' })` on launch (native only).

3. **Web / PWA.** `<LandscapeGate>` (`src/components/LandscapeGate.jsx`) overlays a
   "rotate your device" prompt on portrait phones across every route. The app
   stays mounted behind it, so rotating mid-match never tears down the live P2P
   fight. The PWA `manifest.webmanifest` also declares `"orientation": "landscape"`.

---

## App icons & splash (before store submission)

The manifest currently points at `favicon.svg`. For real store assets, drop a
1024×1024 `icon.png` (and optional `splash.png`) in `resources/` and run:

```sh
npm i -D @capacitor/assets
npx @capacitor/assets generate --iconBackgroundColor '#050309' --splashBackgroundColor '#050309'
```

This generates every required icon/splash size for both platforms.

---

## Store submission checklist (see also `RELEASE_PLAN.md` P0)

- App ID: **`com.combato.game`** (set in `capacitor.config.json`).
- Privacy policy + Terms URLs (required by both stores — RELEASE_PLAN #6).
- Apple: sign in with a paid Apple Developer account; Apple OAuth required if you
  add "Sign in with Google" (RELEASE_PLAN #3).
- Point `VITE_API_BASE` at production, and lock down `/api/ai` (auth + credits)
  before public release — today it is open (RELEASE_PLAN #2).
