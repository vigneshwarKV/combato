// ─────────────────────────────────────────────────────────────────────────────
// promptTemplates.js — prompt authoring data for the two modes.
//
//   Simple   → the player writes only a strategy; engine/prompts.js wraps it.
//   Advanced → the player writes the whole prompt using the {variables} below,
//              substituted at fight time by engine/prompts.js.
//
// Variables: {game_rules} {self_info} {opponent_info} {self_hp} {opponent_hp}
//            {self_super_move_is_available} {action_history} {n}
// ─────────────────────────────────────────────────────────────────────────────

import { CHARACTERS } from './characters.js';

// Variables a player can drop into an Advanced prompt (label + what it expands to).
export const ADVANCED_VARIABLES = [
  { token: '{game_rules}', desc: 'Full game rules (action system, meter, status)' },
  { token: '{self_info}', desc: 'Your fighter: story, archetype, super_move effect' },
  { token: '{opponent_info}', desc: "Opponent's story, archetype, super_move effect" },
  { token: '{self_hp}', desc: 'Your current HP' },
  { token: '{opponent_hp}', desc: "Opponent's current HP" },
  { token: '{self_super_move_is_available}', desc: 'true / false — is your super_move charged' },
  { token: '{action_history}', desc: 'JSON of every move so far this game' },
];

// Default Advanced template — a complete, editable prompt the player can tweak.
export const DEFAULT_ADVANCED_TEMPLATE = `You are an AI fighter in a 1v1 combat game. Choose your next {n} moves.

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

STRATEGY:
- Read the opponent's recent moves and counter them.
- Use super_move when it is available and will land or swing the round.
- Mix up your actions so you are hard to predict.

Valid moves: hit, defend, shoot, slide, jump, idle, super_move.
Return ONLY a JSON array of exactly {n} move strings, e.g. ["hit", "defend", "super_move"].`;

// Back-compat alias (older imports expect DEFAULT_PROMPT).
export const DEFAULT_PROMPT = DEFAULT_ADVANCED_TEMPLATE;

// Per-character Advanced starter. Identity is carried by {self_info}, so every
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
