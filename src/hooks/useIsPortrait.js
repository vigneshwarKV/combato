import { useEffect, useState } from 'react';

const PORTRAIT = '(max-width: 760px) and (orientation: portrait)';
// Landscape phones: wide enough, but very short. Components that hand fixed
// pixel sizes to a canvas (Pixi previews) can't be reflowed by CSS alone, so
// they read this to pick a smaller sprite box.
const SHORT_LANDSCAPE = '(max-height: 500px) and (orientation: landscape)';

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useIsPortrait() {
  return useMediaQuery(PORTRAIT);
}

export function useShortLandscape() {
  return useMediaQuery(SHORT_LANDSCAPE);
}
