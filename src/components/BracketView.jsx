import { useState, useEffect, useMemo, useRef } from 'react';

const CELL_W = 168;
const CELL_H = 78;
const COL_GAP = 56;
const COL_W = CELL_W + COL_GAP;
const SLOT_H = 116;
const TROPHY_W = 220;
const TROPHY_PAD = 28;
const MIN_STAGE_H = 320;

function deriveRoundStatus(match, isCurrent) {
  if (match.isBye) return 'done';
  if (match.status === 'complete') return 'done';
  if (isCurrent) return 'next';
  if (match.fA && match.fB) return 'scheduled';
  return 'tbd';
}

function MatchCell({ match, isCurrent, label, x, y, seedA, seedB }) {
  const status = deriveRoundStatus(match, isCurrent);
  const aWon = match.status === 'complete' && match.winner?.peerId === match.fA?.peerId;
  const bWon = match.status === 'complete' && match.winner?.peerId === match.fB?.peerId;

  if (match.isBye) {
    const f = match.fA || match.fB;
    return (
      <div className="m-cell m-cell-bye" style={{ left: x, top: y, width: CELL_W }}>
        <div className="m-h">
          <span>{label}</span>
          <span className="m-pill m-pill-bye">BYE</span>
        </div>
        <div className="m-row m-row-win">
          <span className="m-seed">·</span>
          <span className="m-name">{f?.name || '?'}</span>
          <span className="m-score">→</span>
        </div>
        <div className="m-row m-row-empty">
          <span className="m-seed">·</span>
          <span className="m-name">—</span>
          <span className="m-score">·</span>
        </div>
      </div>
    );
  }

  function row(player, seed, won, opp) {
    const dimmed = match.status === 'complete' && opp && !won;
    if (!player) {
      return (
        <div className="m-row m-row-tbd">
          <span className="m-seed">·</span>
          <span className="m-name">TBD</span>
          <span className="m-score">–</span>
        </div>
      );
    }
    return (
      <div className={`m-row ${won ? 'm-row-win' : ''} ${dimmed ? 'm-row-lose' : ''}`}>
        <span className="m-seed">{seed}</span>
        <span className="m-name" title={player.name}>{player.name}</span>
        <span className="m-score">{match.status === 'complete' ? (won ? '1' : '0') : '–'}</span>
      </div>
    );
  }

  return (
    <div className={`m-cell m-cell-${status}`} style={{ left: x, top: y, width: CELL_W }}>
      <div className="m-h">
        <span>{label}</span>
        {status === 'next' && <span className="m-pill m-pill-next">UP NEXT</span>}
        {status === 'done' && <span className="m-pill m-pill-done">FINAL</span>}
        {status === 'scheduled' && <span className="m-pill m-pill-sched">SCHEDULED</span>}
        {status === 'tbd' && <span className="m-pill m-pill-sched">TBD</span>}
      </div>
      {row(match.fA, seedA, aWon, bWon)}
      {row(match.fB, seedB, bWon, aWon)}
    </div>
  );
}

function Clock({ ms }) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return (
    <span className="t-digits">
      {String(mm).padStart(2, '0')}
      <span className="sep">:</span>
      {String(ss).padStart(2, '0')}
    </span>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M7 4h10v4a5 5 0 1 1-10 0V4Z" fill="rgba(255,216,74,0.15)" />
      <path d="M5 6H3v2a3 3 0 0 0 3 3" />
      <path d="M19 6h2v2a3 3 0 0 1-3 3" />
      <path d="M9 17h6v3H9zM10 20h4v1H10z" fill="rgba(255,216,74,0.2)" />
      <path d="M12 4v9M9 8h6" strokeWidth="0.8" opacity="0.4" />
    </svg>
  );
}

function pathClass(match, currentMatchId) {
  if (!match) return 'p-tbd';
  if (match.matchId === currentMatchId) return 'p-next';
  if (match.status === 'complete') return 'p-done';
  return 'p-tbd';
}

