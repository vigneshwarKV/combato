// Generate manifest.json for each PNG-frame character, listing each animation
// folder and the frames (filenames, in order). Used by FighterSprite at runtime.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHAR_DIR = path.join(ROOT, 'public/assets/characters');

for (const slug of fs.readdirSync(CHAR_DIR)) {
  const dir = path.join(CHAR_DIR, slug);
  if (!fs.statSync(dir).isDirectory()) continue;
  const framesDir = path.join(dir, 'frames');
  if (!fs.existsSync(framesDir)) continue;

  const manifest = { renderMode: 'png', animations: {} };
  for (const animName of fs.readdirSync(framesDir)) {
    const animDir = path.join(framesDir, animName);
    if (!fs.statSync(animDir).isDirectory()) continue;
    const files = fs.readdirSync(animDir)
      .filter(f => f.toLowerCase().endsWith('.png'))
      .sort();
    if (files.length === 0) continue;
    manifest.animations[animName] = files;
  }

  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`  manifest: ${slug} (${Object.keys(manifest.animations).length} animations)`);
}
