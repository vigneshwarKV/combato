import { BASE_ACTIONS, validActionsForCharacter, isUltimateKey } from './damageEngine.js';
import { CHARACTERS, METER, BASE_DAMAGE, BLOCKED_SUPER_DAMAGE_MULTIPLIER } from '../data/characters.js';

const MOCK_AI = false;

// All LLM calls go through our managed serverless proxy. The model/provider is
// decided server-side by env (see api/_handler.js) — the client never picks one.
const AI_ENDPOINT = '/api/ai';

// The single move token the model uses for any character's special. Internally
// it maps to that character's primary ultimate (see resolveSuperMove).
export const SUPER_MOVE_TOKEN = 'super_move';
const SUPER_SYNONYMS = new Set(['super_move', 'supermove', 'super move', 'super', 'ultimate']);

// Human-readable rules block included in every LLM prompt.
export const GAME_RULES = `ACTION SYSTEM:
  idle    → stand still, 0 dmg, no meter change
  jump    → evades shoot AND projectile-based hits (Woman Hero's Ice Arrow — straight-line shot); MELEE hit lands on a jumper (knocks them out of the air immediately); still hittable by Ultimates; +${METER.GAIN_ON_DEFEND} meter on each successful evade
  hit     → ${BASE_DAMAGE.hit} dmg close-range attack; +${METER.GAIN_ON_HIT} meter on landed hit; MISSED by slide; melee hit LANDS on jumpers (knocks down mid-air); a REGULAR melee hit is HIGH — BLOCKED by defend_high (defend_low gets hit). RUSH-style (Skater Kid's skateboard run) and PROJECTILE-style (Woman Hero's IceShoot) hits are LOW — BLOCKED by defend_low (defend_high gets hit); CLASHES with opposing hit when BOTH are melee (no HP loss — fighters visually collide mid-lunge and fall back with death anim); MELEE hitter rushing into a FAST shoot gets STOPPED — bullet catches them mid-lunge and throws them back (rush-style hits get the same slide-vs-shoot throwback timing). Against a SLOW thrower (Iron Turtle's spear, Monkey King's spear) the lunge LANDS — hitter reaches the thrower before the projectile spawns. PROJECTILE-style hits (Woman Hero's IceShoot — she jumpShoots an ice arrow): MISS jumpers (straight-line shot, jumper evades); arrow always aims at the opponent's IDLE position regardless of their movement; vs SLIDE the arrow LANDS — slider dodges momentarily but the arrow catches them once they finish the glide and return to base (deferred hurt). WH's hit MISSES if the opponent is also hitting (their melee lunge interrupts her arrow release while their hit lands on her); WH vs Skater Kid hit → both miss (both end up airborne)
  shoot   → ${BASE_DAMAGE.shoot} dmg straight-line projectile; +${METER.GAIN_ON_HIT} meter on landed hit; MISSED by jump, airborne Ultimates (jet-pack/flyHit ults), OR a projectile-hit attacker (Woman Hero's IceShoot — her jumpShoot lifts her out of the bullet's path); shoot is LOW — BLOCKED by defend_low (low guard catches the bullet on the shield), but defend_high does NOT block it (bullet goes under). Fast shoots HIT a sliding defender (slider thrown back); SLOW throws (Iron Turtle's spear, Monkey King's spear — long spawn delay) get RUSHED — the slider reaches the thrower before the projectile releases and the slide damage lands on the thrower instead
  slide   → ${BASE_DAMAGE.slide} dmg low tackle; evades hit (melee attackers clipped at the legs and thrown back) AND fast shoot is the one that catches the slider; slide is LOW — BLOCKED by defend_low (low guard catches the tackle), but defend_high gets swept (takes full slide dmg); deals damage to idle/melee-hit/slow-throwers; MISSED by jump and by airborne hit attackers (Woman Hero's jumpShoot); SLIDE-vs-SLIDE collides at the centre — both take ${BASE_DAMAGE.slide} dmg and are thrown back; slide CANNOT damage an opponent who is mid-Ultimate; +${METER.GAIN_ON_HIT} meter on landed slide, +${METER.GAIN_ON_DEFEND} on successful evade
  defend_high → HIGH guard, braces overhead (0 dmg when it blocks); BLOCKS regular melee hit AND AIRBORNE supers (jet-pack / flyHit / sky-dive ults). Does NOT block shoot, slide, rush-style hit (Skater Kid), projectile hit (Woman Hero), or grounded supers — those go UNDER it and HURT you. +${METER.GAIN_ON_DEFEND} meter on a successful block
  defend_low  → LOW guard, drops the shield to the body/legs (0 dmg when it blocks); BLOCKS shoot, slide, rush-style hit (Skater Kid), projectile hit (Woman Hero), AND grounded supers. Does NOT block a regular melee hit or an AIRBORNE super — those come over the top and HURT you. +${METER.GAIN_ON_DEFEND} meter on a successful block
  super_move → your character-specific special (cost meter); deals heavy damage (some also heal you); BLOCKED by the MATCHING guard — an AIRBORNE super is stopped by defend_high, a GROUNDED super by defend_low (wrong guard = full damage; there are no unblockable supers anymore). CLASH only when BOTH supers occupy the same lane — both airborne (collide mid-flight, fall with death anim, no HP loss) OR both grounded (silent clash, no HP loss, meter still spent). MIXED airborne-vs-grounded does NOT clash. ALL supers LAND on a sliding defender (slider takes full damage). MELEE hit INTERRUPTS a super — hitter's lunge clips the super-er mid-windup, they take the hit damage and the super never connects. BACKFIRE: if your super is BLOCKED by the matching guard (airborne→defend_high, grounded→defend_low), it rebounds and YOU take ${BLOCKED_SUPER_DAMAGE_MULTIPLIER}× the super's damage as HP loss — never throw a super into a guard you can be read on.

SUPER METER:
  Meter fills from 0→${METER.MAX} on two events only: LANDING an attack (hit/shoot/slide that connects → +${METER.GAIN_ON_HIT}) and SUCCESSFULLY DEFENDING an incoming attack — a shield block, a jump or slide evade, even a defended super (→ +${METER.GAIN_ON_DEFEND}). Taking damage no longer builds meter. (Exact rates vary per character.)
  You can only use super_move when it is available (meter fully charged). If you pick super_move while it is unavailable, the turn is WASTED on 'idle' (you do nothing — no attack, no defense).

TIMING:
  Both fighters act simultaneously per turn. Read opponent patterns and counter.

NOTE: In your move output, your character-specific Ultimate is ALWAYS written as the single token "super_move" — never a fancy name.`;

