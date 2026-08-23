import { useState, useEffect, useRef, useCallback } from 'react';
import { createPeer, sendMessage, broadcast, broadcastAll, onMessage } from '../engine/peerEngine.js';
import { callAI, buildFighterPrompt, getFallback } from '../engine/prompts.js';

// Lobby auto-start window. The HOST stamps an absolute deadline (`autoStartAt`)
// into the broadcast lobby state so every joiner counts down to the SAME wall
// clock instant — instead of each client running its own local 5:00 from
// whenever it happened to render the page.
const AUTO_START_MS = 15 * 60 * 1000; // 15:00

// ── Bracket helpers ────────────────────────────────────────────────────────────

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function toPublicFighter(f) {
  return { peerId: f.peerId, name: f.name, character: f.character, isHost: !!f.isHost, ready: !!f.ready };
}

function getRoundLabel(roundIndex, totalRounds) {
  if (totalRounds === 1) return 'Final';
  if (roundIndex === totalRounds - 1) return 'Final';
  if (roundIndex === totalRounds - 2) return 'Semifinals';
  if (roundIndex === totalRounds - 3) return 'Quarterfinals';
  return `Round ${roundIndex + 1}`;
}

function propagateWinner(rounds, roundIndex, matchIndex, winner) {
  if (roundIndex >= rounds.length - 1) return;
  const nextMi = Math.floor(matchIndex / 2);
  const slot = matchIndex % 2 === 0 ? 'fA' : 'fB';
  const nextMatch = rounds[roundIndex + 1].matches[nextMi];
  nextMatch[slot] = winner;
  if (nextMatch.fA && nextMatch.fB) nextMatch.status = 'ready';
}

function findNextPointer(rounds) {
  for (let r = 0; r < rounds.length; r++) {
    for (let m = 0; m < rounds[r].matches.length; m++) {
      const match = rounds[r].matches[m];
      if (match.status === 'complete') continue;
      if (match.fA && match.fB) return { roundIndex: r, matchIndex: m };
      // One slot filled after forfeit cascade — auto-advance the survivor
      if ((match.fA || match.fB) && match.status !== 'complete') {
        const survivor = match.fA || match.fB;
        match.winner = survivor;
        match.status = 'complete';
        propagateWinner(rounds, r, m, survivor);
        // Continue scanning — the propagated match may now be ready
      }
    }
  }
  return null;
}

function buildBracket(fighters) {
  const size = nextPow2(Math.max(2, fighters.length));
  const shuffled = [...fighters].sort(() => Math.random() - 0.5);
  const slots = [...shuffled.map(toPublicFighter)];
  while (slots.length < size) slots.push(null);

  const totalRounds = Math.log2(size);
  const rounds = [];

  // Round 0: build from slots
  const round0Matches = [];
  for (let m = 0; m < size / 2; m++) {
    const fA = slots[m * 2] || null;
    const fB = slots[m * 2 + 1] || null;
    if (!fA && !fB) {
      round0Matches.push({ matchId: `r0m${m}`, fA: null, fB: null, winner: null, isBye: false, status: 'complete' });
    } else if (!fA || !fB) {
      const winner = fA || fB;
      round0Matches.push({ matchId: `r0m${m}`, fA, fB, winner, isBye: true, status: 'complete' });
    } else {
      round0Matches.push({ matchId: `r0m${m}`, fA, fB, winner: null, isBye: false, status: 'ready' });
    }
  }
  rounds.push({ roundIndex: 0, label: getRoundLabel(0, totalRounds), matches: round0Matches });

  // Build empty later rounds
  for (let r = 1; r < totalRounds; r++) {
    const matchCount = size / Math.pow(2, r + 1);
    const matches = [];
    for (let m = 0; m < matchCount; m++) {
      matches.push({ matchId: `r${r}m${m}`, fA: null, fB: null, winner: null, isBye: false, status: 'pending' });
    }
    rounds.push({ roundIndex: r, label: getRoundLabel(r, totalRounds), matches });
  }

  // Pre-propagate round-0 byes and empty matches
  if (rounds.length > 1) {
    for (let m = 0; m < rounds[0].matches.length; m++) {
      const match = rounds[0].matches[m];
      if (match.status === 'complete' && match.winner) {
        propagateWinner(rounds, 0, m, match.winner);
      }
    }
  }

  const pointer = findNextPointer(rounds);
  // A per-tournament id — combined with each match's slot id, it gives every
  // match a stable dedup key that survives a host refresh (same bracket in the
  // snapshot) but differs across a rematch/new tournament (fresh bracket).
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return { id, size, rounds, pointer, champion: null };
}

