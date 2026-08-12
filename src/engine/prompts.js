import { BASE_ACTIONS, validActionsForCharacter, isUltimateKey, attackLine } from './damageEngine.js';
import { CHARACTERS, METER, BASE_DAMAGE, BLOCKED_SUPER_DAMAGE_MULTIPLIER, getMeterGain, throwbackDmgFor } from '../data/characters.js';

const MOCK_AI = false;

// All LLM calls go through our managed serverless proxy. The model/provider is
// decided server-side by env (see api/_handler.js) — the client never picks one.
//
// On the web this is a same-origin relative call (API_BASE = ''). Native builds
// (Capacitor) have no local server — the webview origin is capacitor://localhost
// / https://localhost — so the bundle must point at the deployed backend. Set
// VITE_API_BASE (e.g. https://combato.example.com) at build time; the proxy
// sends permissive CORS headers so the cross-origin call from the app is allowed.
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const AI_ENDPOINT = `${API_BASE}/api/ai`;

// The single move token the model uses for any character's special. Internally
// it maps to that character's primary ultimate (see resolveSuperMove).
export const SUPER_MOVE_TOKEN = 'super_move';
const SUPER_SYNONYMS = new Set(['super_move', 'supermove', 'super move', 'super', 'ultimate']);

// The move vocabulary a player's plan can name — what setup and the tutorial
// both show. Derived from the engine so the UI can't drift from what's
// actually accepted: 'idle' is dropped (it's the do-nothing fallback, not a
// choice), the rest are ordered attack → guard → super for reading, and any
// action the engine gains later still appears, just at the end.
const MOVE_DISPLAY_ORDER = ['hit', 'shoot', 'slide', 'jump', 'defend_high', 'defend_low'];
export const PLAYER_MOVE_TOKENS = [
  ...MOVE_DISPLAY_ORDER.filter(a => BASE_ACTIONS.includes(a)),
  ...BASE_ACTIONS.filter(a => a !== 'idle' && !MOVE_DISPLAY_ORDER.includes(a)),
  SUPER_MOVE_TOKEN,
];

// Moves requested per turn. Hardcoded for now (the engine's batch size also
// defaults to 3); every prompt asks for exactly this many moves.
export const MOVES_PER_TURN = 3;

// How many of the most recent turns to include in {history}. Capped so the
// prompt's token cost stays flat instead of growing every turn of the fight.
// If you change this, update the "last 6 turns" labels in the prompt templates.
export const HISTORY_TURNS = 6;

// Concise rulebook injected into every prompt. Kept tight on purpose — it sits
// in the system prompt every turn, so it covers the decision-critical counter
// matrix and omits per-character timing/visual edge cases (the renderer's job).
export const GAME_RULES = `ACTIONS (and what stops each):
  jump  → dodges shoot & arrows, but NOT a melee hit (knocks you out of the air) or a super (hits you anyway).
  hit   → close attack. Whiffs over a slide; loses to a shoot (bullet lands first); two melee hits clash for no damage. Usually HIGH-line (→ defend_high), but some fighters' hit is a LOW rush/arrow (→ defend_low) — read each move's "line" in the pointSystem, don't guess.
  shoot → projectile on the LOW line → stopped by defend_low (slips under defend_high). Dodged by jump and by airborne supers. Beats a slide.
  slide → low tackle on the LOW line → stopped by defend_low (sweeps under defend_high). Goes under a melee hit; loses to jump and to shoot; two slides trade.
  defend_high → blocks MELEE hit + AIRBORNE supers. Open to shoot, slide, low-line hits, grounded supers.
  defend_low  → blocks shoot, slide, low-line hits + GROUNDED supers. Open to melee hit, airborne supers.
  super_move → spend a full SUPER METER for heavy damage; stopped only by the MATCHING guard (airborne→defend_high, grounded→defend_low). A MELEE hit interrupts it (super fizzles, you take the hit) — unless it's a ranged super (see your superMove), which fires anyway; it ignores a slide.

BLOCKING: a correct block takes 0 damage and builds super meter. Blocking a MELEE/rush/slide bounces the attacker for the blocker's throwbackDmg. A blocked SUPER backfires ${BLOCKED_SUPER_DAMAGE_MULTIPLIER}× its damage onto the attacker (exception: a ranged volley just whiffs).

POINT SYSTEM (per fighter): dmg = HP a move deals · spm = SUPER METER gained on a landed attack or a successful defend · line = which guard stops the attack (high → defend_high, low → defend_low) · throwbackDmg = HP the ATTACKER loses when you correctly block their melee/rush/slide (it recoils off your guard — you take 0).

SUPER METER: fills ONLY by landing an attack or successfully defending (block / jump / slide-dodge) — taking damage gives nothing. CURRENT STATE.yourSuperMeter is your charge right now (0–${METER.MAX}); super_move needs a FULL meter (${METER.MAX}), so picking it early wastes the turn (you do nothing). Combine yourSuperMeter with each move's spm to plan how many landed hits/blocks reach full, and watch opponentSuperMeter to gauge how close THEY are to firing. Firing super_move SPENDS the entire meter, so use it AT MOST ONCE across your moves this turn. Exact numbers vary per fighter — trust each pointSystem.

TIMING: both fighters move at once.`;

