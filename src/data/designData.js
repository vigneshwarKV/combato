// ─────────────────────────────────────────────────────────────────────────────
// designData.js — UI/design-facing data for the character-select & home screens.
//
// Rebuilt from how it is consumed (CharSelectPage, DesignKit, HomePage,
// RoomPage, BotMatchPage, mobile/*). Engine combat data lives in characters.js;
// this file holds the player-facing presentation layer + the saved profile.
// ─────────────────────────────────────────────────────────────────────────────

import { CHARACTERS } from './characters.js';

// Archetype presentation. `class` drives the accent colour in DesignKit
// (atk→red, def→cyan, mage→plasma, range→green, else→gold).
export const ARCHETYPES = {
  striker: { label: 'STRIKER', class: 'atk' },
  tank:    { label: 'TANK',    class: 'def' },
  mage:    { label: 'MAGE',    class: 'mage' },
  ranger:  { label: 'RANGER',  class: 'range' },
  acrobat: { label: 'ACROBAT', class: 'spd' },
};

// The six base moves, shown in the MovesPanel on the fighter detail card.
export const BASE_MOVES = [
  { key: 'idle',   name: 'Idle',   dmg: 0 },
  { key: 'jump',   name: 'Jump',   dmg: 0 },
  { key: 'hit',    name: 'Hit',    dmg: 10 },
  { key: 'shoot',  name: 'Shoot',  dmg: 12 },
  { key: 'slide',  name: 'Slide',  dmg: 6 },
  { key: 'defend', name: 'Defend', dmg: 0 },
];

// Runtime variables a player can drop into an advanced strategy prompt.
export const STRAT_VARS = [
  { v: '{hp}',               desc: 'Your current HP' },
  { v: '{meter}',            desc: 'Your current super meter' },
  { v: '{previous_actions}', desc: "Your last batch of actions" },
  { v: '{moveset}',          desc: 'Your full move set' },
  { v: '{opponent_moveset}', desc: "The opponent's move set" },
  { v: '{N}',                desc: 'Number of moves to return this turn' },
];

// Simple deterministic per-character design stats (1–5 scale) derived from the
// engine stats, plus a tagline + rank for the detail card.
const RANKS = ['S', 'A', 'A', 'B', 'B', 'C'];
function rankFor(i) { return RANKS[i % RANKS.length]; }

const TAGLINES = {
  captainVex:  'Disciplined frontline soldier. Closes fast, punishes hesitation.',
  beast:       'Hulking brawler. Rockets in and crashes down.',
  pixelDash:   'Glitchy speedster. Gone before you react.',
  boyPlat:     'Hot-headed gunner. Sets the ring alight.',
  toonStriker: 'Cartoon scrapper. Hits harder than physics allow.',
  novaQuinn:   'Cosmic markswoman. Rains starlight from range.',
  veraStorm:   'Tempest channeler. Freezes opponents mid-combo.',
  jaxSteele:   'Armored heavy. Soaks punishment, answers in steel.',
  madScientist: 'Mad scientist. Overloads the arena with lightning.',
  skater:      'Reckless skater. Board run smashes through guards.',
  monkey:      'Trickster. Spears from range, somersaults skyward.',
  turtle:      'Armored bruiser. Heavy spear, defensive cyclone.',
  womanHero:   'Archer. Ice arrows pierce guards, venom volley finishes.',
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

// Build the design roster from the engine roster so the two never drift.
export const CHARS = Object.values(CHARACTERS).map((c, i) => {
  const atk = c.stats?.attack ?? 3;
  const def = c.stats?.defense ?? 3;
  const spd = Math.max(1, Math.min(5, 6 - Math.round((atk + def) / 2)));
  const ult = c.ultimates?.[0];
  return {
    id: c.id,
    name: c.name,
    archetype: c.archetype,
    locked: false,                 // all characters unlocked for now
    rank: rankFor(i),
    tagline: TAGLINES[c.id] || c.description || '',
    thumb: thumbFor(c),
    stats: { atk, def, spd },
    ult: ult ? { name: ult.name, dmg: (ult.damage ?? 0) * (ult.hits ?? 1) } : null,
  };
});

export function charById(id) {
  return CHARS.find(c => c.id === id) || null;
}

// ── Saved player profile (localStorage) ─────────────────────────────────────
const PROFILE_KEY = 'pk.profile';

function defaultProfile() {
  return {
    handle: 'Player',
    rank: 'C',
    wins: 0,
    charId: null,
    strategyMode: 'simple',   // 'simple' | 'advanced'
    strategySimple: '',
    strategyAdvanced: '',
  };
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return defaultProfile();
    const profile = { ...defaultProfile(), ...JSON.parse(raw) };
    // A profile saved on another machine may reference a character id that no
    // longer exists in the roster. Drop it so the UI prompts a fresh pick
    // instead of trying to render a missing fighter.
    if (profile.charId && !CHARACTERS[profile.charId]) profile.charId = null;
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
  const strategy = profile.strategyMode === 'advanced'
    ? profile.strategyAdvanced
    : profile.strategySimple;
  return typeof strategy === 'string' && strategy.trim().length > 8;
}

// ── Public tournament listings (dummy placeholder data) ──────────────────────
export const PUBLIC_TOURNAMENTS = [
  { id: 'rumble', name: 'Midnight Rumble',   mode: 'Single Elim', rank: 'Open', players: 6,  max: 8,  live: true },
  { id: 'gauntlet', name: 'Neon Gauntlet',   mode: 'Double Elim', rank: 'A+',   players: 12, max: 16, live: true },
  { id: 'proving', name: 'Proving Grounds',  mode: 'Round Robin', rank: 'Open', players: 3,  max: 8,  live: false },
  { id: 'clash', name: 'Weekend Clash',      mode: 'Single Elim', rank: 'B',    players: 2,  max: 4,  live: false },
];