// Where a peerId stands in a live bracket: 'alive' (still contending or champion),
// 'eliminated' (lost a completed match), or 'absent' (never in it / spectator). A
// fighter is eliminated only if they were in a COMPLETED match they didn't win —
// used so a dropped-then-reconnected fighter reclaims their seat instead of being
// demoted to a spectator.
function bracketStatus(bracket, peerId) {
  if (!bracket || !peerId) return 'absent';
  let seen = false;
  let eliminated = false;
  for (const round of bracket.rounds) {
    for (const m of round.matches) {
      const mine = m.fA?.peerId === peerId || m.fB?.peerId === peerId;
      if (!mine) continue;
      seen = true;
      if (m.status === 'complete' && m.winner?.peerId !== peerId) eliminated = true;
    }
  }
  if (!seen) return bracket.champion?.peerId === peerId ? 'alive' : 'absent';
  return eliminated ? 'eliminated' : 'alive';
}

function cloneBracket(bracket) {
  return {
    ...bracket,
    rounds: bracket.rounds.map(r => ({
      ...r,
      matches: r.matches.map(m => ({ ...m })),
    })),
  };
}

// Remove a fighter (e.g. a departed host) from a live bracket: null their slots
// in any not-yet-complete match, then let findNextPointer cascade forfeits/byes.
// Pointer is refreshed; champion is set if the tournament is now over.
export function removeFighterFromBracket(bracket, peerId) {
  if (!bracket) return bracket;
  const b = cloneBracket(bracket);
  for (const round of b.rounds) {
    for (const m of round.matches) {
      if (m.status === 'complete') continue;
      if (m.fA?.peerId === peerId) m.fA = null;
      if (m.fB?.peerId === peerId) m.fB = null;
    }
  }
  b.pointer = findNextPointer(b.rounds);
  if (!b.pointer) {
    const finalMatch = b.rounds[b.rounds.length - 1]?.matches[0];
    b.champion = finalMatch?.winner || null;
  }
  return b;
}

// Swap a fighter's peerId everywhere in a bracket — used when a joiner is promoted
// to host and adopts the host transport id (== room code).
export function rekeyFighterInBracket(bracket, oldId, newId) {
  if (!bracket) return bracket;
  const swap = (f) => (f && f.peerId === oldId ? { ...f, peerId: newId } : f);
  const b = cloneBracket(bracket);
  for (const round of b.rounds) {
    for (const m of round.matches) {
      m.fA = swap(m.fA); m.fB = swap(m.fB); m.winner = swap(m.winner);
    }
  }
  if (b.champion) b.champion = swap(b.champion);
  return b;
}

// ── Host state durability (survive a host refresh) ──────────────────────────────
// The host holds the entire tournament in memory; joiners never do. Snapshot the
// authoritative lobbyState per-room in sessionStorage (per-tab, so it survives a
// reload but a brand-new tab starts clean) and resume from it on remount.
const HOST_SNAP_KEY = (code) => `pk.hostState.${code}`;

export function saveHostSnapshot(code, state) {
  if (typeof window === 'undefined' || !code || !state) return;
  try { window.sessionStorage.setItem(HOST_SNAP_KEY(code), JSON.stringify(state)); } catch { /* ignore */ }
}

function loadHostSnapshot(code) {
  if (typeof window === 'undefined' || !code) return null;
  try { return JSON.parse(window.sessionStorage.getItem(HOST_SNAP_KEY(code)) || 'null'); } catch { return null; }
}

export function clearHostSnapshot(code) {
  if (typeof window === 'undefined' || !code) return;
  try { window.sessionStorage.removeItem(HOST_SNAP_KEY(code)); } catch { /* ignore */ }
}

