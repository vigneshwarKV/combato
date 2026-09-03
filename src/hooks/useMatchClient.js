import { useState, useEffect, useRef, useCallback } from 'react';
import { createPeer, sendMessage, onMessage, stableJoinerId } from '../engine/peerEngine.js';
import { callAI, buildFighterPrompt, getFallback } from '../engine/prompts.js';

// How long the host may be gone before we treat it as a real departure (vs a
// reload/blip) and elect a successor to take over hosting.
const HOST_GRACE_MS = 5000;

export function useMatchClient(matchCode) {
  const peerRef = useRef(null);
  const hostConnRef = useRef(null);
  const [lobbyState, setLobbyState] = useState(null);
  const [myConfig, setMyConfig] = useState({
    name: '',
    character: null,
    color: '#FF4444',
    // Plain-English strategy playbook; activeStrategyIndex is switched live and
    // read fresh each time the host requests my moves.
    strategies: [],
    activeStrategyIndex: 0,
    ready: false,
  });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [fightEvents, setFightEvents] = useState([]);
  const [matchRole, setMatchRole] = useState(null); // 'A' | 'B' | 'spectator'
  const [matchFighters, setMatchFighters] = useState(null);
  const [matchId, setMatchId] = useState(null); // stable dedup id for the live match
  const [matchResume, setMatchResume] = useState(null); // mid-fight snapshot when rejoining a live match
  const [roomClosed, setRoomClosed] = useState(false);
  // True when we connected after the tournament had already started: we watch
  // as a spectator and may opt into the roster once it ends (see joinAsFighter).
  const [isSpectator, setIsSpectator] = useState(false);
  // Host-departure / failover: hostGone flips true if the host stays gone past
  // the grace window; successorId is the peer elected to take over (smallest
  // remaining peerId — every client computes the same). RoomPage promotes the
  // successor to host so the tournament continues.
  const [hostGone, setHostGone] = useState(false);
  const [successorId, setSuccessorId] = useState(null);
  const hostGraceRef = useRef(null);

  const myConfigRef = useRef(myConfig);
  myConfigRef.current = myConfig;
  const matchRoleRef = useRef(matchRole);
  matchRoleRef.current = matchRole;
  // Watchdog: Realtime "joins" an empty/non-existent room silently (no error),
  // so we detect a bad code / offline host by the absence of a JOIN_ACK.
  const ackedRef = useRef(false);
  const watchdogRef = useRef(null);
  // Set when this peer is handed to the host hook (failover) so unmount doesn't
  // destroy the channel out from under the new host.
  const releasedRef = useRef(false);

  const handleHostMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'JOIN_ACK':
        ackedRef.current = true;
        clearTimeout(watchdogRef.current);
        setLobbyState(msg.lobbyState);
        setIsSpectator(!!msg.spectator);
        break;
      case 'LOBBY_UPDATE':
        setLobbyState(msg.lobbyState);
        // Match teardown: once the host moves us off the live fight (back to the
        // bracket / champion / lobby), drop the finished match's fighters + event
        // log. The next match's LOBBY_UPDATE(phase:'fighting') arrives just BEFORE
        // its FIGHT_START — if stale matchFighters survived, RoomPage's mount gate
        // (currentMatch || matchFighters) would re-mount the Arena on the OLD
        // fighters and the spectator renderer would replay the previous fight's
        // tail (winner sound, KO poses) until FIGHT_START lands. Clearing here
        // keeps the gate closed until fresh fighters arrive.
        if (msg.lobbyState?.phase !== 'fighting') {
          setMatchFighters(null);
          setFightEvents([]);
        }
        break;
      case 'FIGHT_START': {
        const myPeerId = peerRef.current?.id;
        const myFighter = msg.matchFighters?.find(f => f.peerId === myPeerId);
        setMatchRole(myFighter?.role || 'spectator');
        matchRoleRef.current = myFighter?.role || 'spectator';
        setMatchFighters(msg.matchFighters);
        setMatchId(msg.matchId || null);
        // Present only on a mid-fight rejoin — seeds the Arena to the live state.
        setMatchResume(msg.resumeState || null);
        setFightEvents([]);
        break;
      }
      case 'FIGHT_EVENT':
        setFightEvents(prev => [...prev, msg.event]);
        break;
      case 'ROOM_CLOSED':
        setRoomClosed(true);
        break;
      case 'REQUEST_MOVES': {
        // My fighter was asked for moves — call AI locally and respond
        const cfg = myConfigRef.current;
        const role = msg.yourRole;
        const ctx = msg.context;
        // Read my ACTIVE strategy fresh so a live switch applies to this batch.
        const activeStrategy = cfg.strategies?.[cfg.activeStrategyIndex ?? 0];
        const fighterData = {
          name: cfg.name,
          character: cfg.character,
          prompt: activeStrategy?.text || '',
          promptMode: 'simple',
          hp: role === 'A' ? ctx.hpA : ctx.hpB,
        };
        const opponentData = {
          character: role === 'A' ? ctx.characterB : ctx.characterA,
          hp: role === 'A' ? ctx.hpB : ctx.hpA,
        };
        const fightState = {
          n: ctx.n,
          batchNumber: msg.batchNumber,
          history: ctx.history || [],
          meter: role === 'A' ? ctx.meterA : ctx.meterB,
          opponentMeter: role === 'A' ? ctx.meterB : ctx.meterA,
          status: role === 'A' ? ctx.statusA : ctx.statusB,
          opponentStatus: role === 'A' ? ctx.statusB : ctx.statusA,
        };

        callAI(fighterData, buildFighterPrompt(fighterData, opponentData, fightState), {})
          .then(moves => {
            const validMoves = Array.isArray(moves) && moves.length === ctx.n ? moves : getFallback(ctx.n, cfg.character, fightState.meter);
            sendMessage(hostConnRef.current, 'SUBMIT_MOVES', {
              batchNumber: msg.batchNumber,
              moves: validMoves,
              fallbackUsed: !Array.isArray(moves) || moves.length !== ctx.n,
            });
          })
          .catch(() => {
            const fallback = getFallback(ctx.n, cfg.character, fightState.meter);
            sendMessage(hostConnRef.current, 'SUBMIT_MOVES', {
              batchNumber: msg.batchNumber,
              moves: fallback,
              fallbackUsed: true,
            });
          });
        break;
      }
    }
  }, []);

  useEffect(() => {
    if (!matchCode) return;
    let cancelled = false;

    // Stable per-room identity → a refresh or a second tab rejoins the SAME seat
    // (the host recognizes the peerId already on its roster) instead of appearing
    // as a duplicate fighter.
    createPeer(null, { peerId: stableJoinerId(matchCode) }).then(peer => {
      if (cancelled) { peer.destroy(); return; }
      peerRef.current = peer;

      const conn = peer.connect(matchCode, { reliable: true });
      hostConnRef.current = conn;

      conn.on('open', () => {
        if (cancelled) return;
        // Host is here (initial connect OR it came back) — cancel any pending
        // failover and clear the gone flag.
        clearTimeout(hostGraceRef.current);
        setHostGone(false);
        setSuccessorId(null);
        setConnected(true);
        onMessage(conn, handleHostMessage);
        sendMessage(conn, 'JOIN', {
          fighterConfig: {
            name: myConfigRef.current.name || `Fighter`,
            character: myConfigRef.current.character,
            color: myConfigRef.current.color,
          },
        });
        // If the host never acks, the code is wrong or the host is offline.
        watchdogRef.current = setTimeout(() => {
          if (!cancelled && !ackedRef.current) setError('Room not found or the host is offline.');
        }, 8000);
      });

      conn.on('close', () => setConnected(false));
      conn.on('error', (e) => setError(e.message));
      peer.on('error', (e) => setError(e.message));

      // Host liveness rides an explicit heartbeat (reliable across a handoff,
      // unlike presence-key reuse). Every beat clears the gone flag and resets a
      // watchdog; if beats stop for the grace window the host is gone for real →
      // elect a successor (smallest remaining peerId; every client agrees).
      peer.on('hostBeat', () => {
        if (cancelled) return;
        clearTimeout(hostGraceRef.current);
        setHostGone(false);
        setSuccessorId(null);
        hostGraceRef.current = setTimeout(() => {
          if (cancelled) return;
          const others = (peerRef.current?.presentPeerIds?.() || []).filter(id => id && id !== matchCode);
          setSuccessorId(others.sort()[0] || null);
          setHostGone(true);
        }, HOST_GRACE_MS);
      });
    }).catch(e => {
      if (!cancelled) setError(e.message);
    });

    return () => {
      cancelled = true;
      clearTimeout(watchdogRef.current);
      clearTimeout(hostGraceRef.current);
      if (!releasedRef.current) peerRef.current?.destroy(); // keep it alive if handed to the host hook
    };
  }, [matchCode, handleHostMessage]);

  // Hand our peer to the host hook on failover promotion, WITHOUT tearing it down —
  // it keeps its already-working channel (a recreated one strands other joiners).
  const releasePeer = useCallback(() => {
    releasedRef.current = true;
    return peerRef.current;
  }, []);

  const updateMyConfig = useCallback((updates) => {
    setMyConfig(prev => {
      const next = { ...prev, ...updates };
      myConfigRef.current = next;
      if (hostConnRef.current) {
        sendMessage(hostConnRef.current, 'UPDATE_FIGHTER', {
          updates: { name: next.name, character: next.character, color: next.color, ready: next.ready },
        });
      }
      return next;
    });
  }, []);

  // Opt into the roster after watching as a spectator. The host only honors
  // this between tournaments (lobby) or once one ends (champion).
  const joinAsFighter = useCallback(() => {
    const cfg = myConfigRef.current;
    if (!hostConnRef.current) return;
    sendMessage(hostConnRef.current, 'JOIN_AS_FIGHTER', {
      fighterConfig: { name: cfg.name || 'Fighter', character: cfg.character, color: cfg.color },
    });
  }, []);

  return {
    connected,
    error,
    lobbyState,
    myConfig,
    updateMyConfig,
    fightEvents,
    matchRole,
    matchFighters,
    matchId,
    matchResume,
    roomClosed,
    isSpectator,
    hostGone,
    successorId,
    releasePeer,
    joinAsFighter,
    myPeerId: peerRef.current?.id,
  };
}
