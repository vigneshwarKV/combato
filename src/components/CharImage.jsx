import { useState } from 'react';
import { CHARACTERS } from '../data/characters.js';

export const ARCHETYPE_COLORS = {
  mage:    { bg: 'rgba(150,80,255,0.18)',  border: '#9955ff', text: '#cc99ff' },
  acrobat: { bg: 'rgba(0,190,255,0.14)',   border: '#00bbff', text: '#55ddff' },
  tank:    { bg: 'rgba(255,140,50,0.14)',  border: '#ff8833', text: '#ffaa55' },
  striker: { bg: 'rgba(255,60,60,0.14)',   border: '#ff3333', text: '#ff7777' },
  ranger:  { bg: 'rgba(40,200,100,0.14)',  border: '#22cc66', text: '#55ee99' },
};

export function getCharPreviewUrl(char) {
  if (!char) return null;
  if (char.renderMode !== 'png') {
    return `${char.assetBase}/preview.png`;
  }
  const dirName = char.assetBase.split('/').pop();
  const prefix = dirName === 'main-character-for-2d-platformer' ? 'Player_' : '';
  return `${char.assetBase}/frames/Idle/${prefix}Idle_000.png`;
}

// Accept either a full char object or a characterId string
export default function CharImage({ char, characterId, size = 52 }) {
  const [failed, setFailed] = useState(false);
  const resolved = char || (characterId ? CHARACTERS[characterId] : null);
  const url = getCharPreviewUrl(resolved);

  if (!resolved) return null;

  if (failed || !url) {
    const c = ARCHETYPE_COLORS[resolved.archetype] || ARCHETYPE_COLORS.striker;
    return (
      <div style={{
        width: size, height: size, flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: c.bg, border: `1px solid ${c.border}`,
      }}>
        <span style={{ fontFamily: 'var(--font-arena)', fontSize: size * 0.42, color: c.text, lineHeight: 1 }}>
          {resolved.name[0]}
        </span>
        <span style={{ fontFamily: 'var(--font-arena)', fontSize: Math.max(size * 0.14, 7), color: c.border, letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 1, opacity: 0.85 }}>
          {resolved.archetype}
        </span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={resolved.name}
      style={{ width: size, height: size, objectFit: 'contain', imageRendering: 'pixelated', display: 'block' }}
      onError={() => setFailed(true)}
    />
  );
}
