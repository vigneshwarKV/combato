import { useState, useEffect } from 'react';
import Icon from './Icons.jsx';
import CharacterPreview from '../CharacterPreview.jsx';
import { ARCHETYPES } from '../../data/designData.js';
import { CHARACTERS as ENGINE_CHARS } from '../../data/characters.js';

// Per-character manifest cache. Shared across every CharSprite instance so the
// 9 visible setup tiles share one fetch per character pack.
const manifestCache = new Map();
const inflight = new Map();

async function loadManifest(assetBase) {
  if (manifestCache.has(assetBase)) return manifestCache.get(assetBase);
  if (inflight.has(assetBase)) return inflight.get(assetBase);
  const p = fetch(`${assetBase}/manifest.json`)
    .then(r => { if (!r.ok) throw new Error(`manifest ${r.status}`); return r.json(); })
    .then(m => { manifestCache.set(assetBase, m); inflight.delete(assetBase); return m; })
    .catch(e => { inflight.delete(assetBase); throw e; });
  inflight.set(assetBase, p);
  return p;
}

const FPS = 10;
const FRAME_MS = Math.round(1000 / FPS);
const SETTLE_MS = 220; // brief hold on the last action frame before next pick

// Pick the action animation keys that make a tile preview feel alive — these
// are visually distinct from idle (lunge, low slide, vertical jump, ult lift).
// Falls back gracefully if a character's animation map is missing any entry.
function buildPreviewActions(engineChar) {
  const a = engineChar.animations || {};
  const ultKey = Object.keys(a).find(k => k.startsWith('ultimate_'));
  return [a.hit, a.slide, a.jump, ultKey && a[ultKey]].filter(Boolean);
}

export function Pips({ value, tone = 'atk', max = 5 }) {
  return (
    <span className="pips">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`pip ${i < value ? 'on ' + tone : ''}`} />
      ))}
    </span>
  );
}