// Turn a saved snapshot into a resumable state. A refresh during a live fight
// can't resume mid-physics, so rewind that match to its bracket-preview and
// re-run it. Countdown/auto-start timers are re-anchored to now so they don't
// resume already-expired.
function resumeFromSnapshot(s) {
  if (!s || !s.phase) return null;
  if (s.phase === 'fighting') {
    // Rewind the in-progress match to its preview and re-run it. `resumeGraceUntil`
    // gives the OTHER player a few seconds to reconnect before the match re-fires —
    // matters for 1v1, which auto-starts instantly (tournaments have the 20s
    // countdown already). It's ignored once we're back in a normal flow.
    return { ...s, phase: 'bracket-preview', nextMatchStartsAt: Date.now() + 20000, resumeGraceUntil: Date.now() + 4000 };
  }
  if (s.phase === 'bracket-preview') return { ...s, nextMatchStartsAt: Date.now() + 20000 };
  if (s.phase === 'lobby') return { ...s, autoStartAt: Date.now() + AUTO_START_MS };
  return s; // champion — show the result as-is
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useMatchHost(matchCode, opts = {}) {
  const { tournamentName, mode, adoptPeer } = opts;
  const peerRef         = useRef(null);
  const peersRef        = useRef(new Map());
  const pendingMovesRef = useRef(null);
  const lobbyStateRef   = useRef(null);
  const myConfigRef     = useRef(null);
  const currentMatchRef = useRef(null);
  // Latest broadcast fight state (hp/meter/status) for the CURRENT match, so a
  // player reconnecting mid-fight can be seeded to "now" (see the JOIN handler).
  const currentFightStateRef = useRef(null);
  // Wall-clock instant the current fight's events began, so a mid-fight rejoin
  // can seed the round timer to the correct remaining time (not a fresh full one).
  const fightStartAtRef = useRef(0);
  // Guards the snapshot-persist effect from clobbering a saved tournament with
  // the transient default lobby before createPeer has had a chance to restore it.
  const hydratedRef     = useRef(false);

  const [lobbyState, setLobbyState] = useState({ fighters: [], phase: 'lobby', matchCode, tournamentName, mode, hostEpoch: 0 });
  const [myConfig, setMyConfig] = useState({
    // Empty on purpose — RoomPage seeds this from the saved profile handle. A
    // literal default like 'Host' would stick (the seeding only fills a blank
    // name) and show up as the fighter's name everywhere: lobby, HUD, bracket,
    // champion screen. Blank lets the real handle take over.
    name: '', character: null,
    // Plain-English strategy playbook; activeStrategyIndex is switched live
    // during a fight and read fresh each batch in getMoves.
    strategies: [], activeStrategyIndex: 0,
  });
  const [connected, setConnected] = useState(false);
  const [error, setError]         = useState(null);
  const [currentMatch, setCurrentMatch] = useState(null);
  const [tournamentStarted, setTournamentStarted] = useState(false);
  // True when a better host exists (an old host returned after being replaced, or
  // a double-promotion) — RoomPage steps this peer down to a client.
  const [hostConflict, setHostConflict] = useState(false);

  lobbyStateRef.current   = lobbyState;
  myConfigRef.current     = myConfig;
  currentMatchRef.current = currentMatch;

  // ── Lobby helpers ──────────────────────────────────────────────────────────

  const broadcastLobby = useCallback((state) => {
    broadcast(peersRef.current, 'LOBBY_UPDATE', { lobbyState: state });
    // Also send channel-wide so a peer that hasn't (re-)JOINed this host yet — e.g.
    // right after a failover — still receives the current roster/phase.
    broadcastAll(peerRef.current, 'LOBBY_UPDATE', { lobbyState: state });
  }, []);

  const updateLobby = useCallback((updater) => {
    setLobbyState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      broadcastLobby(next);
      return next;
    });
  }, [broadcastLobby]);

  // ── Incoming connection handler ────────────────────────────────────────────

  const handleConnection = useCallback((conn) => {
    peersRef.current.set(conn.peer, conn);

    conn.on('close', () => {
      peersRef.current.delete(conn.peer);
      setLobbyState(prev => {
        const next = { ...prev, fighters: prev.fighters.filter(f => f.peerId !== conn.peer) };
        broadcastLobby(next);
        return next;
      });
    });

    onMessage(conn, (msg) => {
      switch (msg.type) {
        case 'JOIN': {
          setLobbyState(prev => {
            // Already on the roster (duplicate / reconnect) — just re-ack.
            if (prev.fighters.some(f => f.peerId === conn.peer)) {
              sendMessage(conn, 'JOIN_ACK', { lobbyState: prev, spectator: false });
              return prev;
            }
            // Tournament already underway. A player who is still ALIVE in the
            // bracket but dropped (network blip / refresh) rejoins as a FIGHTER,
            // so their match keeps routing moves to them and they re-enter the
            // Arena at the next match — instead of being stuck spectating their
            // own run. Everyone else (new arrivals, eliminated) watches.
            if (prev.phase !== 'lobby') {
              if (bracketStatus(prev.bracket, conn.peer) === 'alive') {
                const rejoined = {
                  peerId: conn.peer,
                  name: msg.fighterConfig?.name || 'Fighter',
                  character: msg.fighterConfig?.character || null,
                  isHost: false,
                  ready: true,
                };
                const next = { ...prev, fighters: [...prev.fighters, rejoined] };
                broadcastLobby(next);
                sendMessage(conn, 'JOIN_ACK', { lobbyState: next, spectator: false });
                return next;
              }
              sendMessage(conn, 'JOIN_ACK', { lobbyState: prev, spectator: true });
              return prev;
            }
            // A 1v1 duel seats exactly two — any later arrival watches instead.
            if (prev.mode === '1v1' && prev.fighters.length >= 2) {
              sendMessage(conn, 'JOIN_ACK', { lobbyState: prev, spectator: true });
              return prev;
            }
            const newFighter = {
              peerId: conn.peer,
              name: msg.fighterConfig?.name || 'Fighter',
              character: msg.fighterConfig?.character || null,
              isHost: false,
              ready: false,
            };
            const next = { ...prev, fighters: [...prev.fighters, newFighter] };
            broadcastLobby(next);
            sendMessage(conn, 'JOIN_ACK', { lobbyState: next, spectator: false });
            return next;
          });
          // Reconnect mid-fight: if a match is live and this peer is one of its
          // fighters, re-send FIGHT_START + a state snapshot so their Arena drops
          // back into the LIVE fight (seeks to the current HP) instead of waiting
          // on the bracket until the next round.
          {
            const live = currentMatchRef.current;
            if (live && lobbyStateRef.current?.phase === 'fighting' &&
                (conn.peer === live.fA?.peerId || conn.peer === live.fB?.peerId)) {
              const snap = currentFightStateRef.current;
              sendMessage(conn, 'FIGHT_START', {
                fightConfig: live.fightConfig || {},
                matchId: live.matchId,
                matchFighters: [
                  { ...live.fA, role: 'A' },
                  { ...live.fB, role: 'B' },
                ],
                resumeState: snap
                  ? { ...snap, elapsedMs: fightStartAtRef.current ? Date.now() - fightStartAtRef.current : 0 }
                  : null,
              });
            }
          }
          break;
        }
        case 'JOIN_AS_FIGHTER': {
          // A spectator opting in once the tournament is over (or back in lobby).
          setLobbyState(prev => {
            const joinable = prev.phase === 'lobby' || prev.phase === 'champion';
            if (!joinable || prev.fighters.some(f => f.peerId === conn.peer)) {
              sendMessage(conn, 'JOIN_ACK', { lobbyState: prev, spectator: !joinable });
              return prev;
            }
            const newFighter = {
              peerId: conn.peer,
              name: msg.fighterConfig?.name || 'Fighter',
              character: msg.fighterConfig?.character || null,
              isHost: false,
              ready: false,
            };
            const next = { ...prev, fighters: [...prev.fighters, newFighter] };
            broadcastLobby(next);
            sendMessage(conn, 'JOIN_ACK', { lobbyState: next, spectator: false });
            return next;
          });
          break;
        }
        case 'UPDATE_FIGHTER': {
          setLobbyState(prev => {
            const next = {
              ...prev,
              fighters: prev.fighters.map(f =>
                f.peerId === conn.peer ? { ...f, ...msg.updates } : f
              ),
            };
            broadcastLobby(next);
            return next;
          });
          break;
        }
        case 'SUBMIT_MOVES': {
          const pending = pendingMovesRef.current;
          if (!pending || msg.batchNumber !== pending.batchNumber) break;
          if (conn.peer === pending.roleA_peerId && pending.resolveA) {
            pending.resolveA(msg.moves);
            pending.resolveA = null;
          } else if (conn.peer === pending.roleB_peerId && pending.resolveB) {
            pending.resolveB(msg.moves);
            pending.resolveB = null;
          }
          if (!pending.resolveA && !pending.resolveB) {
            pendingMovesRef.current = null;
          }
          break;
        }
      }
    });
  }, [broadcastLobby]);

  // ── Peer initialization ────────────────────────────────────────────────────

  useEffect(() => {
    if (!matchCode) return;
    let cancelled = false;

    const setupHost = (peer) => {
      if (cancelled) return;
      peerRef.current = peer;
      setConnected(true);

      const restored = resumeFromSnapshot(loadHostSnapshot(matchCode));
      if (restored) {
        // Resume from the last snapshot (host refresh OR failover promotion) and
        // re-broadcast so anyone still in the room catches up. Joiners also
        // re-JOIN when they see the host return and get re-acked into this state.
        lobbyStateRef.current = restored;
        setLobbyState(restored);
        setTournamentStarted(restored.phase !== 'lobby' && !!restored.bracket);
        broadcastLobby(restored);
      } else {
        const hostFighter = {
          peerId: peer._addr(),
          name: myConfigRef.current.name,
          character: myConfigRef.current.character,
          isHost: true,
          ready: true,
        };
        const initial = { fighters: [hostFighter], phase: 'lobby', matchCode, tournamentName, mode, hostEpoch: 0, autoStartAt: Date.now() + AUTO_START_MS };
        setLobbyState(initial);
      }
      hydratedRef.current = true; // snapshot persistence may begin now

      peer.on('connection', handleConnection);
      peer.on('error', (e) => setError(e.message));
      peer.on('hostConflict', () => { if (!cancelled) setHostConflict(true); });
      peer.setHostEpoch(lobbyStateRef.current?.hostEpoch ?? 0);
    };

    if (adoptPeer) {
      // Failover: adopt the departing client's peer IN PLACE — reuse its working
      // channel rather than recreating one on the same room topic.
      adoptPeer.becomeHost(matchCode, loadHostSnapshot(matchCode)?.hostEpoch ?? 0);
      setupHost(adoptPeer);
    } else {
      createPeer(matchCode)
        .then((peer) => { if (cancelled) { peer.destroy(); return; } setupHost(peer); })
        .catch((e) => { if (!cancelled) setError(e.message); });
    }

    return () => {
      cancelled = true;
      peerRef.current?.destroy();
    };
  }, [matchCode, handleConnection]);

  // Persist the host's authoritative state on every change so a refresh can
  // resume the tournament (see resumeFromSnapshot). Gated on hydration so the
  // transient default lobby can't clobber a snapshot before it's been restored.
  useEffect(() => {
    if (!matchCode || !hydratedRef.current) return;
    saveHostSnapshot(matchCode, lobbyState);
  }, [matchCode, lobbyState]);

  // Keep the transport's host epoch in step with the lobby state so the presence
  // announcement (and thus split-brain resolution) reflects the current epoch.
  useEffect(() => {
    if (peerRef.current && typeof lobbyState?.hostEpoch === 'number') {
      peerRef.current.setHostEpoch(lobbyState.hostEpoch);
    }
  }, [lobbyState?.hostEpoch]);

  // Safety net: re-announce the lobby channel-wide every few seconds while NOT in
  // a live fight, so any peer that missed a failover handoff converges to the
  // current host/roster/phase. (Skipped during 'fighting' — fight events stream.)
  useEffect(() => {
    if (!connected || lobbyState?.phase === 'fighting') return;
    const id = setInterval(() => {
      broadcastAll(peerRef.current, 'LOBBY_UPDATE', { lobbyState: lobbyStateRef.current });
    }, 3000);
    return () => clearInterval(id);
  }, [connected, lobbyState?.phase]);

  // ── My config changes sync to lobby ───────────────────────────────────────

  const updateMyConfig = useCallback((updates) => {
    setMyConfig(prev => {
      const next = { ...prev, ...updates };
      myConfigRef.current = next;
      setLobbyState(prev2 => {
        const next2 = {
          ...prev2,
          fighters: prev2.fighters.map(f =>
            f.isHost ? { ...f, name: next.name, character: next.character } : f
          ),
        };
        broadcastLobby(next2);
        return next2;
      });
      return next;
    });
  }, [broadcastLobby]);

  // ── Tournament start ───────────────────────────────────────────────────────

  const startTournament = useCallback((fightConfig = {}) => {
    const fighters = lobbyStateRef.current.fighters;
    if (fighters.length < 2) return;

    const bracket = buildBracket(fighters);
    const nextMatchStartsAt = Date.now() + 20000;

    const updatedLobby = {
      ...lobbyStateRef.current,
      phase: 'bracket-preview',
      bracket,
      nextMatchStartsAt,
      fightConfig,
      champion: null,
    };
    setLobbyState(updatedLobby);
    broadcastLobby(updatedLobby);
    setTournamentStarted(true);
  }, [broadcastLobby]);

  // ── Start next match (called by countdown auto-fire or host Skip button) ───

  const startNextMatch = useCallback(() => {
    const lobby = lobbyStateRef.current;
    if (lobby.phase !== 'bracket-preview' || !lobby.bracket) return;

    const { roundIndex, matchIndex } = lobby.bracket.pointer;
    const match = lobby.bracket.rounds[roundIndex].matches[matchIndex];
    if (!match || !match.fA || !match.fB) return;

    // Stable per-match id (bracket id + slot) shared with joiners via FIGHT_START,
    // used as the leaderboard dedup key so a re-run of this match scores once.
    const scoreMatchId = `${lobby.bracket.id || 'b'}:${match.matchId}`;
    const matchData = { fA: match.fA, fB: match.fB, fightConfig: lobby.fightConfig, matchId: scoreMatchId };
    currentMatchRef.current = matchData;
    currentFightStateRef.current = null; // fresh fight — no mid-fight snapshot yet
    fightStartAtRef.current = 0;         // stamped when this fight's first event fires
    setCurrentMatch(matchData);

    const updatedLobby = { ...lobby, phase: 'fighting' };
    setLobbyState(updatedLobby);
    broadcastLobby(updatedLobby);

    broadcast(peersRef.current, 'FIGHT_START', {
      fightConfig: lobby.fightConfig || {},
      matchId: scoreMatchId,
      matchFighters: [
        { ...match.fA, role: 'A' },
        { ...match.fB, role: 'B' },
      ],
    });
  }, [broadcastLobby]);

  // ── Advance match (called 2s after fight ends) ─────────────────────────────

  const advanceMatch = useCallback((winner) => {
    const lobby = lobbyStateRef.current;
    if (!lobby.bracket) return;

    const bracket = cloneBracket(lobby.bracket);
    const { roundIndex, matchIndex } = bracket.pointer;
    const match = bracket.rounds[roundIndex].matches[matchIndex];

    const winnerFighter = winner === 'A' ? match.fA : winner === 'B' ? match.fB : null;
    match.winner = winnerFighter;
    match.status = 'complete';

    if (winnerFighter) {
      propagateWinner(bracket.rounds, roundIndex, matchIndex, winnerFighter);
    }

    const nextPtr = findNextPointer(bracket.rounds);

    setCurrentMatch(null);
    currentMatchRef.current = null;

    if (!nextPtr) {
      // Tournament done
      const finalMatch = bracket.rounds[bracket.rounds.length - 1].matches[0];
      bracket.champion = finalMatch.winner;
      const updatedLobby = { ...lobby, phase: 'champion', bracket, champion: finalMatch.winner };
      setLobbyState(updatedLobby);
      broadcastLobby(updatedLobby);
    } else {
      bracket.pointer = nextPtr;
      bracket.champion = null;
      const updatedLobby = {
        ...lobby,
        phase: 'bracket-preview',
        bracket,
        nextMatchStartsAt: Date.now() + 20000,
      };
      setLobbyState(updatedLobby);
      broadcastLobby(updatedLobby);
    }
  }, [broadcastLobby]);

  // ── Close tournament (back to lobby, keep room) ────────────────────────────

  const closeTournament = useCallback(() => {
    const updatedLobby = {
      ...lobbyStateRef.current,
      phase: 'lobby',
      bracket: null,
      champion: null,
      nextMatchStartsAt: null,
      fightConfig: null,
      // Re-arm the shared lobby countdown for the next round of joiners.
      autoStartAt: Date.now() + AUTO_START_MS,
    };
    setLobbyState(updatedLobby);
    broadcastLobby(updatedLobby);
    setTournamentStarted(false);
    setCurrentMatch(null);
    currentMatchRef.current = null;
  }, [broadcastLobby]);

  // ── Close room (disconnect everyone, navigate home) ────────────────────────

  const closeRoom = useCallback(() => {
    broadcast(peersRef.current, 'ROOM_CLOSED', {});
    setTimeout(() => peerRef.current?.destroy(), 200);
  }, []);

  // ── getMoves: called by fightEngine for each batch ─────────────────────────

  const getMoves = useCallback(async (batchNumber, context) => {
    const match = currentMatchRef.current;
    if (!match) return [getFallback(context.n, null), getFallback(context.n, null)];

    const myPeerId = peerRef.current?._addr?.(); // host address (== room code)
    const { fA, fB } = match;
    const cfg = myConfigRef.current;

    pendingMovesRef.current = {
      batchNumber,
      roleA_peerId: fA.peerId,
      roleB_peerId: fB.peerId,
      resolveA: null,
      resolveB: null,
    };

    const getMovesForRole = (fighter, role) => new Promise((resolve) => {
      if (fighter.peerId === myPeerId) {
        const hp     = role === 'A' ? context.hpA : context.hpB;
        const oppHp  = role === 'A' ? context.hpB : context.hpA;
        const meter  = role === 'A' ? context.meterA : context.meterB;
        const oppMtr = role === 'A' ? context.meterB : context.meterA;
        const status = role === 'A' ? context.statusA : context.statusB;
        const oppSt  = role === 'A' ? context.statusB : context.statusA;
        const opp    = role === 'A' ? fB : fA;

        // Read my ACTIVE strategy fresh each batch so a live switch takes effect
        // on the next set of moves.
        const activeStrategy = cfg.strategies?.[cfg.activeStrategyIndex ?? 0];
        const fighterData = {
          ...fighter, prompt: activeStrategy?.text || '', promptMode: 'simple', hp,
        };
        const fightState = {
          n: context.n, batchNumber,
          history: context.history || [],
          meter, opponentMeter: oppMtr,
          status, opponentStatus: oppSt,
        };
        callAI(fighterData, buildFighterPrompt(fighterData, { character: opp.character, hp: oppHp }, fightState), {})
          .then(raw => resolve(raw === 'FAIL' ? null : raw))
          .catch(() => resolve(null));
      } else {
        if (role === 'A') pendingMovesRef.current.resolveA = resolve;
        else               pendingMovesRef.current.resolveB = resolve;

        const conn = peersRef.current.get(fighter.peerId);
        if (!conn) { resolve(null); return; }

        sendMessage(conn, 'REQUEST_MOVES', {
          batchNumber,
          yourRole: role,
          context: {
            n: context.n,
            hpA: context.hpA, hpB: context.hpB,
            meterA: context.meterA, meterB: context.meterB,
            statusA: context.statusA, statusB: context.statusB,
            characterA: fA.character, characterB: fB.character,
            history: context.history?.slice(-3) || [],
          },
        });
        setTimeout(() => resolve(null), 15000);
      }
    });

    const [rawA, rawB] = await Promise.all([
      getMovesForRole(fA, 'A'),
      getMovesForRole(fB, 'B'),
    ]);

    return [rawA, rawB];
  }, []);

  // ── Fight event broadcast ──────────────────────────────────────────────────

  const broadcastFightEvent = useCallback((event) => {
    // Keep the latest hp/meter/status so a mid-fight reconnect can be seeded to
    // the current moment. action_result carries the full set; batch_start carries
    // hp/meter only — merge so we never lose the last-known status.
    if (event && (event.type === 'action_result' || event.type === 'batch_start')) {
      if (!fightStartAtRef.current) fightStartAtRef.current = Date.now(); // first event ≈ fight start
      const prev = currentFightStateRef.current || {};
      currentFightStateRef.current = {
        hpA: event.hpA ?? prev.hpA,
        hpB: event.hpB ?? prev.hpB,
        meterA: event.meterA ?? prev.meterA,
        meterB: event.meterB ?? prev.meterB,
        statusA: event.statusA ?? prev.statusA,
        statusB: event.statusB ?? prev.statusB,
        batchNumber: event.batchNumber ?? prev.batchNumber,
      };
    }
    broadcast(peersRef.current, 'FIGHT_EVENT', { event });
  }, []);

  return {
    connected, error, hostConflict,
    lobbyState, myConfig, updateMyConfig,
    startTournament, startNextMatch, advanceMatch,
    closeTournament, closeRoom,
    getMoves, broadcastFightEvent,
    currentMatch, tournamentStarted,
    inviteLink: typeof window !== 'undefined' ? `${window.location.origin}/room/${matchCode}` : '',
    myPeerId: matchCode, // the host's wire address is always the room code
  };
}
