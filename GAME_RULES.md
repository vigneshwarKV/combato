# Combato — Game Rules

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
| Blocked an attack (`defend_low` / `defend_high`) | +7 |
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
| `idle` / `jump` / `defend_low` / `defend_high` | 0 HP |

> **Guards are high/low.** There are two block stances. `defend_high` braces overhead; `defend_low` drops the shield to the body/legs. Each stops only the attacks on its line — guess wrong and the attack lands for full damage.
>
> | Attack | Line | Stopped by |
> |--------|------|-----------|
> | regular `hit` | HIGH | `defend_high` |
> | airborne super | HIGH | `defend_high` |
> | `shoot` | LOW | `defend_low` |
> | `slide` | LOW | `defend_low` |
> | rush `hit` (Skater Kid) | LOW | `defend_low` |
> | projectile `hit` (Woman Hero) | LOW | `defend_low` |
> | grounded super | LOW | `defend_low` |

---

## Action Interaction Matrix

Both fighters choose simultaneously. The result depends on what both pick.

### `hit` (melee strike)

| Opponent does | Result |
|--------------|--------|
| `idle` / `defend_low`* / `shoot`** | You deal **10 dmg** |
| `jump` | You deal **10 dmg** (knocks them out of air) |
| `defend_high` | **Blocked** — 0 dmg (a regular hit is HIGH) |
| `hit` | **Clash** — both deal 0 dmg |
| `slide` | You **miss** — slide ducks under the hit |
| `shoot` (fast gun) | You **miss** — bullet stops your lunge |
| any Ultimate | You **interrupt** the ult — you deal 10 dmg, their ult whiffs |

> *A regular `hit` is HIGH, so only `defend_high` blocks it — a `defend_low` guesses wrong and eats it. (Rush-style hits — Skater Kid — and projectile-style hits — Woman Hero — are LOW, blocked by `defend_low` instead.)  
> **`shoot` stops a regular lunge. Slow throwers (Monkey, Turtle — spear delay ≥ your lunge speed) get hit instead.

---

### `shoot` (projectile)

| Opponent does | Result |
|--------------|--------|
| `idle` / `defend_high` / `hit` (slow thrower) | You deal **8 dmg** |
| `defend_low` | **Blocked** — 0 dmg (low guard catches the bullet) |
| `jump` | **Miss** — projectile flies under them |
| `slide` (fast gun) | You deal **8 dmg** — bullet catches them mid-slide |
| `slide` (slow thrower) | **Miss** — slider reaches you before the shot releases |
| `hit` (fast lunge) | **Miss** — hitter interrupted your shot |
| any airborne Ultimate | **Miss** — they fly over your projectile |

> `shoot` is LOW: `defend_low` blocks it on the shield; `defend_high` is raised over the head and the bullet passes underneath.

---

### `slide` (low tackle)

| Opponent does | Result |
|--------------|--------|
| `idle` / `defend_high` / `shoot` (slow thrower) | You deal **6 dmg** |
| `defend_low` | **Blocked** — 0 dmg (low guard catches the tackle) |
| `hit` (regular melee) | You deal **6 dmg** — clips their legs mid-lunge |
| `jump` | **Miss** — can't reach a jumper |
| `shoot` (fast gun) | **Miss** — bullet tags you mid-slide |
| `slide` | **Clash** — both deal **6 dmg** |
| any Ultimate | **Miss** — ultimate's range or height clears you |

> `slide` is LOW: `defend_low` blocks it; `defend_high` is raised over the head and gets swept out from under (takes full slide dmg).

---

### `defend_high` (high guard — shield braced overhead)

| Opponent does | Result |
|--------------|--------|
| `hit` (regular melee) | **Blocks** — 0 dmg received |
| airborne Ultimate (jet-pack / flyHit) | **Blocks** — 0 dmg received |
| `shoot` / `slide` | **Does not block** — passes underneath, full dmg |
| `hit` (Skater Kid rush / Woman Hero ice shot) | **Does not block** — these are LOW, full dmg |
| grounded Ultimate | **Does not block** — full dmg |

### `defend_low` (low guard — shield dropped to the body/legs)

| Opponent does | Result |
|--------------|--------|
| `shoot` | **Blocks** — 0 dmg received |
| `slide` | **Blocks** — 0 dmg received |
| `hit` (Skater Kid rush) | **Blocks** — 0 dmg received |
| `hit` (Woman Hero ice shot) | **Blocks** — 0 dmg received |
| grounded Ultimate | **Blocks** — 0 dmg received |
| `hit` (regular melee) | **Does not block** — comes over the top, full dmg |
| airborne Ultimate | **Does not block** — full dmg |

> No Ultimate is unblockable anymore — every super is stopped by the guard that matches its line (airborne → `defend_high`, grounded → `defend_low`).

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
| Woman Hero | Triple Shot | 75 | 30 | Applies **burn** · Grounded (blocked by `defend_low`) · Misses airborne ults |
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
- Counts as a LOW attack — blocked by `defend_low`, NOT by `defend_high`
- Slide cannot dodge it (she fires from the air, not ground level)

### Skater Kid — Rush hit
His `hit` is a skateboard charge:
- Counts as a LOW attack — blocked by `defend_low`, NOT by `defend_high`
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
