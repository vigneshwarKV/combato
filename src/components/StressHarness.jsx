import { useEffect, useRef, useState } from 'react';
import ArenaStage from './ArenaStage.jsx';
import { CHARACTERS } from '../data/characters.js';
import { getSnapshot, subscribe, logEvent, copyDiagnostics } from '../engine/glDebug.js';

// Repro harness for the "fighters vanish after some matches" bug.
//
// A tournament unmounts and remounts ArenaStage once per match (RoomPage only
// renders Arena while phase === 'fighting'), so 20 matches means 20 mount/
// unmount cycles. This compresses that into a couple of minutes.
//
// The important knob is `hold`: ArenaStage awaits loadFighterSprite() before it
// parents anything, and unmounting DURING that await is what strands a Spine
// skeleton on the global ticker. So the hold time is randomised across that
// window — some cycles unmount mid-load, some after. A fixed hold would miss
// the race entirely, which is exactly why this is hard to hit by hand.
//
//   /dev?debug=gl&stress=20            20 cycles, holds randomised 0–700ms
//   /dev?debug=gl&stress=20&hold=1500  longer holds (mostly post-load)
//   /dev?debug=gl&stress=20&strict=1   plus StrictMode double-mount

const SPINE_IDS = Object.values(CHARACTERS).filter(c => c.renderMode === 'spine').map(c => c.id);
const PNG_IDS = Object.values(CHARACTERS).filter(c => c.renderMode === 'png').map(c => c.id);

export default function StressHarness({ cycles = 20, maxHold = 700, pool = 'spine' }) {
  const ids = pool === 'png' ? PNG_IDS : pool === 'all' ? [...SPINE_IDS, ...PNG_IDS] : SPINE_IDS;

  const [cycle, setCycle] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const timerRef = useRef(null);
  // Deterministic pair/hold sequence so a run can be repeated exactly.
  const seedRef = useRef(1);

  useEffect(() => subscribe(() => force(n => n + 1)), []);

  const rand = () => {
    seedRef.current = (seedRef.current * 1103515245 + 12345) & 0x7fffffff;
    return seedRef.current / 0x7fffffff;
  };

  useEffect(() => {
    if (!running || cycle >= cycles) return undefined;
    // Mounted → wait a randomised hold → unmount → short gap → next cycle.
    const hold = Math.round(rand() * maxHold);
    logEvent('stress:cycle', { cycle, hold, mounted: true });
    timerRef.current = setTimeout(() => {
      setMounted(false);
      timerRef.current = setTimeout(() => {
        setCycle(c => c + 1);
        setMounted(true);
      }, 120);
    }, hold);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle, running]);

  const pairIndex = cycle % ids.length;
  const charA = ids[pairIndex];
  const charB = ids[(pairIndex + 1) % ids.length];

  const s = getSnapshot();
  const done = cycle >= cycles;

  return (
    <div style={{ minHeight: '100vh', background: '#08000d', color: '#d8d0ff', padding: 16, font: '12px ui-monospace, Menlo, monospace' }}>
      <h2 style={{ margin: '0 0 8px' }}>ArenaStage stress harness</h2>
      <div style={{ marginBottom: 8 }}>
        cycle <b>{Math.min(cycle, cycles)}</b> / {cycles} · pool <b>{pool}</b> · {charA} vs {charB} · {mounted ? 'MOUNTED' : 'unmounted'}
        {done && <b style={{ color: '#9dffb0' }}> — DONE</b>}
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <Stat label="ticker listeners" value={s.ticker.listeners} warn={s.ticker.listeners > 6} />
        <Stat label="ticker throws" value={s.ticker.throws} warn={s.ticker.throws > 0} />
        <Stat label="pixi apps live" value={s.apps.live} warn={s.apps.live > 2} />
        <Stat label="apps made/killed" value={`${s.apps.created}/${s.apps.destroyed}`} />
        <Stat label="gl lost" value={s.context.lost} warn={s.context.lost > 0} />
      </div>

      <div style={{ marginBottom: 10, opacity: 0.75 }}>
        Expected if the orphaned-Spine leak is real: <b>ticker listeners climbs and never falls</b>,
        rising on the cycles whose hold landed mid-load (look for <code>arena:cancelledMidLoad</code> in the log).
        A clean run holds steady at its baseline.
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setRunning(r => !r)}>{running ? 'PAUSE' : 'RESUME'}</button>
        <button onClick={() => { setCycle(0); seedRef.current = 1; setRunning(true); }}>RESTART</button>
        <button onClick={() => copyDiagnostics()}>COPY DIAGNOSTICS</button>
      </div>

      <div style={{ opacity: 0.5, marginBottom: 4 }}>ticker owners</div>
      <div style={{ marginBottom: 12 }}>
        {Object.entries(s.ticker.byOwner || {}).map(([k, v]) => (
          <div key={k} style={{ color: k === 'Spine' && v > 2 ? '#ff6b7f' : undefined }}>{k}: {v}</div>
        ))}
      </div>

      <div style={{ width: 1100, height: 500, position: 'relative', overflow: 'hidden', border: '1px solid #2a1c46' }}>
        {mounted && !done && (
          <ArenaStage
            key={cycle}
            characterAId={charA}
            characterBId={charB}
            width={1100}
            height={500}
            animClassA="anim-idle"
            animClassB="anim-idle"
            animKeyA={0}
            animKeyB={0}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div>
      <div style={{ opacity: 0.55 }}>{label}</div>
      <div style={{ fontSize: 18, color: warn ? '#ff6b7f' : '#9dffb0' }}>{value}</div>
    </div>
  );
}
