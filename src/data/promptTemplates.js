// ─────────────────────────────────────────────────────────────────────────────
// promptTemplates.js — prompt authoring data for the two modes.
//
//   Simple   → the player writes only a strategy; engine/prompts.js wraps it.
//   Advanced → the player writes the whole prompt using the {variables} below,
//              substituted at fight time by engine/prompts.js.
//
// Variables: {game_rules} {self} {opponent} {state} {history}
//            (moves-per-turn is hardcoded at 3 — no {n} to fill in)
// ─────────────────────────────────────────────────────────────────────────────

import { CHARACTERS } from './characters.js';
import { GAME_RULES } from '../engine/prompts.js';

// Variables a player can drop into an Advanced prompt. Each entry powers the
// VariableGuide UI: `use` = why you'd reference it, `inside` = a preview of the
// data it becomes at fight time. Keep the tokens in sync with substituteVariables().
export const ADVANCED_VARIABLES = [
  {
    token: '{game_rules}',
    use: 'The full rulebook — every action, what beats what, and the point/meter system.',
    inside: GAME_RULES,   // the exact rules text injected into the prompt
  },
  {
    token: '{self}',
    use: "Your fighter's fixed profile — who you are and the numbers behind every move.",
    inside: `{
  "name": "Iron Turtle",
  "archetype": "tank",
  "description": "…short bio…",
  "superMove": "22 damage, launches you airborne;
                blocked by defend_high",
  "pointSystem": {
    "hit":   { "dmg": 12, "spm": 7 },
    "shoot": { "dmg": 24, "spm": 9 },
    "slide": { "dmg": 6,  "spm": 6 },
    "jump":       { "spm": 16 },
    "slideDodge": { "spm": 14 },
    "defend": { "spm": 16, "throwbackDmg": 8 }
  }
}

dmg = HP a move deals · spm = super-meter gained
throwbackDmg = recoil your guard deals to an
attacker you block`,
  },
  {
    token: '{opponent}',
    use: "The opponent's profile — same shape as {self}. Read it to pick moves that beat THEM.",
    inside: `Identical structure to {self}.

Watch opponent.pointSystem.defend.throwbackDmg —
that's the recoil YOU take if you throw a
melee/slide into their guard.`,
  },
  {
    token: '{state}',
    use: 'The live, per-turn snapshot — HP totals and whether each super is charged.',
    inside: `{
  "yourHp": 64,
  "opponentHp": 30,
  "yourSuperReady": true,
  "opponentSuperReady": false
}

The only block that changes every turn.`,
  },
  {
    token: '{history}',
    use: 'Every past turn from your point of view — spot patterns and counter.',
    inside: `[
  { "turn": 1, "me": "hit", "opp": "defend_high",
    "iTook": 0, "oppTook": 0 },
  …one entry per turn played so far…
]

me/opp = moves played · iTook/oppTook = HP lost`,
  },
];

// Default Advanced template — a complete, editable prompt the player can tweak.
export const DEFAULT_ADVANCED_TEMPLATE = `You are an AI fighter in a 1v1 combat game. Choose your next 3 moves.

GAME RULES:
{game_rules}

YOU (JSON):
{self}

OPPONENT (JSON):
{opponent}

CURRENT STATE (JSON): {state}

MOVE HISTORY (entire game so far, from your perspective): {history}

STRATEGY:
- Read the opponent's recent moves and counter them.
- Each fighter's pointSystem shows the dmg and meter (spm) of every move, plus defend.throwbackDmg — recoil your guard deals to an attacker who hits it with a melee/slide (and what you'd eat attacking into theirs, so don't feed a tank's block). Pick moves that score against THIS opponent.
- Watch CURRENT STATE: fire super_move when yourSuperReady is true and it will land or swing the round; respect opponentSuperReady.
- Mix up your actions so you are hard to predict.

Valid moves: hit, shoot, slide, jump, idle, defend_high, defend_low, super_move.
Return ONLY a JSON array of exactly 3 move strings, e.g. ["hit", "defend_high", "super_move"].`;

// Back-compat alias (older imports expect DEFAULT_PROMPT).
export const DEFAULT_PROMPT = DEFAULT_ADVANCED_TEMPLATE;

// Per-character Advanced starter. Identity is carried by {self}, so every
// character shares the same starter template.
export const CHARACTER_TEMPLATES = Object.fromEntries(
  Object.values(CHARACTERS).map(c => [c.id, DEFAULT_ADVANCED_TEMPLATE])
);

// Options list for character pickers.
export const CHARACTER_OPTIONS = Object.values(CHARACTERS).map(c => ({
  id: c.id,
  name: c.name,
  archetype: c.archetype,
}));

export function getCharacterTemplate(charId) {
  return CHARACTER_TEMPLATES[charId] || DEFAULT_ADVANCED_TEMPLATE;
}

// Default Simple-mode strategy text (shown as a starting point / placeholder).
export const DEFAULT_SIMPLE_STRATEGY = `Spam ranged attacks to build meter, then use super_move when it's available. Defend when the opponent is aggressive and read their patterns to counter.`;
