# Prompt-Kombat — Game Rules

## Health & Win Condition

- Each fighter starts with **100 HP**
- Fighter reaches 0 HP → **KO**, opponent wins
- Both reach 0 HP on the same turn → **Draw**
- Time limit reached → fighter with **more HP wins** (decision)

---

## Super Meter

Meter fills as you fight. At **100 max**.

| What happened | Meter gained |
|--------------|-------------|
| Landed a melee hit (`hit` / `slide`) | +10 |
| Landed a ranged shot (`shoot`) | +8 |
| Blocked an attack (`defend`) | +7 |
| Slid past an attack | +5 |
| Jumped to evade | +3 |
| Took damage (comeback) | **+15** |

**Activating an ultimate** deducts its cost from your meter.  
If you don't have enough meter, the engine falls back to `hit` instead.  
If you are frozen or stunned, your action is forced to `idle`.

---

## Base Action Damage

| Action | Damage dealt |
|--------|-------------|
| `hit` | 10 HP |
| `shoot` | 8 HP |
| `slide` | 6 HP |
| `idle` / `jump` / `defend` | 0 HP |

---

## Action Interaction Matrix

Both fighters choose simultaneously. The result depends on what both pick.

### `hit` (melee strike)

| Opponent does | Result |
|--------------|--------|
| `idle` / `defend`* / `shoot`** | You deal **10 dmg** |
| `jump` | You deal **10 dmg** (knocks them out of air) |
| `hit` | **Clash** — both deal 0 dmg |
| `slide` | You **miss** — slide ducks under the hit |
| `shoot` (fast gun) | You **miss** — bullet stops your lunge |
| any Ultimate | You **interrupt** the ult — you deal 10 dmg, their ult whiffs |

> *`defend` blocks a regular `hit`. Does NOT block rush-style hits (Skater Kid) or projectile-style hits (Woman Hero).  
> **`shoot` stops a regular lunge. Slow throwers (Monkey, Turtle — spear delay ≥ your lunge speed) get hit instead.

---

### `shoot` (projectile)

| Opponent does | Result |
|--------------|--------|
| `idle` / `defend` / `hit` (slow thrower) | You deal **8 dmg** |
| `jump` | **Miss** — projectile flies under them |
| `slide` (fast gun) | You deal **8 dmg** — bullet catches them mid-slide |
| `slide` (slow thrower) | **Miss** — slider reaches you before the shot releases |
| `hit` (fast lunge) | **Miss** — hitter interrupted your shot |
| any airborne Ultimate | **Miss** — they fly over your projectile |

> `defend` does **not** block `shoot` — shields are for melee, not bullets.

---

### `slide` (low tackle)

| Opponent does | Result |
|--------------|--------|
| `idle` / `defend` / `shoot` (slow thrower) | You deal **6 dmg** |
| `hit` (regular melee) | You deal **6 dmg** — clips their legs mid-lunge |
| `jump` | **Miss** — can't reach a jumper |
| `shoot` (fast gun) | **Miss** — bullet tags you mid-slide |
| `slide` | **Clash** — both deal **6 dmg** |
| any Ultimate | **Miss** — ultimate's range or height clears you |

> `defend` does **not** block `slide`.

---

### `defend` (block stance)

| Opponent does | Result |
|--------------|--------|
| `hit` (regular melee) | **Blocks** — 0 dmg received |
| any Ultimate (blockable) | **Blocks** — 0 dmg received |
| `shoot` | **Does not block** — takes full 8 dmg |
| `slide` | **Does not block** — takes full 6 dmg |
| `hit` (Skater Kid rush) | **Does not block** — rush breaks through |
| `hit` (Woman Hero ice shot) | **Does not block** — arrows pierce a shield |
| Ultimate (unblockable) | **Does not block** — takes full damage |

---

### `jump`

| Opponent does | Result |
|--------------|--------|
| `shoot` | **Evades** — projectile passes under |
| `hit` (regular melee) | **Gets hit** — knocked out of the air (10 dmg) |
| `hit` (Woman Hero ice shot) | **Evades** — she fires straight, jumper clears it |

---

### Ultimate vs Ultimate

| Both ultimates | Result |
|---------------|--------|
| Same vertical lane (both airborne OR both grounded) | **Clash** — both deal 0 dmg, meter still spent |
| Airborne ult vs grounded ult | **Airborne wins** — flies over grounded attack; grounded user takes full ult damage |

---

## Status Effects

Applied by some ultimates; tick damage happens **before** actions each turn.

| Effect | Damage per turn | Duration | Extra |
|--------|----------------|----------|-------|
| Burn | 5 HP | 3 turns | — |
| Poison | 8 HP | 5 turns | — |
| Freeze | 0 HP | 1 turn | **Skips your action** (forced idle) |
| Stun | 0 HP | 1 turn | **Skips your action** (forced idle) |

Status is refreshed (duration reset) if the same effect is applied again.

---

## Character Ultimates

All ultimates cost **meter** to activate. Using one without enough meter falls back to `hit`.

| Character | Ultimate | Cost | Damage | Special |
|-----------|---------|------|--------|---------|
| Woman Hero | Triple Shot | 75 | 30 | Applies **burn** · **Unblockable** · Misses airborne ults |
| Monkey King | Sky Strike | 75 | 30 | Airborne · clashes with other airborne ults |
| Iron Turtle | Aero Roll | 75 | 25 | Grounded · blockable |
| Skater Kid | Skateboard Rush | 75 | 28 | Airborne · blockable |
| Mad Scientist | Explosive Dash | 75 | 20 | Applies **stun** |
| Beast | Rocket Charge | 100 | 35 | Deals **5 self-damage** on use |
| Shadow Strike | Deadeye Snipe | 75 | 28 | Ignores dodge (hits jumpers too) |
| Scarlet | Blitz Strike | 75 | 22 | Standard airborne ult |
| Finn | Rocket Rush | 75 | 25 | Standard airborne ult |
| Hex | Grenade Toss | 75 | 22 | Applies **burn** |
| Bolt | Boom Dash | 75 | 24 | Standard airborne ult |
| Red Cap | Rocket Dive | 75 | 22 | Standard airborne ult |
| Yellow Bandana | Jet Shot | 75 | 22 | Standard airborne ult |

---

## Special Character Rules

### Woman Hero — Ice Shot hit
Her `hit` is a jump-up-and-shoot, not a lunge:
- Misses jumpers (arrow flies straight, they're above it)
- Misses vs opposing regular `hit` (opponent's lunge catches her before she fires)
- Pierces `defend` (unblockable arrows)
- Slide cannot dodge it (she fires from the air, not ground level)

### Skater Kid — Rush hit
His `hit` is a skateboard charge:
- Breaks through `defend` — too much momentum to shield
- Treated like a `slide` when hit by a fast `shoot` (thrown back)

### Monkey King & Iron Turtle — Slow throwers
Their `shoot` has a long spear wind-up (~320–380ms delay):
- A `slide` can **reach them** before the spear releases → slide wins, shot misses
- A regular melee `hit` lunge can also **outrun** the throw → hit wins, shot misses

---

## Turn Summary

Each turn runs in this order:

1. **DoT tick** — burn/poison deal damage before anything else
2. **Action coercion** — frozen/stunned → idle; not enough meter → hit
3. **Simultaneous resolution** — both actions evaluated at the same time
4. **Ultimate side-effects** — self-damage, heals, status applications
5. **Meter spend** — ult cost deducted
6. **Meter gains** — from landing hits, blocking, dodging, taking damage
7. **Status decay** — duration counts down, expired effects removed
