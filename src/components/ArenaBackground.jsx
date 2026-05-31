import { useMemo } from 'react';

// Four Craftpix battle backgrounds available. Index is picked deterministically
// from the fight seed so the same matchup always uses the same background.
const BACKGROUNDS = [
  'game_background_1',
  'game_background_2',
  'game_background_3',
  'game_background_4',
  "game_background_5"
];

function pickBackground(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BACKGROUNDS[h % BACKGROUNDS.length];
}

/**
 * Renders a single full-scene battle background. Each background is one image
 * stored directly at /assets/backgrounds/PNG/<slug>.png.
 *
 * Props:
 *   seed: string used to deterministically pick a background (e.g. fighterA.id+fighterB.id)
 *   fit: backgroundSize mode — 'cover' (fill, may crop) or 'contain' (show the
 *        whole image, never crop, may leave gaps). Defaults to 'cover'.
 *   position: backgroundPosition — which part to keep in frame when 'cover'
 *        crops (e.g. 'center top' keeps the sky, clips the bottom). Defaults
 *        to 'center bottom'.
 */
export default function ArenaBackground({ seed = 'default', fit = 'cover', position = 'center bottom', children }) {
  const slug = useMemo(() => pickBackground(seed), [seed]);
  const src = `/assets/backgrounds/PNG/${slug}.png`;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'visible' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${src})`,
          backgroundSize: fit,
          backgroundPosition: position,
          backgroundRepeat: 'no-repeat',
        }}
      />
      {children}
    </div>
  );
}
