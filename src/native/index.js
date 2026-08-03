// Capacitor native shell bootstrap.
//
// On the web this is a no-op — every call is guarded by Capacitor.isNativePlatform(),
// which is false in a normal browser/PWA. Inside the iOS/Android wrapper it:
//   1. Hard-locks the device to landscape (belt-and-suspenders on top of the
//      OS-level lock in Info.plist / AndroidManifest — see scripts/cap-landscape.mjs).
//   2. Hides the status bar so the game runs edge-to-edge.
//   3. Dismisses the splash screen once the web layer is up.
//
// Plugins are dynamically imported so their native-bridge code never lands in
// the web/PWA bundle.
import { Capacitor } from '@capacitor/core';

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { ScreenOrientation } = await import('@capacitor/screen-orientation');
    await ScreenOrientation.lock({ orientation: 'landscape' });
  } catch (e) {
    console.warn('[native] orientation lock failed:', e);
  }

  try {
    const { StatusBar } = await import('@capacitor/status-bar');
    await StatusBar.hide();
  } catch { /* status bar plugin optional */ }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch { /* splash plugin optional */ }
}
