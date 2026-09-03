# Combato — Android Release Checklist

Everything needed to ship the Android build with Supabase auth + leaderboard.
Code is done; the items below are your account/config/manual steps.

## 1. Production environment variables

**Vercel** (Project → Settings → Environment Variables, Production):
| Name | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | your `https://<ref>.supabase.co` | client, public |
| `VITE_SUPABASE_ANON_KEY` | anon key | client, public |
| `VITE_GOOGLE_WEB_CLIENT_ID` | OAuth **Web** client ID (`…apps.googleusercontent.com`) | client, public; **required for native Google sign-in** |
| `VITE_API_BASE` | your deployed URL, e.g. `https://combato.vercel.app` | **required for native** (no trailing slash, no `/api`) |
| `MATCH_TOKEN_SECRET` | random 32-byte hex | server-only |
| `COMBATO_SUPABASE_URL`, `COMBATO_SUPABASE_SERVICE_ROLE_KEY` | (from the Vercel Supabase integration) | server-only, auto-added |

**Native `.env.production`** (used by `npm run native:android`): set `VITE_API_BASE`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_WEB_CLIENT_ID`. The native app
has no local server, so `VITE_API_BASE` MUST point at the deployed backend.

## 2. Supabase + Google OAuth for production

- **Supabase → Auth → URL Configuration → Redirect URLs:** add your production web origin
  (`https://combato.vercel.app`). Native Google sign-in uses the ID-token flow (no redirect).
- **Google Cloud OAuth client (Web) → Authorised JavaScript origins:** add the production
  origin. The redirect URI stays `https://<ref>.supabase.co/auth/v1/callback`. This Web client
  ID is also the value of `VITE_GOOGLE_WEB_CLIENT_ID` and must be set as the Google provider's
  client ID in Supabase.
- **Google Cloud OAuth client (Android):** create one bound to package `com.combato.game` +
  your release **SHA-1** (Step 4). Native Google sign-in (Credential Manager) won't work
  without it. No client secret is used on Android.
- **OAuth consent screen:** basic scopes (email, profile) are non-sensitive. In "Testing"
  you're capped at 100 named test users; publish the consent screen to "Production" to allow
  anyone (no Google verification needed for these basic scopes).

## 3. App icons & splash

1. Add a 1024×1024 `resources/icon.png` (and optional `resources/splash.png` 2732×2732).
2. Generate: `npx capacitor-assets generate --android --iconBackgroundColor '#050309' --splashBackgroundColor '#050309'`
3. `npm run cap:sync` to copy them in. (`@capacitor/assets` is already installed.)

## 4. Signing (upload key + Play App Signing)

1. Generate an upload keystore:
   ```
   keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```
   Keep this file + passwords safe and OUT of git (already gitignored).
2. Create `android/keystore.properties` (gitignored):
   ```
   storeFile=/absolute/path/to/upload-keystore.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
   `build.gradle` picks this up automatically for release builds.
3. Enrol in **Play App Signing** when creating the app (Google holds the real app key; you
   upload with this upload key). Register your key's **SHA-1** in the Google Cloud OAuth
   **Android** client (needed for native Google sign-in) — get it from Play Console → App
   integrity, or `keytool -list -v -keystore upload-keystore.jks -alias upload`.

## 5. Build the AAB

```
# ensure .env.production has VITE_API_BASE + VITE_SUPABASE_* set
npm run native:android      # vite build → cap sync → re-lock landscape → open Android Studio
```
In Android Studio: Build → Generate Signed Bundle → AAB (or `./gradlew bundleRelease` from
`android/`). Bump `versionCode` in `android/app/build.gradle` before every upload.

## 6. Play Console

- Create the app (`com.combato.game`), enable Play App Signing, upload the AAB to **Internal
  testing** first.
- **Store listing:** title, short + full description, 512×512 icon, 1024×500 feature graphic,
  **landscape** phone screenshots.
- **Content rating** questionnaire.
- **Data safety** form — declare: *Account info* (name/email if Google), *user IDs*, *app
  activity* (scores); purpose *app functionality*; not shared; encrypted in transit; users can
  request deletion (your contact email).
- **Privacy Policy URL:** `https://<your-domain>/privacy.html` · Terms: `/terms.html`
  (fill in the `[bracketed]` placeholders in `public/privacy.html` + `public/terms.html` first).

## 7. Accounts summary
- Google account → **Play Console** ($25 one-time).
- Google Cloud project (OAuth clients) — free.
- Supabase + Vercel — free.
- Android Studio (build) on your Mac.

## Still open (tracked separately)
- **On-device testing** of the native Google + guest sign-in flows (deferred).

### Done: native Google sign-in
Wired via `@capgo/capacitor-social-login` (ID-token flow) in `src/lib/auth.js` —
`signInWithGoogle()` branches on `Capacitor.isNativePlatform()`: native opens the platform
account picker → Google ID token → `supabase.auth.signInWithIdToken()`; web keeps the redirect
flow. Requires `VITE_GOOGLE_WEB_CLIENT_ID` + the Android OAuth client (Step 2), then a
`npm run cap:sync` (run automatically by `npm run native:android`) to install the plugin's
native code. **Guest→Google on native switches accounts — guest points are NOT migrated**
(accepted v1 behaviour; the web flow still links in place and keeps them).
