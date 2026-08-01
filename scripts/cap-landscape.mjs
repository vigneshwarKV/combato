#!/usr/bin/env node
// Patch the generated native projects so iOS and Android are hard-locked to
// landscape at the OS level. This is the authoritative lock — the runtime
// ScreenOrientation.lock() in src/native/index.js is just belt-and-suspenders.
//
// Run once after `npx cap add ios` / `npx cap add android`, and safe to re-run
// after `cap sync` (both patches are idempotent). Missing platform folders are
// skipped with a notice rather than failing, so it's safe to run before a
// platform has been added.
//
//   node scripts/cap-landscape.mjs
//
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LANDSCAPE = ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];

let changed = 0;
let skipped = 0;

// ── Android ──────────────────────────────────────────────────────────
// Add android:screenOrientation="sensorLandscape" to the MainActivity. The
// generated <activity> already declares android:configChanges="...|orientation|
// screenSize|...", so the activity handles the rotation itself without an
// OS-level config-change restart.
function patchAndroid() {
  const manifest = resolve(root, 'android/app/src/main/AndroidManifest.xml');
  if (!existsSync(manifest)) {
    console.log('•  Android: no project yet (run `npx cap add android`) — skipped');
    skipped++;
    return;
  }
  let xml = readFileSync(manifest, 'utf8');
  if (xml.includes('android:screenOrientation="sensorLandscape"')) {
    console.log('✓  Android: already landscape-locked');
    return;
  }
  // Strip any pre-existing screenOrientation on the MainActivity, then add ours
  // right after the activity's android:name attribute.
  xml = xml.replace(/\s+android:screenOrientation="[^"]*"/g, '');
  const patched = xml.replace(
    /(<activity\b[^>]*?android:name="\.MainActivity")/,
    '$1\n            android:screenOrientation="sensorLandscape"'
  );
  if (patched === xml) {
    console.warn('⚠  Android: could not find MainActivity — patch manually (android:screenOrientation="sensorLandscape")');
    skipped++;
    return;
  }
  writeFileSync(manifest, patched);
  console.log('✓  Android: locked MainActivity to sensorLandscape');
  changed++;
}

// ── iOS ──────────────────────────────────────────────────────────────
// Restrict UISupportedInterfaceOrientations (iPhone) and
// UISupportedInterfaceOrientations~ipad to the two landscape values only.
function patchIOS() {
  const plist = resolve(root, 'ios/App/App/Info.plist');
  if (!existsSync(plist)) {
    console.log('•  iOS: no project yet (run `npx cap add ios`) — skipped');
    skipped++;
    return;
  }
  let xml = readFileSync(plist, 'utf8');
  const before = xml;
  const arrayXml = LANDSCAPE.map((o) => `\t\t<string>${o}</string>`).join('\n');

  // Replace the contents of each orientation array (iPhone + iPad variants).
  xml = xml.replace(
    /(<key>UISupportedInterfaceOrientations(?:~ipad)?<\/key>\s*<array>)[\s\S]*?(<\/array>)/g,
    (_m, open, close) => `${open}\n${arrayXml}\n\t${close}`
  );

  if (!/<key>UISupportedInterfaceOrientations<\/key>/.test(xml)) {
    console.warn('⚠  iOS: UISupportedInterfaceOrientations key not found — patch Info.plist manually');
    skipped++;
    return;
  }
  if (xml === before) {
    console.log('✓  iOS: already landscape-only');
    return;
  }
  writeFileSync(plist, xml);
  console.log('✓  iOS: restricted supported orientations to landscape');
  changed++;
}

console.log('Locking native projects to landscape…');
patchAndroid();
patchIOS();
console.log(`\nDone — ${changed} patched, ${skipped} skipped.`);
