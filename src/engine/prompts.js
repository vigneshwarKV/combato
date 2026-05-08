import { BASE_ACTIONS, validActionsForCharacter } from './damageEngine.js';
import { CHARACTERS, METER, BASE_DAMAGE } from '../data/characters.js';

const MOCK_AI = false;

// Human-readable rules block included in every LLM prompt.
export const GAME_RULES = `ACTION SYSTEM:
  idle    → stand still, 0 dmg, no meter change
  jump    → evades shoot only; ALL hit variants land on a jumper (melee hit knocks them out of the air immediately; projectile-based hits like Woman Hero's Ice Arrow still register damage and the hurt fires after the jumper has landed); still hittable by Ultimates; +${METER.GAIN_ON_JUMP_EVADE} meter on each successful evade
  hit     → ${BASE_DAMAGE.hit} dmg close-range attack; +${METER.GAIN_ON_MELEE_HIT} meter on landed hit; MISSED by slide; LANDS on jumpers (melee hit knocks down mid-air; projectile hit triggers a delayed hurt after landing); BLOCKED by defend; CLASHES with opposing hit (both whiff)
  shoot   → ${BASE_DAMAGE.shoot} dmg straight-line projectile; +${METER.GAIN_ON_RANGED_HIT} meter on landed hit; MISSED by jump or airborne Ultimates (jet-pack/flyHit ults lift the user out of the bullet's path); defend does NOT block shoot. Fast shoots HIT a sliding defender (slider thrown back); SLOW throws (Iron Turtle's spear, Monkey King's spear — long spawn delay) get RUSHED — the slider reaches the thrower before the projectile releases and the slide damage lands on the thrower instead
  slide   → ${BASE_DAMAGE.slide} dmg low tackle; evades hit (melee attackers clipped at the legs and thrown back) AND fast shoot is the one that catches the slider; deals damage to defenders/idle/melee-hit/slow-throwers; MISSED by jump and by airborne hit attackers (Woman Hero's jumpShoot); SLIDE-vs-SLIDE collides at the centre — both take ${BASE_DAMAGE.slide} dmg and are thrown back; slide CANNOT damage an opponent who is mid-Ultimate; +${METER.GAIN_ON_MELEE_HIT} meter on landed slide, +${METER.GAIN_ON_DODGE} on successful evade
  defend  → blocks hit AND Ultimates only (0 dmg); does NOT block shoot or slide (defender gets HURT through); +${METER.GAIN_ON_BLOCK} meter on successful block
  Ultimates → character-specific; cost meter; effects vary (damage, status, heal, reflect); BLOCKED by defend (unless 'unblockable'); CLASH with opposing Ultimate (both whiff, meter still spent); ALL Ultimates LAND on a sliding defender (slider takes full ult damage). Visual differs: airborne ults (jet-pack/flyHit) let the slider complete their full slide first, then the death anim fires at base; grounded ults (e.g., Woman Hero's Triple Shot) use the same shoot-vs-slide pattern (slider holds, brief slide, throwback)

SUPER METER:
  Meter fills from 0→${METER.MAX} during the fight.
  Gain meter by landing hits, sliding, jumping, or TAKING DAMAGE (+${METER.GAIN_ON_TAKING_DAMAGE} comeback bonus).
  Spend meter on Ultimates.
  If you choose an Ultimate but lack the meter cost, it falls back to 'hit' (you waste the turn).

STATUS EFFECTS:
  burn   → -5 HP/turn for 3 turns
  poison → -8 HP/turn for 5 turns
  freeze → skip your next action (1 turn)
  stun   → skip your next action (1 turn)

TIMING:
  Both fighters act simultaneously per turn. Read opponent patterns and counter.
  Damage over time (DoT) ticks at the START of each turn before actions resolve.`;

const PROVIDERS = {
  groq: {
    url: '/api/groq/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    format: 'openai',
  },
  openai: {
    url: '/api/openai/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    format: 'openai',
  },
  anthropic: {
    url: '/api/anthropic/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    format: 'anthropic',
  },
};

