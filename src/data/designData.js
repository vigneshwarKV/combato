// ─────────────────────────────────────────────────────────────────────────────
// designData.js — UI/design-facing data for the character-select & home screens.
//
// Rebuilt from how it is consumed (CharSelectPage, DesignKit, HomePage,
// RoomPage, BotMatchPage, mobile/*). Engine combat data lives in characters.js;
// this file holds the player-facing presentation layer + the saved profile.
// ─────────────────────────────────────────────────────────────────────────────

import { CHARACTERS, BASE_DAMAGE, METER, throwbackDmgFor } from './characters.js';

// Players build up to this many named strategies and switch between them live
// during a fight (see the arena strategy switcher). The currently-selected
// strategy drives the AI's next batch of moves.
export const MAX_STRATEGIES = 3;

// Archetype presentation. `class` drives the accent colour in DesignKit
// (atk→red, def→cyan, mage→plasma, range→green, else→gold).
export const ARCHETYPES = {
  striker: { label: 'STRIKER', class: 'atk' },
  tank:    { label: 'TANK',    class: 'def' },
  mage:    { label: 'MAGE',    class: 'mage' },
  ranger:  { label: 'RANGER',  class: 'range' },
  acrobat: { label: 'ACROBAT', class: 'spd' },
};

// Ordered move template (key + display name) for the MovesPanel. Per-character
// damage + super-meter gain are attached per fighter by buildMoves() below, so
// the panel can show two numbers per move (DMG dealt / +SPM meter gained).
export const BASE_MOVES = [
  { key: 'hit',         name: 'Hit' },
  { key: 'shoot',       name: 'Shoot' },
  { key: 'slide',       name: 'Slide' },
  { key: 'super_move',  name: 'Super Move' },
  { key: 'jump',        name: 'Jump' },
  { key: 'defend_low',  name: 'Defend Low' },
  { key: 'defend_high', name: 'Defend High' },
];

// Attach per-character combat numbers to each move:
//   hit/shoot/slide → dmg dealt + spm gained on landing (from actionTable)
//   super_move      → total ult damage + spm of -100 (it SPENDS the full meter)
//   jump/defend     → dmg 0 + spm gained on a successful evade / guard
// Falls back to the global BASE_DAMAGE / METER defaults for untuned fighters.
function buildMoves(c) {
  const t = c.actionTable || {};
  const ult = c.ultimates?.[0];
  const superDmg = ult ? (ult.damage ?? 0) * (ult.hits ?? 1) : 0;
  return BASE_MOVES.map(m => {
    switch (m.key) {
      case 'hit':
      case 'shoot':
      case 'slide':
        return { ...m, dmg: t[m.key]?.dmg ?? BASE_DAMAGE[m.key] ?? 0, spm: t[m.key]?.spm ?? METER.GAIN_ON_HIT };
      case 'super_move':
        return { ...m, dmg: superDmg, spm: -100, super: true };
      case 'jump':
        return { ...m, dmg: 0, spm: t.jump?.spm ?? METER.GAIN_ON_DEFEND, evade: true };
      default: // defend_low / defend_high
        return { ...m, dmg: 0, throwbackDmg: throwbackDmgFor(c.id), spm: t.defend?.spm ?? METER.GAIN_ON_DEFEND, evade: true, guard: true };
    }
  });
}

