import { useMemo } from 'react';

// Four Craftpix battle backgrounds available. Index is picked deterministically
// from the fight seed so the same matchup always uses the same background.
const BACKGROUNDS = [
  'game_background_1',
  'game_background_2',
  'game_background_3',
  'game_background_4',
];

function pickBackground(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BACKGROUNDS[h % BACKGROUNDS.length];
}

/**
 * Renders a layered parallax background using the Craftpix battle backgrounds.
 * Each background ships with 5 layers that we stack back-to-front.
 *
 * Props:
 *   seed: string used to deterministically pick a background (e.g. fighterA.id+fighterB.id)
 *   parallax: if true, render all 5 layers; if false, just the composite image
 */
export default function ArenaBackground({ seed = 'default', parallax = true, children }) {
  const slug = useMemo(() => pickBackground(seed), [seed]);
  const base = `/assets/backgrounds/PNG/${slug}`;

  const layerStyle = {
    position: 'absolute',
    inset: 0,
    backgroundSize: 'cover',
    backgroundPosition: 'center bottom',
    backgroundRepeat: 'no-repeat',
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'visible' }}>
      {parallax ? (
        <>
          <div style={{ ...layerStyle, backgroundImage: `url(${base}/layers/back_land.png)` }} />
          <div style={{ ...layerStyle, backgroundImage: `url(${base}/layers/back_decor.png)` }} />
          <div style={{ ...layerStyle, backgroundImage: `url(${base}/layers/battleground.png)` }} />
          <div style={{ ...layerStyle, backgroundImage: `url(${base}/layers/ground_decor.png)` }} />
          <div style={{ ...layerStyle, backgroundImage: `url(${base}/layers/front_decor.png)` }} />
        </>
      ) : (
        <div style={{ ...layerStyle, backgroundImage: `url(${base}/${slug}.png)` }} />
      )}
      {children}
    </div>
  );
}
