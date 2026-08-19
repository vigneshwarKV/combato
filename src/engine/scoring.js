// Leaderboard points — the SINGLE source of truth for how a match converts to
// points. Imported by BOTH the client (instant post-match preview) and the
// server (/api/score, the authoritative recompute), so the two can never drift.
//
// Pure module: no imports, no DOM, no env — safe to run in the browser and in a
// Node serverless function. Tune the constants below to reshape the economy.

export const SCORING = {
  winBase: 100,       // points just for winning
  lossBase: 20,       // participation floor on a loss (keeps the board lively)
  koBonus: 25,        // finishing by KO beats a time-decision
  speedBonusMax: 30,  // max bonus for a fast win (linear, 0 at the time limit)
  timeLimitMs: 90_000, // must match FIGHT_TIME_LIMIT_MS in fightEngine.js
  // Competitive weight per mode. Bot is halved so grinding easy bot wins is worth
  // less on a board that also has real PvP (no daily cap — bot points are uncapped).
  modeWeight: { bot: 0.5, '1v1': 1.0, tournament: 1.5 },
};

const MODES = Object.keys(SCORING.modeWeight);

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

// Points for one match summary. Inputs are bounded here too, so a lying client
// can at worst submit values inside the legal range — never an absurd score.
export function pointsFor({ won, hpRemaining, ko, durationMs, mode } = {}) {
  const weight = SCORING.modeWeight[mode];
  if (weight == null) return 0; // unknown mode → no points (server rejects it anyway)

  const hp = clamp(hpRemaining, 0, 100);
  const dur = clamp(durationMs, 0, SCORING.timeLimitMs);

  const base = won ? SCORING.winBase : SCORING.lossBase;
  const hpBonus = won ? Math.round(hp) : 0;
  const koBonus = won && ko ? SCORING.koBonus : 0;
  const speedBonus = won
    ? Math.round(((SCORING.timeLimitMs - dur) / SCORING.timeLimitMs) * SCORING.speedBonusMax)
    : 0;

  return Math.max(0, Math.round((base + hpBonus + koBonus + speedBonus) * weight));
}

// Extract the scoring summary from a runFight() result for a given player side.
// runFight returns { winner: 'A'|'B'|'draw', hpA, hpB, ... }. durationMs is
// measured by the caller (the fight page), since the engine doesn't return it.
export function buildMatchSummary(result, { mode, playerSide, durationMs }) {
  const winner = result?.winner ?? 'draw';
  const hpA = result?.hpA ?? 0;
  const hpB = result?.hpB ?? 0;

  const won = winner === playerSide;
  const hpRemaining = playerSide === 'A' ? hpA : hpB;
  const ko = hpA <= 0 || hpB <= 0; // a KO happened if either fighter hit 0

  return {
    mode,
    won,
    hpRemaining: Math.round(clamp(hpRemaining, 0, 100)),
    ko,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
  };
}

// True for modes we score. Handy guard at call sites.
export function isScoredMode(mode) {
  return MODES.includes(mode);
}
