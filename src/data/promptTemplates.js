// ─────────────────────────────────────────────────────────────────────────────
// promptTemplates.js — default battle prompts + per-character starter templates.
//
// Rebuilt from how it is consumed (PromptEditor, PromptEditorSimple, RoomPage,
// BotMatchPage). The {variables} below are substituted at fight time by
// engine/prompts.js: {N} {hp} {meter} {moveset} {opponent_moveset}
// {previous_actions} {game_rules}.
// ─────────────────────────────────────────────────────────────────────────────

import { CHARACTERS } from './characters.js';

// Generic fallback prompt used when no character-specific template applies.
export const DEFAULT_PROMPT = `You are an AI fighter in a turn-based battle.

{moveset}

STRATEGY:
- Read the opponent's recent moves and counter them.
- Spend meter on your Ultimate when it will land or swing the round.
- Mix up your actions so you are hard to predict.

Current state:
- Your HP: {hp}
- Your meter: {meter}
- Recent actions: {previous_actions}

Return ONLY a JSON array of exactly {N} action strings.
{game_rules}`;

// Build a per-character template by injecting its identity into DEFAULT_PROMPT.
function makeTemplate(char) {
  return `You are ${char.name}.

{moveset}

STRATEGY:
- Play to ${char.name}'s strengths.
- Spend meter on your Ultimate when it will land or swing the round.
- Read the opponent's recent moves and counter them.

Current state:
- Your HP: {hp}
- Your meter: {meter}
- Recent actions: {previous_actions}

Return ONLY a JSON array of exactly {N} action strings.
{game_rules}`;
}

// character id → starter template string.
export const CHARACTER_TEMPLATES = Object.fromEntries(
  Object.values(CHARACTERS).map(c => [c.id, makeTemplate(c)])
);

// Options list for the <select> in PromptEditor.
export const CHARACTER_OPTIONS = Object.values(CHARACTERS).map(c => ({
  id: c.id,
  name: c.name,
  archetype: c.archetype,
}));

export function getCharacterTemplate(charId) {
  return CHARACTER_TEMPLATES[charId] || null;
}