export default function BracketView({ bracket, nextMatchStartsAt, isHost, onStartNow }) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, nextMatchStartsAt - Date.now()));
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    const tick = () => {
      const rem = Math.max(0, nextMatchStartsAt - Date.now());
      setRemainingMs(rem);
      if (rem === 0 && isHost && !firedRef.current) {
        firedRef.current = true;
        onStartNow?.();
      }
    };
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [nextMatchStartsAt, isHost, onStartNow]);

  const stats = useMemo(() => {
    if (!bracket) return null;
    let total = 0, complete = 0, scheduled = 0;
    bracket.rounds.forEach(r => r.matches.forEach(m => {
      if (m.isBye) return;
      total += 1;
      if (m.status === 'complete') complete += 1;
      else if (m.fA && m.fB) scheduled += 1;
    }));
    const currentRoundIdx = bracket.pointer?.roundIndex ?? bracket.rounds.length - 1;
    return { total, complete, scheduled, currentRoundIdx };
  }, [bracket]);

  if (!bracket) return null;

  const { rounds, pointer, champion, size: n } = bracket;
  const currentMatchId = pointer
    ? rounds[pointer.roundIndex]?.matches[pointer.matchIndex]?.matchId
    : null;

  const totalRounds = rounds.length;
  const sideRoundCount = Math.max(0, totalRounds - 1);
  const lastRound = rounds[rounds.length - 1];
  const finalMatch = lastRound?.matches[0] ?? null;

  // Each "side" round = original round's first half (left) or second half (right).
  // The final round always renders inside the trophy hub.
  const sideRounds = rounds.slice(0, sideRoundCount);
  const leftSide = sideRounds.map(r => ({
    ...r,
    matches: r.matches.slice(0, Math.max(1, r.matches.length / 2)),
  }));
  const rightSide = sideRounds.map(r => ({
    ...r,
    matches: r.matches.slice(Math.max(1, r.matches.length / 2)),
  }));

  // Geometry
  const perSideR0 = leftSide[0]?.matches.length || 1;
  const stageH = Math.max(perSideR0 * SLOT_H, MIN_STAGE_H);
  const sideW = sideRoundCount * COL_W;
  const stageW = 2 * (sideW + TROPHY_PAD) + TROPHY_W;
  const trophyLeft = sideW + TROPHY_PAD;
  const trophyCenterY = stageH / 2;

  const leftX = (ri) => ri * COL_W;
  const rightX = (ri) => stageW - ri * COL_W - CELL_W;
  function sideY(side, ri, mi) {
    const matchesInRound = side[ri].matches.length;
    const slotsPerMatch = perSideR0 / matchesInRound;
    return (mi + 0.5) * slotsPerMatch * SLOT_H;
  }
  const sideTop = (yc) => Math.round(yc - CELL_H / 2);

  // ── Connector paths ───────────────────────────────────────────────────
  const paths = [];
  // LEFT side: each round → next round (rightward)
  leftSide.forEach((round, ri) => {
    if (ri === sideRoundCount - 1) return;
    round.matches.forEach((match, mi) => {
      const ySrc = sideY(leftSide, ri, mi);
      const partner = mi % 2 === 0 ? mi + 1 : mi - 1;
      const yPartner = sideY(leftSide, ri, partner);
      const yDst = (ySrc + yPartner) / 2;
      const xSrc = leftX(ri) + CELL_W;
      const xMid = xSrc + COL_GAP / 2;
      const xDst = leftX(ri + 1);
      paths.push({
        d: `M ${xSrc} ${ySrc} L ${xMid} ${ySrc} L ${xMid} ${yDst} L ${xDst} ${yDst}`,
        cls: pathClass(match, currentMatchId),
      });
    });
  });

  // LEFT last side-round → trophy
  if (sideRoundCount > 0) {
    const ri = sideRoundCount - 1;
    leftSide[ri].matches.forEach((match, mi) => {
      const y = sideY(leftSide, ri, mi);
      const xSrc = leftX(ri) + CELL_W;
      const xDst = trophyLeft;
      paths.push({
        d: `M ${xSrc} ${y} L ${xDst} ${y}`,
        cls: pathClass(match, currentMatchId),
      });
    });
  }

  // RIGHT side: each round → next round (leftward toward trophy)
  rightSide.forEach((round, ri) => {
    if (ri === sideRoundCount - 1) return;
    round.matches.forEach((match, mi) => {
      const ySrc = sideY(rightSide, ri, mi);
      const partner = mi % 2 === 0 ? mi + 1 : mi - 1;
      const yPartner = sideY(rightSide, ri, partner);
      const yDst = (ySrc + yPartner) / 2;
      const xSrc = rightX(ri);
      const xMid = xSrc - COL_GAP / 2;
      const xDst = rightX(ri + 1) + CELL_W;
      paths.push({
        d: `M ${xSrc} ${ySrc} L ${xMid} ${ySrc} L ${xMid} ${yDst} L ${xDst} ${yDst}`,
        cls: pathClass(match, currentMatchId),
      });
    });
  });

  // RIGHT last side-round → trophy
  if (sideRoundCount > 0) {
    const ri = sideRoundCount - 1;
    rightSide[ri].matches.forEach((match, mi) => {
      const y = sideY(rightSide, ri, mi);
      const xSrc = rightX(ri);
      const xDst = trophyLeft + TROPHY_W;
      paths.push({
        d: `M ${xSrc} ${y} L ${xDst} ${y}`,
        cls: pathClass(match, currentMatchId),
      });
    });
  }

  // ── Round strip (mirrored) ────────────────────────────────────────────
  // Columns: [sideRounds…, FINAL, …sideRounds reversed]
  const stripCols = [
    ...sideRounds.map((r, ri) => ({
      label: r.label,
      count: `${r.matches.length} → ${r.matches.length / 2}`,
      key: `L${ri}`,
    })),
    { label: 'Final', count: 'CHAMPION', center: true, key: 'F' },
    ...sideRounds.slice().reverse().map((r, ri) => ({
      label: r.label,
      count: `${r.matches.length / 2} ← ${r.matches.length}`,
      key: `R${ri}`,
    })),
  ];

  const currentRoundLabel = rounds[stats.currentRoundIdx]?.label || 'Final';
  const finalAName = finalMatch?.fA?.name || 'TBD';
  const finalBName = finalMatch?.fB?.name || 'TBD';

  return (
    <div className="tour-page">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bp-header">
        <div className="bp-header-left">
          <div className="bp-eyebrow">
            <span className="bp-dot-pulse" />
            {champion
              ? <>Tournament complete</>
              : <>Tournament in progress · Round {stats.currentRoundIdx + 1} of {totalRounds}</>}
          </div>
          <h1 className="bp-title">
            Prompt Kombat <span className="accent">Bracket</span>
          </h1>
          <div className="bp-sub">
            <span><b>{n}</b> fighters</span>
            <span className="sep">·</span>
            <span><b>{stats.complete}</b> decided</span>
            <span className="sep">·</span>
            <span><b>{stats.scheduled}</b> remaining</span>
          </div>
        </div>

        {!champion && (
          <div className="bp-timer-mid">
            <div>
              <div className="lbl">Next match in</div>
              <div className="clock"><Clock ms={remainingMs} /></div>
            </div>
            <div className="bp-divider" />
            {isHost && (
              <button
                className="btn-tour btn-tour-gold"
                onClick={() => { firedRef.current = true; onStartNow?.(); }}
              >
                ▶ START NOW
              </button>
            )}
          </div>
        )}

        <div className="bp-header-right">
          <span className="feed-pill">
            <span className="dot-r" />
            {pointer ? `${currentRoundLabel.toUpperCase()} · UP NEXT` : 'STANDBY'}
          </span>
        </div>
      </div>

      {/* ── Round strip (mirrored) ─────────────────────────────── */}
      <div
        className="round-strip"
        style={{ gridTemplateColumns: `repeat(${stripCols.length}, 1fr)` }}
      >
        {stripCols.map(col => (
          <div key={col.key} className={`rh ${col.center ? 'rh-trophy' : ''}`}>
            <span className="rh-name">{col.label}</span>
            <span className="rh-num">{col.count}</span>
          </div>
        ))}
      </div>

      {/* ── Bracket stage ──────────────────────────────────────── */}
      <div className="bp-stage">
        <div className="bp-tree" style={{ width: stageW, height: stageH, margin: '0 auto' }}>
          <svg
            className="bp-svg"
            width={stageW} height={stageH}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
          >
            {paths.map((p, i) => <path key={i} d={p.d} className={p.cls} />)}
          </svg>

          {/* LEFT SIDE matches */}
          {leftSide.map((round, ri) => round.matches.map((match, mi) => {
            const x = leftX(ri);
            const y = sideTop(sideY(leftSide, ri, mi));
            const seedBase = ri === 0 ? mi * 2 : null;
            const seedA = seedBase != null ? seedBase + 1 : '·';
            const seedB = seedBase != null ? seedBase + 2 : '·';
            return (
              <MatchCell
                key={match.matchId}
                match={match}
                isCurrent={match.matchId === currentMatchId}
                label={`${round.label.toUpperCase()} · #${mi + 1}`}
                x={x}
                y={y}
                seedA={seedA}
                seedB={seedB}
              />
            );
          }))}

          {/* RIGHT SIDE matches */}
          {rightSide.map((round, ri) => round.matches.map((match, mi) => {
            const x = rightX(ri);
            const y = sideTop(sideY(rightSide, ri, mi));
            const rightOffset = (rounds[ri]?.matches.length || 0) / 2;
            const matchNumber = mi + 1 + rightOffset;
            const seedBase = ri === 0 ? (mi + rightOffset) * 2 : null;
            const seedA = seedBase != null ? seedBase + 1 : '·';
            const seedB = seedBase != null ? seedBase + 2 : '·';
            return (
              <MatchCell
                key={match.matchId}
                match={match}
                isCurrent={match.matchId === currentMatchId}
                label={`${round.label.toUpperCase()} · #${matchNumber}`}
                x={x}
                y={y}
                seedA={seedA}
                seedB={seedB}
              />
            );
          }))}

          {/* Trophy hub at center */}
          <div
            className="trophy-hub"
            style={{
              left: trophyLeft,
              top: trophyCenterY - 110,
              width: TROPHY_W,
            }}
          >
            <div className="t-ring" />
            <div className="t-ring t-ring-2" />
            <div className="t-icon"><TrophyIcon /></div>
            <div className="t-label">FINAL</div>
            <div className="t-final-line">
              <span className={finalMatch?.winner?.peerId === finalMatch?.fA?.peerId ? 'win' : ''}>
                {finalAName}
              </span>
              <span className="vs">vs</span>
              <span className={finalMatch?.winner?.peerId === finalMatch?.fB?.peerId ? 'win' : ''}>
                {finalBName}
              </span>
            </div>
            <div className="t-tbd">
              {champion?.name ? `★ ${champion.name} ★` : 'CHAMPION · TBD'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer legend ──────────────────────────────────────── */}
      <div className="bp-foot">
        <div className="bp-legend">
          <span><span className="dot dot-done" /> Decided</span>
          <span><span className="dot dot-win" /> Winner</span>
          <span><span className="dot dot-next" /> Up next</span>
          <span><span className="dot dot-tbd" /> Scheduled</span>
        </div>
        <div className="bp-foot-right">
          <span className="feed-pill"><span className="trophy-mini">★</span> Prize · <b>BRAGGING RIGHTS</b></span>
        </div>
      </div>
    </div>
  );
}