// ── Character description helpers ───────────────────────────────────────────

function describeSuperEffect(charId) {
  const u = CHARACTERS[charId]?.ultimates?.[0];
  if (!u) return 'a powerful special attack';
  // Only describe flags the engine ACTUALLY honors (see characters.js header) so
  // the effect text never promises a mechanic that doesn't fire.
  const parts = [`${u.damage ?? 0} damage`];
  if (u.heals) parts.push(`heals you +${u.heals} HP`);
  if (u.selfDamage) parts.push(`costs you -${u.selfDamage} HP`);
  if (u.hits && u.hits > 1) parts.push(`hits ${u.hits}x`);
  if (u.rangedSuper) parts.push("fired from range (a charging melee hit can't interrupt it; a blocked volley just whiffs — no backfire)");
  if (u.airborne) parts.push('launches you airborne (dodges shots); blocked by defend_high');
  else parts.push('grounded; blocked by defend_low');
  return parts.join(', ');
}

/**
 * Per-action damage + super-meter gain ("spm"), mirroring the engine's
 * actionTable resolution (see damageEngine) so the model sees the REAL numbers
 * it'll play with. Untuned fighters fall back to the global BASE_DAMAGE / METER
 * defaults. `spm` = meter gained when an attack LANDS / a defence SUCCEEDS;
 * `throwbackDmg` = recoil HP this fighter's guard deals to an ATTACKER whose
 * melee hit / rush / slide it correctly blocks (ranged blocks deal 0).
 */
function buildPointSystem(charId) {
  const t = CHARACTERS[charId]?.actionTable;
  const { onHit, onDefend } = getMeterGain(charId);
  const dmgOf = (a) => t?.[a]?.dmg ?? BASE_DAMAGE[a] ?? 0;
  const landSpm = (a) => t?.[a]?.spm ?? onHit;
  // The guard line each attack travels ('high' → stopped by defend_high, 'low' →
  // defend_low). Computed from the engine so the model NEVER has to infer it from
  // the bio — that inference is what makes a reasoning model burn its budget.
  const lineOf = (a) => attackLine(a, charId);
  return {
    hit:        { dmg: dmgOf('hit'),   spm: landSpm('hit'),   line: lineOf('hit') },
    shoot:      { dmg: dmgOf('shoot'), spm: landSpm('shoot'), line: lineOf('shoot') },
    slide:      { dmg: dmgOf('slide'), spm: landSpm('slide'), line: lineOf('slide') },
    jump:       { spm: t?.jump?.spm ?? onDefend },
    slideDodge: { spm: t?.slideDodge?.spm ?? onDefend },
    defend:     { spm: t?.defend?.spm ?? onDefend, throwbackDmg: throwbackDmgFor(charId) },
  };
}