// Frame-by-frame sprite driven by the per-character manifest:
//   - default: idle animation loops at ~10fps
//   - active (hover/select): rotates Hit → Slide → Jump → ult, one full cycle
//     of each animation in turn, then loops the rotation
// Falls back to the static thumb URL while the manifest is loading or for
// non-PNG characters (locked spine fighters render a letter via CharTile).
export function CharSprite({ char, active }) {
  const engineChar = ENGINE_CHARS[char.id];
  const assetBase = engineChar?.assetBase;
  const isPng = engineChar?.renderMode === 'png';

  const [manifest, setManifest] = useState(() => assetBase ? manifestCache.get(assetBase) || null : null);
  const [anim, setAnim] = useState(null);   // animation key (e.g. 'Idle', 'Hit')
  const [frame, setFrame] = useState(0);

  // Fetch the manifest once per asset pack (cached). Without it we just hold
  // the static thumb path the design data provides.
  useEffect(() => {
    if (!isPng || !assetBase) return;
    if (manifest) return;
    let cancelled = false;
    loadManifest(assetBase).then(m => { if (!cancelled) setManifest(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isPng, assetBase, manifest]);

  // Animation rotation driver. When inactive we sit on idle; when active we
  // schedule the next action after the current one completes (frames × FRAME_MS
  // + a short settle). Cleanup cancels any pending switch so toggling hover off
  // mid-cycle returns to idle promptly.
  useEffect(() => {
    if (!isPng || !manifest || !engineChar) return;
    const idleKey = engineChar.animations?.idle;
    if (!idleKey || !manifest.animations[idleKey]) return;

    if (!active) {
      setAnim(idleKey);
      setFrame(0);
      return;
    }

    const actions = buildPreviewActions(engineChar)
      .filter(a => manifest.animations[a]?.length);
    if (actions.length === 0) {
      setAnim(idleKey);
      setFrame(0);
      return;
    }

    let cancelled = false;
    let timer = null;
    let i = Math.floor(Math.random() * actions.length);

    function next() {
      if (cancelled) return;
      const a = actions[i % actions.length];
      i += 1;
      const frames = manifest.animations[a];
      setAnim(a);
      setFrame(0);
      timer = setTimeout(next, frames.length * FRAME_MS + SETTLE_MS);
    }
    next();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, manifest, isPng, engineChar]);

  // Frame ticker — advances within the current animation. Idle loops; action
  // cycles hold on the last frame (the rotation driver swaps animations).
  useEffect(() => {
    if (!manifest || !anim) return;
    const frames = manifest.animations[anim];
    if (!frames || frames.length <= 1) return;
    const isIdle = anim === engineChar?.animations?.idle;
    const id = setInterval(() => {
      setFrame(f => {
        const next = f + 1;
        if (next >= frames.length) return isIdle ? 0 : frames.length - 1;
        return next;
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [anim, manifest, engineChar]);

  // Resolve the URL: animated frame if we have a manifest, else static thumb.
  let src = null;
  if (isPng && manifest && anim) {
    const frames = manifest.animations[anim];
    if (frames?.length) src = `${assetBase}/frames/${anim}/${frames[Math.min(frame, frames.length - 1)]}`;
  }
  if (!src) src = char.thumb;
  if (!src) return null;

  return <img className="char-sprite" src={src} alt={char.name} draggable="false" />;
}

const archToneVar = (cls) =>
  cls === 'atk' ? 'red'
  : cls === 'def' ? 'cyan'
  : cls === 'mage' ? 'plasma'
  : cls === 'range' ? 'green'
  : 'gold';

export function CharTile({ char, selected, onSelect, onInfo }) {
  const [hovered, setHovered] = useState(false);
  const engineChar = ENGINE_CHARS[char.id];
  const isSpine = engineChar?.renderMode === 'spine';
  const locked = !!char.locked;
  const active = !locked && (hovered || selected);
  return (
    <div
      className={`char-tile ${selected ? 'selected' : ''} ${active ? 'hovered' : ''} ${locked ? 'locked' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (!locked) onSelect(char.id); }}
    >
      {locked && (
        <div className="char-tile-lock" aria-label={`${char.name} locked`} title="Locked">
          <Icon name="lock" size={20} />
        </div>
      )}
      {onInfo && !locked && (
        <button
          className="char-tile-info"
          onClick={e => { e.stopPropagation(); onInfo(char.id); }}
          aria-label={`View ${char.name} details`}
          title="View details"
        >
          <Icon name="info" size={14} />
        </button>
      )}
      <div className="char-tile-stage">
        {isSpine
          ? <div className="char-tile-spine">
              <CharacterPreview
                characterId={char.id}
                width={180}
                height={170}
                mode={active ? 'actions' : 'idle'}
              />
            </div>
          : (char.thumb
              ? <CharSprite char={char} active={active} />
              : <div style={{
                  fontFamily: 'var(--f-display)', fontSize: 64,
                  color: 'var(--ink-dim)', letterSpacing: '0.04em',
                  filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))',
                }}>{char.name[0]}</div>)
        }
        <div className="rim-light" />
      </div>
      <div className="char-tile-foot">
        <div className="char-tile-name">{char.name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          <Pips value={Math.round(char.stats.atk / 20)} tone="atk" max={5} />
          <Pips value={Math.round(char.stats.def / 20)} tone="def" max={5} />
        </div>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, children, width = 560 }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="icon-btn"
          style={{ position: 'absolute', top: 12, right: 12 }}
          aria-label="Close"
        ><Icon name="close" /></button>
        {children}
      </div>
    </div>
  );
}

export function Bar({ label, value, red, gold }) {
  return (
    <div className={`bar ${red ? 'red' : gold ? 'gold' : ''}`}>
      <span style={{ width: 28 }}>{label}</span>
      <span className="bar-track"><span className="bar-fill" style={{ width: `${value}%` }} /></span>
      <span className="bar-val">{value}</span>
    </div>
  );
}

export function LandscapeLock() {
  return (
    <div className="landscape-lock">
      <Icon name="rotate" size={96} />
      <div className="ll-title">Rotate your device</div>
      <p className="ll-sub">
        Prompt Kombat is built for landscape. Turn your phone sideways to enter the ring.
      </p>
    </div>
  );
}

export function CharDetail({ char }) {
  const arch = ARCHETYPES[char.archetype];
  const archTone = archToneVar(arch.class);
  return (
    <div style={{
      position: 'relative',
      background: 'linear-gradient(110deg, rgba(255,216,74,0.08), transparent 60%), linear-gradient(180deg, rgba(34,22,69,0.55), rgba(13,9,23,0.85))',
      border: '1px solid var(--gold-dim)',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'relative',
        height: 190,
        background:
          'radial-gradient(ellipse 80% 30% at 50% 95%, rgba(255,216,74,0.35), transparent 70%), linear-gradient(180deg, #1a1130, #050309)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        overflow: 'hidden',
        borderBottom: '1px solid var(--gold-dim)',
      }}>
        {ENGINE_CHARS[char.id]?.renderMode === 'spine'
          ? <div className="char-detail-spine">
              <CharacterPreview characterId={char.id} width={240} height={190} mode="idle" />
            </div>
          : (char.thumb
              ? <CharSprite char={char} />
              : <div style={{ fontFamily: 'var(--f-display)', fontSize: 80, color: 'var(--ink-dim)' }}>?</div>)}
      </div>
      <div style={{ padding: '12px 14px 14px' }}>
        <div className="eyebrow" style={{ color: `var(--${archTone})` }}>{arch.label}</div>
        <h1 className="f-display" style={{
          fontSize: 26, lineHeight: 0.95, margin: '4px 0 6px',
          color: 'var(--gold)', letterSpacing: '0.03em',
        }}>{char.name}</h1>
        <p style={{ margin: '0 0 10px', color: 'var(--ink-soft)', fontSize: 12, lineHeight: 1.5 }}>{char.tagline}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <Bar label="ATK" value={char.stats.atk} red />
          <Bar label="DEF" value={char.stats.def} />
          <Bar label="SPM" value={char.stats.spm} gold />
        </div>
      </div>
    </div>
  );
}

// Two numbers per move: DMG and +SPM (super-meter). For attacks DMG is dealt to
// the opponent; for a GUARD (defend_low/high) it's the small chip you still TAKE
// when you correctly block a physical blow (shown as ▾chip). SPM is meter gained
// on a hit/evade/guard; the super move shows its METER COST (–100) instead.
export function MovesPanel({ char, moves }) {
  const list = char.moves || moves || [];
  const cols = '1fr 52px 56px';
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>MOVE SET</div>
      <div className="move-head" style={{ gridTemplateColumns: cols }}>
        <span />
        <span className="move-col">DMG</span>
        <span className="move-col">SPM</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {list.map(m => {
          const isSuper = !!m.super || m.key === 'super_move';
          const dmg = isSuper ? (char.ult?.dmg ?? m.dmg ?? 0) : (m.dmg ?? 0);
          return (
            <div
              key={m.key}
              className={`move ${isSuper ? 'ult' : ''} ${m.evade ? 'evade' : ''}`}
              style={{ gridTemplateColumns: cols }}
            >
              <div className="move-name">{m.name}</div>
              <div className="move-dmg">
                {m.guard
                  ? (m.chip > 0
                      ? <span className="chip" title="HP you still lose when you correctly block this line">▾{m.chip}</span>
                      : <span className="lbl">–</span>)
                  : (dmg > 0 ? dmg : <span className="lbl">–</span>)}
              </div>
              <div className={`move-spm ${isSuper ? 'cost' : ''}`}>
                {isSuper
                  ? '–100'
                  : (m.spm > 0 ? `+${m.spm}` : <span className="lbl">–</span>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
