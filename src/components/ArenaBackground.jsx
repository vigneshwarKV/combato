import { useEffect, useMemo, useRef, useState } from 'react';

// All battle backgrounds available (full-scene images).
const BACKGROUNDS = [
  'game_background_1',
  'game_background_2',
  'game_background_3',
  'game_background_4',
  'game_background_5',
  'game_background_6',
  'game_background_7',
];

// Deterministic pick from a seed — same seed always yields the same background.
// Used for synced contexts (e.g. tournament host + spectators must match).
function pickBySeed(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BACKGROUNDS[h % BACKGROUNDS.length];
}

function pickRandom() {
  return BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
}

const backgroundUrl = (slug) => `/assets/backgrounds/PNG/${slug}.png`;

// The URL a deterministic (non-random) mount will resolve to, so a caller can
// warm exactly that one image instead of all seven. Used by the pre-fight
// warm-up for the how-to-play tour's fixed seed.
export function backgroundUrlForSeed(seed) {
  return backgroundUrl(pickBySeed(seed));
}

/**
 * Renders a single full-scene battle background. Each background is one image
 * stored directly at /assets/backgrounds/PNG/<slug>.png.
 *
 * Props:
 *   seed: string identifying the fight (e.g. fighterA.id+fighterB.id). In
 *         deterministic mode it picks the background; in random mode a change
 *         to it triggers a fresh roll (new match → new random background).
 *   random: if true, pick a random background per fight (re-rolled when `seed`
 *         changes, stable within a fight). If false, pick deterministically
 *         from `seed` so multiple clients stay in sync. Defaults to false.
 *   fit: backgroundSize mode — 'cover' (fill, may crop) or 'contain' (show the
 *        whole image, never crop, may leave gaps). Defaults to 'cover'.
 *   position: backgroundPosition — which part to keep in frame when 'cover'
 *        crops (e.g. 'center top' keeps the sky, clips the bottom). Defaults
 *        to 'center bottom'.
 */
export default function ArenaBackground({ seed = 'default', random = false, fit = 'cover', position = 'center bottom', children }) {
  // Random mode: roll once on mount, then re-roll whenever the fight (seed)
  // changes so each match gets a fresh background but it's stable mid-fight.
  const [randomSlug, setRandomSlug] = useState(() => pickRandom());
  const seedRef = useRef(seed);
  useEffect(() => {
    if (random && seedRef.current !== seed) {
      seedRef.current = seed;
      setRandomSlug(pickRandom());
    }
  }, [random, seed]);

  const seededSlug = useMemo(() => pickBySeed(seed), [seed]);
  const slug = random ? randomSlug : seededSlug;
  const src = backgroundUrl(slug);

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