/**
 * Static fighter profile injected as {self} / {opponent}. Identical schema for
 * both sides; never leaks the internal id or ultimate key. Purely STATIC — the
 * per-turn dynamics (HP, super readiness) live in the separate {state} block,
 * so this object is identical every turn for a given character.
 */
export function buildFighterObject(charId) {
  const c = CHARACTERS[charId];
  if (!c) return { description: 'An unknown fighter.' };
  return {
    name: c.name,
    description: c.description,
    superMove: describeSuperEffect(charId),
    pointSystem: buildPointSystem(charId),
  };
}

/** Convert an engine action (possibly an internal ultimate key) to the model-facing token. */
function toModelAction(action) {
  return isUltimateKey(action) ? SUPER_MOVE_TOKEN : action;
}

/** Recent move log (last HISTORY_TURNS turns) from this fighter's perspective,
 *  as compact JSON. Turn numbers stay absolute so position is still clear. */
function buildActionHistory(history) {
  const turns = [];
  let n = 0;
  for (const batch of history) {
    batch.movesA.forEach((requested, i) => {
      n += 1;
      const outcome = batch.outcomes?.[i];
      // Log the ACTUAL executed action (post-coercion), not what was requested.
      // A super fired without a full meter is coerced to idle by the engine
      // (see damageEngine.coerceAction); reporting the requested "super_move"
      // here would teach the model that its special does nothing / is blockable
      // instead of the real lesson — the meter wasn't charged. Fall back to the
      // requested move only when a turn has no recorded outcome (e.g. a KO cut
      // the batch short before this slot ran).
      const myAction = outcome?.actionA ?? requested;
      const oppAction = outcome?.actionB ?? batch.movesB[i];
      const entry = {
        turn: n,
        me: toModelAction(myAction),
        opp: toModelAction(oppAction),
        iTook: outcome?.damageToA ?? 0,
        oppTook: outcome?.damageToB ?? 0,
      };
      // Make the wasted-super lesson explicit: the model picked a super but the
      // engine coerced it away because the meter wasn't full. Only set on the
      // turn it happened, so normal turns stay compact.
      if (isUltimateKey(requested) && !isUltimateKey(myAction)) {
        entry.note = 'super wasted — meter not full';
      }
      turns.push(entry);
    });
  }
  // Only the most recent turns reach the prompt — keeps the token cost flat as
  // the fight drags on instead of growing one entry per turn.
  return JSON.stringify(turns.slice(-HISTORY_TURNS));
}

// ── Variable substitution ───────────────────────────────────────────────────

/** Replace every {variable} in a template with its computed value. */
export function substituteVariables(template, ctx) {
  return (template || '')
    .replace(/\{game_rules\}/g, GAME_RULES)
    .replace(/\{self\}/g, ctx.self)
    .replace(/\{opponent\}/g, ctx.opponent)
    .replace(/\{state\}/g, ctx.state)
    .replace(/\{history\}/g, ctx.history)
    // Moves-per-turn is hardcoded; keep {n}/{N} resolving for any stray usage.
    .replace(/\{n\}/g, `${MOVES_PER_TURN}`)
    .replace(/\{N\}/g, `${MOVES_PER_TURN}`);
}

/**
 * Build the prompt payload for a fighter's turn.
 * Simple mode: fighter.prompt is just the user's strategy text → wrapped.
 * Advanced mode: fighter.prompt is the full template → substituted directly.
 */
