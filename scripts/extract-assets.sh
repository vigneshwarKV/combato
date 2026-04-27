#!/bin/bash
set -e

# Extract Craftpix assets from assets/*.zip into public/assets/
# Run from project root: bash scripts/extract-assets.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 4 characters have Spine JSON (skeletal animation, efficient)
SPINE_CHARACTERS=(
  "craftpix-net-176625-woman-hero-game-character-sprite"
  "craftpix-net-388298-cartoon-boy-character-animation-sprites"
  "craftpix-net-546825-monkey-game-character-sprite"
  "craftpix-net-861830-turtle-game-character-sprite"
)

# 9 characters have PNG frame sequences only (Spriter SCML source)
PNG_CHARACTERS=(
  "craftpix-net-242887-female-main-character-sprites-for-platformer"
  "craftpix-net-360293-beast-character-sprites"
  "craftpix-net-474294-mad-scientist-game-character-sprite"
  "craftpix-net-494359-main-character-for-2d-platformer"
  "craftpix-net-506757-animated-boy-character-sprite-pack"
  "craftpix-net-751362-game-character-for-2d-platformer"
  "craftpix-net-797828-cartoon-boy-sprites-for-platformer-game"
  "craftpix-net-863349-female-protagonist-character-sprites"
  "craftpix-net-999280-boy-character-sprites-for-platformer"
)

echo "Extracting Spine characters (4)..."
for name in "${SPINE_CHARACTERS[@]}"; do
  zip="assets/${name}.zip"
  [ -f "$zip" ] || continue
  slug=$(echo "$name" | sed -E 's/craftpix-net-[0-9]+-(.+)/\1/')
  target="public/assets/characters/$slug"
  mkdir -p "$target"
  unzip -j -o -q "$zip" "Json And Atlas/*" -d "$target" 2>/dev/null || \
    unzip -j -o -q "$zip" "Json and Atlas/*" -d "$target"
  # @pixi/spine-pixi only recognizes ".atlas" extension — rename ".atlas.txt"
  for atlas_txt in "$target"/*.atlas.txt; do
    [ -f "$atlas_txt" ] || continue
    mv "$atlas_txt" "${atlas_txt%.txt}"
  done
  echo "  spine -> $slug"
done

echo "Extracting PNG-frame characters (9)..."
for name in "${PNG_CHARACTERS[@]}"; do
  zip="assets/${name}.zip"
  [ -f "$zip" ] || continue
  slug=$(echo "$name" | sed -E 's/craftpix-net-[0-9]+-(.+)/\1/')
  target="public/assets/characters/$slug"
  mkdir -p "$target"
  rm -rf "$target/frames" "$target/PNG" "$target/PNG_Spriter"

  # Craftpix packs use 3 different layouts — try each.
  if unzip -l "$zip" | grep -q "^.*PNG/Player/"; then
    unzip -o -q "$zip" "PNG/Player/*" -d "$target"
    mv "$target/PNG/Player" "$target/frames"
    rm -rf "$target/PNG"
  elif unzip -l "$zip" | grep -q "^.*PNG_Spriter/Player/"; then
    unzip -o -q "$zip" "PNG_Spriter/Player/*" -d "$target"
    mv "$target/PNG_Spriter/Player" "$target/frames"
    rm -rf "$target/PNG_Spriter"
  else
    # Fallback: no /Player/ subfolder, animations are directly under PNG/
    unzip -o -q "$zip" "PNG/*" -d "$target"
    mv "$target/PNG" "$target/frames"
  fi
  echo "  png -> $slug"
done

echo "Extracting backgrounds..."
mkdir -p public/assets/backgrounds
unzip -o -q assets/background/craftpix-891163-2d-horizontal-battle-backgrounds.zip "PNG/*" -d public/assets/backgrounds/

echo "Extracting HP/meter bars..."
mkdir -p public/assets/bars
unzip -o -q assets/health-bar/craftpix-net-277643-rpg-loading-bars-pack.zip "Textures/*" -d public/assets/bars/

echo ""
echo "Generating character manifests..."
node scripts/generate-manifests.mjs

echo ""
echo "Done."