// ── Character description helpers ───────────────────────────────────────────

function describeSuperEffect(charId) {
  const u = CHARACTERS[charId]?.ultimates?.[0];
  if (!u) return 'a powerful special attack';
  const parts = [`${u.damage ?? 0} damage`];
  if (u.heals) parts.push(`heals you +${u.heals} HP`);
  if (u.selfDamage) parts.push(`costs you -${u.selfDamage} HP`);
  if (u.hits && u.hits > 1) parts.push(`hits ${u.hits}x`);
  if (u.heals === undefined && u.blocksNext) parts.push(`blocks your next ${u.blocksNext} attacks`);
  if (u.reflectsNext) parts.push('reflects the next attack');
  if (u.unblockable) parts.push('cannot be blocked');
  if (u.airborne) parts.push('launches you airborne (dodges shots)');
  return parts.join(', ');
}

/** Identity + story + super_move effect for a fighter. Never leaks the internal key/name. */
export function describeFighterInfo(charId) {
  const c = CHARACTERS[charId];
  if (!c) return 'An unknown fighter.';
  return `${c.name} — ${c.archetype}. ${c.description}
  super_move: ${describeSuperEffect(charId)}.`;
}

/** Convert an engine action (possibly an internal ultimate key) to the model-facing token. */
function toModelAction(action) {
  return isUltimateKey(action) ? SUPER_MOVE_TOKEN : action;
}