export function buildFighterPrompt(fighter, opponent, fightState) {
  const { history = [], meter = 0, opponentMeter = 0 } = fightState;

  const selfCost = CHARACTERS[fighter.character]?.ultimates?.[0]?.meterCost ?? METER.MAX;
  const oppCost = CHARACTERS[opponent.character]?.ultimates?.[0]?.meterCost ?? METER.MAX;

  // Per-turn dynamics — kept separate from the static fighter profiles so {self}
  // / {opponent} never change mid-fight; only this block does.
  const state = {
    yourHp: fighter.hp,
    opponentHp: opponent.hp,
    yourSuperMeter: meter,                         // super-meter charge now (0–MAX)
    yourSuperReady: meter >= selfCost,
    opponentSuperMeter: opponentMeter,             // their charge now (0–MAX)
    opponentSuperReady: opponentMeter >= oppCost,
  };

  const ctx = {
    self: JSON.stringify(buildFighterObject(fighter.character), null, 2),
    opponent: JSON.stringify(buildFighterObject(opponent.character), null, 2),
    state: JSON.stringify(state, null, 2),
    history: buildActionHistory(history),
  };

  // Players only ever write a plain-English strategy now — always wrap it.
  const template = wrapSimpleStrategy(fighter.prompt || '');

  const system = substituteVariables(template, ctx);

  // Per-turn super-meter FACT in the USER message (the last thing the model
  // reads). It states ONLY the engine's hard mechanic — a super needs a full
  // meter or it's coerced to idle (see damageEngine.coerceAction) — and gives
  // NO tactical advice, so it never overrides the player's strategy. We must not
  // say "build meter with attacks" (that breaks an "always defend" strategy) or
  // "you may fire it" (that breaks a "never super" strategy); whether/what to
  // play is always deferred to YOUR STRATEGY.
  //
  // Sent in BOTH Simple AND Advanced (unlike the strategy echo below). Because
  // it's a pure mechanic it acts as a safety net: even a minimal Advanced
  // template that omits {state} or a super rule still can't waste a turn on an
  // uncharged super. (Confirmed product decision — do NOT gate behind !isAdvanced.)
  const superFact = state.yourSuperReady
    ? `FACT: super_move is available this turn (meter ${meter}/${METER.MAX}); firing it spends the whole meter, so it can land at most once.`
    : `FACT: super_move is NOT available this turn (meter ${meter}/${METER.MAX}, needs ${METER.MAX}) — if picked it is wasted (you do nothing that turn).`;

  // Echo the player's strategy as the LAST line so their intent outranks the
  // generic rulebook and the FACT above.
  const strategyReminder = fighter.prompt?.trim()
    ? `\nYour strategy decides your moves — follow it: ${fighter.prompt.trim()}`
    : '';

  const userMessage = `${superFact}${strategyReminder}\nRespond now with ONLY a JSON array of exactly ${MOVES_PER_TURN} moves, e.g. ["hit", "defend_high", "shoot"].`;

  return { system, messages: [{ role: 'user', content: userMessage }] };
}

// Simple-mode wrapper: the user supplies only the strategy; we build the rest.
// Kept here (not in promptTemplates) so buildFighterPrompt is self-contained.
function wrapSimpleStrategy(strategy) {
  const strat = strategy.trim() || 'Play smart: read the opponent and counter their patterns.';
  return `You are an AI fighter in a 1v1 combat game. Choose your next 3 moves.

GAME RULES:
{game_rules}

YOU (JSON):
{self}

OPPONENT (JSON):
{opponent}

CURRENT STATE (JSON): {state}

MOVE HISTORY (your last ${HISTORY_TURNS} turns): {history}

YOUR STRATEGY:
${strat}

Valid moves: hit, shoot, slide, jump, defend_high, defend_low, super_move.
SUPER RULE (mechanic, not advice): super_move only works when CURRENT STATE.yourSuperReady is true (full meter). If it is false, picking super_move is wasted (you do nothing that turn) — so when it's unavailable, pick whatever OTHER move your strategy calls for. Whether to fire it when it IS available is your strategy's call.
Your strategy decides every move. Return ONLY a JSON array of exactly 3 move strings, e.g. ["hit", "defend_high", "shoot"].`;
}

// ── Move mapping ─────────────────────────────────────────────────────────────