function describeUltimate(u) {
  const parts = [`${u.damage ?? 0} dmg`];
  if (u.statusApplied) parts.push(`applies ${u.statusApplied}`);
  if (u.heals) parts.push(`+${u.heals} HP`);
  if (u.selfDamage) parts.push(`-${u.selfDamage} HP self`);
  if (u.selfRisk) parts.push(`self-${u.selfRisk} risk`);
  if (u.hits && u.hits > 1) parts.push(`hits ${u.hits}x`);
  if (u.reflectsNext) parts.push('reflects next attack');
  if (u.blocksNext) parts.push(`blocks next ${u.blocksNext} attacks`);
  if (u.ignoresDodge) parts.push('ignores dodge');
  if (u.unblockable) parts.push('unblockable');
  if (u.gainMeter) parts.push(`+${u.gainMeter} meter`);
  if (u.critVsLowHp) parts.push('crits vs low-HP opponent');
  if (u.empowerNextMelees) parts.push(`next ${u.empowerNextMelees} melees 2x dmg`);
  return `${u.key}: ${u.name} [cost ${u.meterCost}] — ${parts.join(', ')}`;
}

function describeCharacterMoveset(charId) {
  const c = CHARACTERS[charId];
  if (!c) return '';
  const ultsText = c.ultimates.map(describeUltimate).join('\n  ');
  return `You are playing ${c.name} (${c.archetype}). ${c.description}
  Base actions: idle, jump, hit, shoot, slide
  Ultimates:
  ${ultsText}`;
}

function formatStatus(statusList) {
  if (!statusList || statusList.length === 0) return 'none';
  return statusList.map(s => `${s.type}(${s.duration}t)`).join(', ');
}

/**
 * Build the prompt payload for a fighter's turn.
 */
export function buildFighterPrompt(fighter, opponent, fightState) {
  const { n, batchNumber, history, meter = 0, opponentMeter = 0, status = [], opponentStatus = [] } = fightState;

  const lastBatches = history.slice(-3).map((batch, i) => {
    const batchNum = history.length - 3 + i + 1;
    return [
      `Batch ${batchNum}:`,
      `  Your moves:     [${batch.movesA.join(', ')}]`,
      `  Opponent moves: [${batch.movesB.join(', ')}]`,
      `  Outcomes:       ${batch.outcomes.map(o =>
        `Turn ${o.turn}: you took ${o.damageToA} HP, opponent took ${o.damageToB} HP`
      ).join(' | ')}`,
    ].join('\n');
  }).join('\n\n');

  const lastBatch = history[history.length - 1];
  const prevActions = lastBatch
    ? lastBatch.movesA.map((m, i) => ({ Me: m, Opponent: lastBatch.movesB[i] }))
    : [];
  const prevActionsStr = JSON.stringify(prevActions);

  const hpStr = JSON.stringify({ Me: fighter.hp, Opponent: opponent.hp });

  const rawPrompt = fighter.prompt || '';
  const moveset = describeCharacterMoveset(fighter.character);
  const opponentMoveset = describeCharacterMoveset(opponent.character).replace(/^You are playing /, 'Opponent is ');
  const validActions = validActionsForCharacter(fighter.character);

  const system = rawPrompt
    .replace(/\{N\}/g, n)
    .replace(/\{n\}/g, n)
    .replace(/\{previous_actions\}/g, prevActionsStr)
    .replace(/\{hp\}/g, hpStr)
    .replace(/\{meter\}/g, `${meter}/${METER.MAX}`)
    .replace(/\{moveset\}/g, moveset)
    .replace(/\{opponent_moveset\}/g, opponentMoveset)
    .replace(/\{game_rules\}/g, GAME_RULES);

  const userMessage = `FIGHT STATUS — Batch ${batchNumber}:
  Your HP:         ${fighter.hp} / 100
  Opponent HP:     ${opponent.hp} / 100
  Your meter:      ${meter} / ${METER.MAX}
  Opponent meter:  ${opponentMeter} / ${METER.MAX}
  Your status:     ${formatStatus(status)}
  Opponent status: ${formatStatus(opponentStatus)}
  Moves per turn:  ${n}

CHARACTER (you):
  ${moveset}

CHARACTER (opponent):
  ${opponentMoveset}

PREVIOUS BATCHES:
${lastBatches || '  (first batch — no history yet)'}

GAME RULES:
${GAME_RULES}

VALID ACTIONS for this character: ${validActions.filter(a => a !== 'none').join(', ')}

Return ONLY a JSON array of exactly ${n} action strings now.`;

  return { system, messages: [{ role: 'user', content: userMessage }] };
}