/** Whole-game move log from this fighter's perspective, as compact JSON. */
function buildActionHistory(history) {
  const turns = [];
  let n = 0;
  for (const batch of history) {
    batch.movesA.forEach((me, i) => {
      n += 1;
      const outcome = batch.outcomes?.[i];
      turns.push({
        turn: n,
        me: toModelAction(me),
        opp: toModelAction(batch.movesB[i]),
        iTook: outcome?.damageToA ?? 0,
        oppTook: outcome?.damageToB ?? 0,
      });
    });
  }
  return JSON.stringify(turns);
}

// ── Variable substitution ───────────────────────────────────────────────────

/** Replace every {variable} in a template with its computed value. */
export function substituteVariables(template, ctx) {
  return (template || '')
    .replace(/\{game_rules\}/g, GAME_RULES)
    .replace(/\{self_info\}/g, ctx.selfInfo)
    .replace(/\{opponent_info\}/g, ctx.opponentInfo)
    .replace(/\{self_hp\}/g, ctx.selfHp)
    .replace(/\{opponent_hp\}/g, ctx.opponentHp)
    .replace(/\{self_super_move_is_available\}/g, ctx.superAvailable)
    .replace(/\{action_history\}/g, ctx.actionHistory)
    .replace(/\{n\}/g, ctx.n)
    .replace(/\{N\}/g, ctx.n);
}

/**
 * Build the prompt payload for a fighter's turn.
 * Simple mode: fighter.prompt is just the user's strategy text → wrapped.
 * Advanced mode: fighter.prompt is the full template → substituted directly.
 */
export function buildFighterPrompt(fighter, opponent, fightState) {
  const { n, history = [], meter = 0 } = fightState;

  const superCost = CHARACTERS[fighter.character]?.ultimates?.[0]?.meterCost ?? METER.MAX;

  const ctx = {
    selfInfo: describeFighterInfo(fighter.character),
    opponentInfo: describeFighterInfo(opponent.character),
    selfHp: `${fighter.hp}`,
    opponentHp: `${opponent.hp}`,
    superAvailable: meter >= superCost ? 'true' : 'false',
    actionHistory: buildActionHistory(history),
    n: `${n}`,
  };

  const isAdvanced = fighter.promptMode === 'advanced';
  const template = isAdvanced
    ? (fighter.prompt || '')
    : wrapSimpleStrategy(fighter.prompt || '');

  const system = substituteVariables(template, ctx);
  const userMessage = `Respond now with ONLY a JSON array of exactly ${n} moves, e.g. ["hit", "defend_high", "super_move"].`;

  return { system, messages: [{ role: 'user', content: userMessage }] };
}

// Simple-mode wrapper: the user supplies only the strategy; we build the rest.
// Kept here (not in promptTemplates) so buildFighterPrompt is self-contained.
function wrapSimpleStrategy(strategy) {
  const strat = strategy.trim() || 'Play smart: read the opponent and counter their patterns.';
  return `You are an AI fighter in a 1v1 combat game. Choose your next {n} moves.

GAME RULES:
{game_rules}

YOU:
{self_info}

OPPONENT:
{opponent_info}

CURRENT STATE:
- Your HP: {self_hp}
- Opponent HP: {opponent_hp}
- Your super_move available: {self_super_move_is_available}

ACTION HISTORY (entire game so far): {action_history}

YOUR STRATEGY:
${strat}

Valid moves: hit, shoot, slide, jump, idle, defend_high, defend_low, super_move.
Return ONLY a JSON array of exactly {n} move strings, e.g. ["hit", "defend_high", "super_move"].`;
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
 */
export async function callAI(fighter, { system, messages, maxTokens = 400 }) {
  const tag = `[AI:${fighter.name}]`;

  if (MOCK_AI) return null;
  if (!fighter.prompt && fighter.promptMode !== 'advanced') return null;

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
