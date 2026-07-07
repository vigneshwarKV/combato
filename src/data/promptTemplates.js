// ─────────────────────────────────────────────────────────────────────────────
// promptTemplates.js — prompt authoring data.
//
// The player only ever writes plain-English strategies; engine/prompts.js wraps
// each one with the rules, fighter info and live state automatically at fight
// time. (The old "advanced" full-prompt mode has been removed.)
// ─────────────────────────────────────────────────────────────────────────────

import { CHARACTERS } from './characters.js';

// Default strategy text (shown as a starting point / placeholder).
export const DEFAULT_SIMPLE_STRATEGY = `Spam ranged attacks to build meter, then use super_move when it's available. Defend when the opponent is aggressive and read their patterns to counter.`;

// Options list for character pickers.
export const CHARACTER_OPTIONS = Object.values(CHARACTERS).map(c => ({
  id: c.id,
  name: c.name,
  archetype: c.archetype,
}));