// First-visit strategy suggestions. When a player opens the strategy editor for
// the first time (no saved strategy yet), CharSelectPage prefills the textarea
// with one of these at random so the field is never blank. They live only in the
// in-memory draft — nothing is persisted unless the player hits Save.
export const SAMPLE_SIMPLE_STRATEGIES = [
  'Always try to defend first and hit hard when hp reduces.',
  'Open aggressive — rush with hits and slides, then guard once you are ahead.',
  'Bait their jumps and punish with shoots. Save your super_move for when they are low.',
  'Play patient: read their pattern with high and low guards, then unleash super_move when charged.',
  'Mirror the opponent — block what they throw, then counter with your strongest move.',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** A random plain-English strategy suggestion for the strategy editor. */
export function randomSimpleStrategy() { return pickRandom(SAMPLE_SIMPLE_STRATEGIES); }

// Short default names for the strategy slots (used as the fallback label on the
// arena switch buttons when the player leaves a slot unnamed).
const DEFAULT_STRATEGY_NAMES = ['Attack', 'Defend', 'Adapt'];

// Starter text for each slot, so all three plans are playable out of the box. A
// named-but-empty plan is not a plan: usableStrategies() filters it out, so it
// never reaches the fight and never shows up on the arena switcher. Each line
// leans into its slot's name and stays in the same plain-English voice as the
// SAMPLE_SIMPLE_STRATEGIES above.
const DEFAULT_STRATEGY_TEXTS = [
  'Come out swinging — chain hits and slides, stay in their face, and spend super_move the moment the meter fills.',
  'Hold the line — guard high and low to read their pattern, punish a whiffed swing with a slide, and only swing while they recover.',
  'Read them and answer — block what they commit to, shoot when they hang back, and save super_move for when their hp is low.',
];

/** Build a fresh strategy slot for the given index (0-based). */
export function makeStrategy(index = 0, text = DEFAULT_STRATEGY_TEXTS[index] ?? '') {
  return { name: DEFAULT_STRATEGY_NAMES[index] || `Strategy ${index + 1}`, text };
}

/** The plan slots every profile carries: Attack / Defend / Adapt, all filled. */
export function defaultStrategies() {
  return Array.from({ length: MAX_STRATEGIES }, (_, i) => makeStrategy(i));
}

/** Display label for a strategy slot, falling back to "Strategy N" when unnamed. */
export function strategyLabel(strategy, index = 0) {
  const name = (strategy?.name || '').trim();
  return name || `Strategy ${index + 1}`;
}

/**
 * Only strategies with text count as usable (mirrors isProfileReady). Any
 * non-empty text qualifies: a minimum length here silently dropped short plans
 * from the arena switcher and the fight prompt, with nothing in setup saying
 * so. Emptiness is now caught where it's written instead — setup won't save a
 * blank plan (see CharSelectPage.emptyPlanIdx).
 */
export function usableStrategies(strategies) {
  return (Array.isArray(strategies) ? strategies : [])
    .filter(s => typeof s?.text === 'string' && s.text.trim().length > 0);
}

// Simple deterministic per-character design stats (1–5 scale) derived from the
// engine stats, plus a tagline + rank for the detail card.
const RANKS = ['S', 'A', 'A', 'B', 'B', 'C'];
function rankFor(i) { return RANKS[i % RANKS.length]; }

const TAGLINES = {
  // Playable fighters — strength + the catch, in plain words.
  beast:       'Hits hardest, but slow. Win up close.',
  spaceGirl:   'Deadly from afar, weak up close.',
  madScientist:'Special move ready fastest — but fragile.',
  skater:      'Skateboard rush beats a high block. Fragile.',
  monkey:      'Hard-hitting spear, but slow to throw.',
  turtle:      'Tough defender — blocking wins him the fight.',
  womanHero:   'Spams a fast, cheap special. Low damage.',
  // Locked fighters.
  soldierBoy:  'Balanced all-rounder. No tricks, just smart play.',
  speedKid:    'Fast and dodgy, but fragile.',
  gunBoy:      'Aggressive shooter. Steady pressure.',
  cartoonBoy:  'All attack, little defense.',
  stormGirl:   'Balanced mid-range fighter.',
  ironKnight:  'Tough and slow. Blocks and grinds.',
};

// Static idle-frame thumbnail for PNG characters. CharTile only renders the
// animated sprite when `thumb` is truthy; spine characters use a live renderer
// and don't need one.
function thumbFor(c) {
  if (c.renderMode !== 'png') return null;
  const dirName = c.assetBase.split('/').pop();
  const prefix = dirName === 'main-character-for-2d-platformer' ? 'Player_' : '';
  return `${c.assetBase}/frames/Idle/${prefix}Idle_000.png`;
}

// Temporary playable roster — only these fighters are unlocked for now;
// every other character renders as locked in the loadout picker.
export const UNLOCKED_IDS = new Set([
  'beast', 'madScientist', 'womanHero', 'monkey', 'turtle', 'spaceGirl', 'skater',
]);

// Build the design roster from the engine roster so the two never drift.
// Unlocked fighters are sorted to the front so the picker leads with what's
// playable; locked ones follow. Sort is stable so engine order is preserved
// within each group.
export const CHARS = Object.values(CHARACTERS)
  .map((c, i) => {
    const ult = c.ultimates?.[0];
    // 0–100 player-facing bars come straight from the engine character (single
    // source of truth — `def` also drives block throwbackDmg in damageEngine).
    // Locked fighters have no `ratings`, so derive a rough fallback from their
    // 1–5 engine stats so the bars still render something.
    const stats = c.ratings ?? {
      atk: (c.stats?.attack ?? 3) * 20,
      def: (c.stats?.defense ?? 3) * 20,
      spm: 50,
    };
    return {
      id: c.id,
      name: c.name,
      archetype: c.archetype,
      locked: !UNLOCKED_IDS.has(c.id),   // temporarily lock all but the playable few
      rank: rankFor(i),
      tagline: TAGLINES[c.id] || c.description || '',
      description: c.description || TAGLINES[c.id] || '',
      thumb: thumbFor(c),
      stats,                       // { atk, def, spm } on a 0–100 scale
      moves: buildMoves(c),        // [{ key, name, dmg, spm, super?, evade? }]
      ult: ult ? { name: ult.name, dmg: (ult.damage ?? 0) * (ult.hits ?? 1) } : null,
    };
  })
  .sort((a, b) => Number(a.locked) - Number(b.locked));

export function charById(id) {
  return CHARS.find(c => c.id === id) || null;
}

// ── Saved player profile (localStorage) ─────────────────────────────────────
const PROFILE_KEY = 'pk.profile';

function defaultProfile() {
  return {
    // Empty on purpose — a pre-filled "Player" got shipped as everyone's name
    // because users skipped the field. Blank forces a real name in setup (the
    // input shows its placeholder, and CharSelect blocks Save until it's set).
    handle: '',
    rank: 'C',
    wins: 0,
    charId: null,
    // All three named plain-English plans up front (Attack / Defend / Adapt) —
    // a lone empty slot read as "one plan is all you get" and players never
    // found the add button. The player switches between them live during a
    // fight; each slot is { name, text }. They can delete down to one and add
    // back up to MAX_STRATEGIES from setup, so this is a starting point only.
    strategies: defaultStrategies(),
    activeStrategyIndex: 0,
  };
}

// Fold a legacy profile (single strategySimple/strategyAdvanced + strategyMode)
// into the new `strategies` array so returning players don't lose their prompt.
//
// A saved playbook is taken as-is (capped at MAX_STRATEGIES): the player owns how
// many plans they keep — deleting a plan in setup has to survive a reload, so this
// deliberately does NOT pad short playbooks back up to three.
function migrateStrategies(profile) {
  const legacyText = profile.strategySimple || profile.strategyAdvanced || '';
  const legacy = typeof legacyText === 'string' ? legacyText.trim() : '';
  // `strategies` arrives exactly as it was stored (loadProfile passes it through
  // raw rather than letting defaultProfile()'s slots stand in), so an absent or
  // empty array really does mean a pre-`strategies` profile — the one case where
  // the prompt has to be recovered from strategySimple.
  const saved = (Array.isArray(profile.strategies) ? profile.strategies : [])
    .slice(0, MAX_STRATEGIES)
    .map((s, i) => ({
      name: typeof s?.name === 'string' && s.name.trim() ? s.name : makeStrategy(i).name,
      text: typeof s?.text === 'string' ? s.text : '',
    }));
  // Nothing usable stored — either a pre-`strategies` profile or a playbook whose
  // slots are all blank (which usableStrategies() would reject wholesale). Start
  // from the three defaults so the player is never left without a plan.
  if (!saved.some(s => s.text.trim())) {
    const fresh = defaultStrategies();
    profile.strategies = legacy ? [{ ...fresh[0], text: legacy }, ...fresh.slice(1)] : fresh;
  } else {
    profile.strategies = saved;
  }
  if (typeof profile.activeStrategyIndex !== 'number'
      || profile.activeStrategyIndex < 0
      || profile.activeStrategyIndex >= profile.strategies.length) {
    profile.activeStrategyIndex = 0;
  }
  delete profile.strategyMode;
  delete profile.strategySimple;
  delete profile.strategyAdvanced;
  return profile;
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return defaultProfile();
    const stored = JSON.parse(raw);
    // `strategies` is handed over as-stored (undefined included) instead of
    // defaultProfile()'s three slots — migrateStrategies has to be able to tell
    // "nothing was saved" from "three defaults were saved".
    const profile = migrateStrategies({ ...defaultProfile(), ...stored, strategies: stored.strategies });
    // A profile saved on another machine may reference a character id that no
    // longer exists in the roster, or one that's since been locked. Drop it so
    // the UI prompts a fresh pick instead of rendering a missing/locked fighter.
    if (profile.charId && (!CHARACTERS[profile.charId] || !UNLOCKED_IDS.has(profile.charId))) {
      profile.charId = null;
    }
    return profile;
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore quota/availability errors */
  }
}

export function isProfileReady(profile) {
  if (!profile || !profile.charId) return false;
  // Ready once at least one strategy slot has real text.
  return usableStrategies(profile.strategies).length > 0;
}

// ── Public tournament listings (dummy placeholder data) ──────────────────────
export const PUBLIC_TOURNAMENTS = [
  { id: 'rumble', name: 'Midnight Rumble',   mode: 'Single Elim', rank: 'Open', players: 6,  max: 8,  live: true },
  { id: 'gauntlet', name: 'Neon Gauntlet',   mode: 'Double Elim', rank: 'A+',   players: 12, max: 16, live: true },
  { id: 'proving', name: 'Proving Grounds',  mode: 'Round Robin', rank: 'Open', players: 3,  max: 8,  live: false },
  { id: 'clash', name: 'Weekend Clash',      mode: 'Single Elim', rank: 'B',    players: 2,  max: 4,  live: false },
];
