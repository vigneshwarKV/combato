import { useState, useEffect, useRef, useCallback } from 'react';
import { createPeer, sendMessage, onMessage } from '../engine/peerEngine.js';
import { callAI, buildFighterPrompt, getFallback } from '../engine/prompts.js';

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
  const [roomClosed, setRoomClosed] = useState(false);
  // True when we connected after the tournament had already started: we watch
  // as a spectator and may opt into the roster once it ends (see joinAsFighter).
  const [isSpectator, setIsSpectator] = useState(false);

  const myConfigRef = useRef(myConfig);
  myConfigRef.current = myConfig;
  const matchRoleRef = useRef(matchRole);
  matchRoleRef.current = matchRole;
  // Watchdog: Realtime "joins" an empty/non-existent room silently (no error),
  // so we detect a bad code / offline host by the absence of a JOIN_ACK.
  const ackedRef = useRef(false);
  const watchdogRef = useRef(null);

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

    createPeer().then(peer => {
      if (cancelled) { peer.destroy(); return; }
      peerRef.current = peer;

      const conn = peer.connect(matchCode, { reliable: true });
      hostConnRef.current = conn;

      conn.on('open', () => {
        if (cancelled) return;
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
    }).catch(e => {
      if (!cancelled) setError(e.message);
    });

    return () => {
      cancelled = true;
      clearTimeout(watchdogRef.current);
      peerRef.current?.destroy();
    };
  }, [matchCode, handleHostMessage]);

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
    roomClosed,
    isSpectator,
    joinAsFighter,
    myPeerId: peerRef.current?.id,
  };
}
