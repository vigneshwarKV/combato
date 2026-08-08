# Combato — Game Overview

## What It Is

An AI-powered fighting game where players write strategic prompts for their fighter and two LLMs battle it out in real-time turn-based combat. Think Street Fighter, but both fighters are controlled by AI decisions driven by player-written strategies.

---

## Core Game Loop

```
Player writes a prompt/strategy
       ↓
Match starts — two fighters face off
       ↓
Each turn: both AIs simultaneously choose an action
       ↓
Actions resolve together (clash matrix decides damage)
       ↓
Animations play in sync with damage resolution
       ↓
Repeat until KO or time limit
```

---

## Action System

Six base actions available every turn:

| Action | What It Does |
|--------|-------------|
| `hit` | Melee strike — blocked by defend, clashes vs opposing hit |
| `shoot` | Projectile — misses jumpers, caught by slides |
| `slide` | Low tackle — dodges hit, clashes vs opposing slide |
| `jump` | Evades shoot and most projectiles; hit knocks you down |
| `defend` | Blocks hit and ultimates (not shoot/slide) |
| `idle` | Do nothing, safe |

Plus character-specific **ultimates** that cost meter to activate.

**Key rule**: actions resolve simultaneously — there's no attacker/defender turn order.

---

## Damage & Meter

- Each fighter starts at **100 HP**, **0 meter**
- Landing hits, blocking, dodging all build meter
- Meter fuels ultimates (cost: 75–100 depending on character)
- Status effects: burn, poison, freeze, stun — applied by some ultimates
- Both fighters can be KO'd in the same turn → **draw**

---

## Characters

13 fighters across 5 archetypes:

| Archetype | Characters | Trait |
|-----------|-----------|-------|
| Striker | Scarlet, Finn, Bolt, Red Cap | High attack (5), low defense |
| Tank | Iron Turtle, Beast | Low attack, high defense |
| Ranger | Shadow Strike, Hex, Yellow Bandana | Projectile specialists |
| Acrobat | Monkey King, Skater Kid | Aerial/mobility moves |
| Mage | Woman Hero | Projectile ultimates, unblockable spread |

Each character has unique ultimates, animation set, and motion physics (lunge distance, projectile spawn delay, airborne arcs, etc.).

---

## Fight Engine

`src/engine/fightEngine.js` — main match orchestrator:
- Runs in **batches** (default 3 turns per batch)
- Calls LLM APIs for both fighters each turn
- Resolves via `damageEngine.js` (clash matrix)
- Pre-calculates animation timing via `animResolution.js`
- Emits events: `batch_start`, `action_result`, `ko`, `decision`, `draw`

`src/engine/animResolution.js` — timing precision:
- Calculates exactly **when** each animation plays and when the reaction fires
- Handles edge cases: converging melee meeting at centerline, projectile vs jumper, slow throwers (spear delay), ultimate clashes
- Output: `launchAt`, `reactionAt`, `impactA/B`, `clearA/B` timestamps

---

## Multiplayer (P2P)

Uses **PeerJS** for direct peer-to-peer — no game server.

- **Host** generates a 6-char room code, runs the fight locally, broadcasts events
- **Clients** join via code; if assigned a fighter they call AI locally and submit moves
- **Spectators** just receive and render events
- Supports **bracket tournaments** for 3+ players (auto elimination rounds)

---

## Bot Match (Single Player)

`src/pages/BotMatchPage.jsx`:
- Pick character, write strategy, choose AI provider (Groq / OpenAI / Anthropic)
- Random bot opponent auto-assigned
- Full fight runs locally in `Arena` host mode

---

## Rendering

`src/components/ArenaStage.jsx` — single Pixi.js WebGL canvas:
- Both fighters rendered together
- Two sprite modes: **Spine** (skeletal, 4 characters) and **PNG frame sequences** (9 characters)
- Motion tweens: lunge forward on hit, glide on slide, arc on airborne ultimates
- Projectiles fired at calculated spawn times

`src/components/Arena.jsx` — orchestration:
- Fixed internal canvas 1100×760px, CSS-scaled to fit viewport
- HP bars, meter bars, action labels overlay on top
- Landscape mode lock, speed control (1×/2×)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19 + React Router 7 |
| Rendering | Pixi.js 8 (WebGL) + @pixi/spine-pixi |
| Networking | PeerJS 1.5 (P2P via STUN) |
| AI | Anthropic / OpenAI / Groq APIs |
| Styling | Tailwind CSS 4 |
| Build | Vite |

---

## Recent Work

- **Action-reaction pattern** — animation timing overhaul; reactions fire based on pre-computed impact timestamps
- **Beast rework** — action rename (`melee→hit` etc.) + custom motion system for Beast character
- **Landscape mode** — fullscreen + orientation lock for mobile
- **BotMatchPage** — new single-player UI with character grid, stat display, strategy editor
- **Character selection redesign** — new card grid UI with animated previews

---

## Key Files at a Glance

```
src/
  engine/
    fightEngine.js       — match loop, AI calls, event emitter
    damageEngine.js      — clash matrix, status effects, meter
    animResolution.js    — animation timing calculator
    prompts.js           — LLM prompt builder + API calls
    peerEngine.js        — P2P networking wrapper
  components/
    Arena.jsx            — fight container, scaling, HUD
    ArenaStage.jsx       — Pixi.js renderer, tweens, projectiles
  pages/
    BotMatchPage.jsx     — single-player setup + fight
    RoomPage.jsx         — multiplayer lobby + tournament
    HomePage.jsx         — landing (host/join)
  hooks/
    useFight.js          — fight runner, event→dispatch bridge
    useFightRenderer.js  — fight UI state reducer
    useMatchHost.js      — P2P host logic
    useMatchClient.js    — P2P client logic
  data/
    characters.js        — all 13 fighter definitions
```
