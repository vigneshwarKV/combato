import { useState, useEffect, useRef, useCallback } from 'react';
import { createPeer, sendMessage, broadcast, onMessage } from '../engine/peerEngine.js';
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
  return { size, rounds, pointer, champion: null };
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

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useMatchHost(matchCode, opts = {}) {
  const { tournamentName, mode } = opts;
  const peerRef         = useRef(null);
  const peersRef        = useRef(new Map());
  const pendingMovesRef = useRef(null);
  const lobbyStateRef   = useRef(null);
  const myConfigRef     = useRef(null);
  const currentMatchRef = useRef(null);

  const [lobbyState, setLobbyState] = useState({ fighters: [], phase: 'lobby', matchCode, tournamentName, mode });
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

  lobbyStateRef.current   = lobbyState;
  myConfigRef.current     = myConfig;
  currentMatchRef.current = currentMatch;

  // ── Lobby helpers ──────────────────────────────────────────────────────────

  const broadcastLobby = useCallback((state) => {
    broadcast(peersRef.current, 'LOBBY_UPDATE', { lobbyState: state });
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
            // Tournament already underway — admit as a spectator, not a fighter.
            // They watch the bracket / live matches and may join once it ends.
            if (prev.phase !== 'lobby') {
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

    createPeer(matchCode).then(peer => {
      if (cancelled) { peer.destroy(); return; }
      peerRef.current = peer;
      setConnected(true);

      const hostFighter = {
        peerId: peer.id,
        name: myConfigRef.current.name,
        character: myConfigRef.current.character,
        isHost: true,
        ready: true,
      };
      const initial = { fighters: [hostFighter], phase: 'lobby', matchCode, tournamentName, mode, autoStartAt: Date.now() + AUTO_START_MS };
      setLobbyState(initial);

      peer.on('connection', handleConnection);
      peer.on('error', (e) => setError(e.message));
    }).catch(e => {
      if (!cancelled) setError(e.message);
    });

    return () => {
      cancelled = true;
      peerRef.current?.destroy();
    };
  }, [matchCode, handleConnection]);

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

    const matchData = { fA: match.fA, fB: match.fB, fightConfig: lobby.fightConfig };
    currentMatchRef.current = matchData;
    setCurrentMatch(matchData);

    const updatedLobby = { ...lobby, phase: 'fighting' };
    setLobbyState(updatedLobby);
    broadcastLobby(updatedLobby);

    broadcast(peersRef.current, 'FIGHT_START', {
      fightConfig: lobby.fightConfig || {},
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

    const myPeerId = peerRef.current?.id;
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
    broadcast(peersRef.current, 'FIGHT_EVENT', { event });
  }, []);

  return {
    connected, error,
    lobbyState, myConfig, updateMyConfig,
    startTournament, startNextMatch, advanceMatch,
    closeTournament, closeRoom,
    getMoves, broadcastFightEvent,
    currentMatch, tournamentStarted,
    inviteLink: typeof window !== 'undefined' ? `${window.location.origin}/room/${matchCode}` : '',
    myPeerId: peerRef.current?.id,
  };
}