/** The character's primary ultimate key, or 'none' if it has no ultimate. */
export function resolveSuperMove(charId) {
  return CHARACTERS[charId]?.ultimates?.[0]?.key ?? 'none';
}

/** Map one model-emitted token to a valid engine action for this character. */
function mapModelMove(raw, charId) {
  if (typeof raw !== 'string') return 'none';
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (SUPER_SYNONYMS.has(t) || isUltimateKey(t)) return resolveSuperMove(charId);
  // Graceful aliases for the two guards: a bare 'defend' (old habit / generic
  // block) defaults to the overhead HIGH guard; accept a few spellings.
  if (t === 'defend' || t === 'block' || t === 'defend_h' || t === 'high_defend') return 'defend_high';
  if (t === 'defend_l' || t === 'low_defend' || t === 'crouch_defend') return 'defend_low';
  if (BASE_ACTIONS.includes(t)) return t;
  return 'none';
}

// ── AI call ──────────────────────────────────────────────────────────────────

/**
 * Call the managed AI proxy for a fighter. Returns string[] | 'FAIL' | null.
 * On any failure (no key, HTTP error, bad JSON) returns 'FAIL' so the engine
 * plays random moves.
 *
 * maxTokens defaults HIGH (2048) because a REASONING model (e.g. deepseek-v4-flash)
 * spends most of the budget on hidden chain-of-thought BEFORE emitting the move
 * array. Too small a budget gets cut off mid-reasoning (finish_reason "length")
 * and returns empty content — the bug this guards against. A non-reasoning model
 * just stops after the ~15-token array, so the higher cap costs it nothing.
 */
export async function callAI(fighter, { system, messages, maxTokens = 2048 }) {
  const tag = `[AI:${fighter.name}]`;

  if (MOCK_AI) return null;
  if (!fighter.prompt) return null;

  const t0 = Date.now();
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, messages, maxTokens }),
    });

    const elapsed = Date.now() - t0;
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.warn(`${tag} /api/ai HTTP ${res.status} after ${elapsed}ms — random fallback:`, err.slice(0, 200));
      return 'FAIL';
    }

    const data = await res.json();
    const text = data.text ?? '';

    const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    if (!cleaned) {
      console.error(`${tag} Empty completion after ${elapsed}ms — the model likely spent its whole maxTokens budget on reasoning before emitting moves. Raise maxTokens or use a non-reasoning provider. Random fallback.`);
      return 'FAIL';
    }
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(`${tag} JSON parse failed: ${JSON.stringify(cleaned)}`, parseErr.message);
      return 'FAIL';
    }
    if (!Array.isArray(parsed)) {
      console.error(`${tag} Expected array, got ${typeof parsed}`);
      return 'FAIL';
    }

    return parsed.map(a => mapModelMove(a, fighter.character));
  } catch (e) {
    console.error(`${tag} Unexpected error after ${Date.now() - t0}ms:`, e.message);
    return 'FAIL';
  }
}

/**
 * Random fallback for fighters with no prompt or on AI failure.
 * Prefers base actions; only offers the super_move when `meter` can actually
 * pay its cost — otherwise the random pick would be coerced to idle every turn
 * (a wasted, struck-through super). Pass the fighter's current meter so the
 * fallback mirrors the same availability gate the engine enforces.
 */
export function getFallback(n, charId, meter = 0) {
  const exclude = new Set(['none', 'idle']);
  const superCost = CHARACTERS[charId]?.ultimates?.[0]?.meterCost ?? METER.MAX;
  if (meter < superCost) {
    // Drop every ultimate key from the pool while the meter is short.
    for (const u of CHARACTERS[charId]?.ultimates ?? []) exclude.add(u.key);
  }
  const options = charId
    ? validActionsForCharacter(charId).filter(a => !exclude.has(a))
    : BASE_ACTIONS.filter(a => !exclude.has(a));
  return Array.from({ length: n }, () => options[Math.floor(Math.random() * options.length)]);
}

export function getNoneFallback(n) {
  return Array.from({ length: n }, () => 'none');
}
