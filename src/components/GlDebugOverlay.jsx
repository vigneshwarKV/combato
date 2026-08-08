import { useEffect, useState } from 'react';
import {
  isGlDebugEnabled,
  getSnapshot,
  subscribe,
  copyDiagnostics,
  probeContextHeadroom,
} from '../engine/glDebug.js';

// On-screen readout for the arena rendering diagnostics. Rendered only when
// ?debug=gl is active. The numbers that matter, in order:
//
//   TICKER   — climbing and never falling means Spine skeletons are being
//              stranded on PIXI.Ticker.shared by cancelled ArenaStage mounts.
//   THROWS   — non-zero means a listener is aborting the ticker loop, which
//              starves every listener after it (the fighters).
//   GL LOST  — non-zero means the browser dropped a WebGL context and Pixi
//              did not restore it.
//   SCALE    — near zero means the canvas is being drawn at no size.
//
// COPY dumps the full ring buffer, so a player who hits the glitch can send
// back the state at the moment it happened.

const box = {
  position: 'fixed',
  top: 4,
  left: 4,
  zIndex: 99999,
  font: '10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
  background: 'rgba(4,2,10,0.88)',
  color: '#d8d0ff',
  border: '1px solid #4b3a7a',
  borderRadius: 4,
  padding: '5px 7px',
  maxWidth: 300,
  pointerEvents: 'auto',
  userSelect: 'text',
};

const btn = {
  font: 'inherit',
  background: '#2a1c46',
  color: '#d8d0ff',
  border: '1px solid #4b3a7a',
  borderRadius: 3,
  padding: '2px 5px',
  cursor: 'pointer',
};

function Row({ label, value, warn }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ color: warn ? '#ff6b7f' : '#9dffb0', fontWeight: warn ? 700 : 400 }}>{value}</span>
    </div>
  );
}

export default function GlDebugOverlay() {
  const [, force] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => subscribe(() => force(n => n + 1)), []);

  if (!isGlDebugEnabled()) return null;

  const s = getSnapshot();
  const sc = s.stageScale;
  const f = s.fighters;

  if (collapsed) {
    return (
      <div style={box} onClick={() => setCollapsed(false)}>
        gl {s.apps.live} · tick {s.ticker.listeners}
        {s.ticker.throws > 0 && <span style={{ color: '#ff6b7f' }}> · throw {s.ticker.throws}</span>}
        {s.context.lost > 0 && <span style={{ color: '#ff6b7f' }}> · lost {s.context.lost}</span>}
      </div>
    );
  }

  return (
    <div style={box}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, cursor: 'pointer' }}
        onClick={() => setCollapsed(true)}
      >
        <b>ARENA DIAGNOSTICS</b><span style={{ opacity: 0.5 }}>[hide]</span>
      </div>

      <Row label="pixi apps live" value={s.apps.live} warn={s.apps.live > 8} />
      <Row label="apps made/killed" value={`${s.apps.created}/${s.apps.destroyed}`} />
      <Row label="ticker listeners" value={s.ticker.listeners} warn={s.ticker.listeners > 6} />
      <Row label="ticker throws" value={s.ticker.throws} warn={s.ticker.throws > 0} />
      <Row label="gl lost (unexpected)" value={s.context.lost} warn={s.context.lost > 0} />
      <Row label="gl lost (our destroy)" value={s.context.lostExpected} />
      <Row label="assets during fight" value={s.assets.duringArena} warn={s.assets.duringArena > 0} />
      <Row label="preloaded at mount" value={String(s.assets.preloadedAtMount)} warn={s.assets.preloadedAtMount === false} />

      {sc && (
        <>
          <div style={{ opacity: 0.5, marginTop: 3 }}>stageScale</div>
          <Row label="scale" value={sc.s?.toFixed(3)} warn={sc.s < 0.15} />
          <Row label="clientH − pad" value={`${sc.clientH} − ${Math.round(sc.padBottom)}`} warn={sc.clientH - sc.padBottom <= 0} />
          <Row label="innerH (pad src)" value={sc.innerH} warn={Math.abs(sc.innerH - sc.clientH) > 200} />
          {sc.bailed && <Row label="BAILED (stale)" value="yes" warn />}
        </>
      )}

      {s.ticker.byOwner && Object.keys(s.ticker.byOwner).length > 0 && (
        <>
          <div style={{ opacity: 0.5, marginTop: 3 }}>ticker owners</div>
          {Object.entries(s.ticker.byOwner).map(([k, v]) => (
            <Row key={k} label={k} value={v} warn={k === 'Spine' && v > 2} />
          ))}
        </>
      )}

      {f && (
        <>
          <div style={{ opacity: 0.5, marginTop: 3 }}>fighters</div>
          {['A', 'B'].map(side => f[side] && (
            <Row
              key={side}
              label={`${side} vis/scale/parent`}
              value={`${f[side].visible ? 'Y' : 'N'}/${f[side].scaleX?.toFixed(2)}/${f[side].parented ? 'Y' : 'N'}`}
              warn={!f[side].visible || !f[side].parented || Math.abs(f[side].scaleX) < 0.01}
            />
          ))}
          <Row label="ctx lost" value={String(f.contextLost)} warn={f.contextLost} />
        </>
      )}

      {s.ticker.lastThrow && (
        <div style={{ marginTop: 3, color: '#ff6b7f', wordBreak: 'break-word' }}>
          throw in {s.ticker.lastThrow.owner}: {s.ticker.lastThrow.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
        <button style={btn} onClick={async () => setToast(await copyDiagnostics())}>COPY</button>
        <button style={btn} onClick={() => setToast(`headroom ${probeContextHeadroom()}`)}>HEADROOM</button>
        <button style={btn} onClick={() => setToast(window.__pkDebug?.killContext() ?? '')}>KILL GL</button>
      </div>
      {toast && <div style={{ marginTop: 3, opacity: 0.7 }}>{toast}</div>}
    </div>
  );
}