/**
 * Call the AI provider for a fighter. Returns string[] | 'FAIL' | null.
 */
export async function callAI(fighter, { system, messages, maxTokens = 400 }, defaults = {}) {
  const tag = `[AI:${fighter.name}]`;

  if (MOCK_AI) return null;
  if (!fighter.prompt) return null;

  const apiKey = fighter.apiKey || defaults.apiKey;
  const providerKey = (fighter.apiKey ? fighter.provider : (defaults.provider || 'groq'));
  const provider = PROVIDERS[providerKey] || PROVIDERS.groq;
  const model = fighter.model || provider.defaultModel;

  if (!apiKey) {
    console.warn(`${tag} No API key — using none fallback`);
    return 'FAIL';
  }

  const t0 = Date.now();

  try {
    let res;
    if (provider.format === 'openai') {
      res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            ...messages,
          ],
        }),
      });
    } else {
      res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages,
        }),
      });
    }

    const elapsed = Date.now() - t0;

    if (!res.ok) {
      const err = await res.text();
      console.error(`${tag} HTTP ${res.status} after ${elapsed}ms:`, err.slice(0, 300));
      return 'FAIL';
    }

    const data = await res.json();
    let text;
    if (provider.format === 'openai') {
      text = data.choices?.[0]?.message?.content ?? '';
    } else {
      text = data.content?.[0]?.text ?? '';
    }

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

    const validSet = new Set(validActionsForCharacter(fighter.character));
    const moves = parsed.map(a => (validSet.has(a) ? a : 'none'));
    return moves;
  } catch (e) {
    console.error(`${tag} Unexpected error after ${Date.now() - t0}ms:`, e.message);
    return 'FAIL';
  }
}

/**
 * Random fallback for fighters with no prompt.
 * Prefers base actions; occasionally picks an Ultimate if character has one.
 */
export function getFallback(n, charId) {
  const options = charId ? validActionsForCharacter(charId).filter(a => a !== 'none') : BASE_ACTIONS;
  return Array.from({ length: n }, () => options[Math.floor(Math.random() * options.length)]);
}

export function getNoneFallback(n) {
  return Array.from({ length: n }, () => 'none');
}

// Demo fighters — kept for organiser testing; prompt text updated for new action system.
export const DEMO_FIGHTERS = [
  {
    name: 'PunchBot',
    color: '#534AB7',
    provider: 'groq',
    model: '',
    character: 'madScientist',
    prompt: `You are an aggressive striker. Alternate hit and shoot to build meter fast, then spend on your most damaging Ultimate.
Current meter: {meter}. Your moveset: {moveset}

Return ONLY a JSON array of exactly {N} actions.`,
  },
  {
    name: 'CounterKing',
    color: '#1D9E75',
    provider: 'groq',
    model: '',
    character: 'turtle',
    prompt: `You are defensive. Open with slide to bait attacks, use Shell Spin to reflect, heal via Fortress Mode when low HP.
Current meter: {meter}. Your moveset: {moveset}

Return ONLY a JSON array of exactly {N} actions.`,
  },
  {
    name: 'MeterMiser',
    color: '#D85A30',
    provider: 'groq',
    model: '',
    character: 'womanHero',
    prompt: `You are a mage. Chip with shoot to build meter, apply poison with Venom Burst (50 meter), save Fire Storm for finishing.
Current meter: {meter}. Your moveset: {moveset}

Return ONLY a JSON array of exactly {N} actions.`,
  },
  {
    name: 'GlassWall',
    color: '#BA7517',
    provider: 'groq',
    model: '',
    character: 'beast',
    prompt: `You are a heavy tank. Absorb hits (meter comeback), then unleash Rocket Charge (100 meter). Empower with Beast Rage for combos.
Current meter: {meter}. Your moveset: {moveset}

Return ONLY a JSON array of exactly {N} actions.`,
  },
];
