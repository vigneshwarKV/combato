import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateMatchCode } from '../engine/peerEngine.js';

export default function HomePage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');

  function handleHostRoom() {
    const code = generateMatchCode();
    navigate(`/room/${code}`, { state: { isHost: true } });
  }

  function handleJoin(e) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 3) {
      setJoinError('Enter a valid room code');
      return;
    }
    setJoinError('');
    navigate(`/room/${code}`, { state: { isHost: false } });
  }

  return (
    <div className="min-h-screen arena-bg spotlight flex flex-col items-center justify-center relative overflow-hidden px-4">
      {/* Crowd strip */}
      <div className="crowd-strip" />

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-8 w-full max-w-md text-center">

        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-4">
          <div className="logo-text">Prompt<br/>Kombat</div>
          <div className="logo-sub">AI Wrestling Arena</div>
        </div>

        {/* Decorative rope line */}
        <div className="w-full h-px" style={{ background: 'linear-gradient(90deg, transparent, #c8a20066, #c8a200, #c8a20066, transparent)' }} />

        {/* Action area */}
        <div className="flex flex-col gap-4 w-full">
          {/* Host button */}
          <button className="btn-arena text-2xl py-4" onClick={handleHostRoom}>
            Host a Room
          </button>

          <div className="flex items-center gap-3">
            <div className="arena-divider flex-1" />
            <span className="section-label text-xs px-2">or join</span>
            <div className="arena-divider flex-1" />
          </div>

          {/* Join form */}
          <form onSubmit={handleJoin} className="flex flex-col gap-2">
            <input
              className="arena-input text-center text-xl font-arena tracking-widest uppercase"
              style={{ fontFamily: 'var(--font-arena)', letterSpacing: '0.3em' }}
              placeholder="ROOM CODE"
              value={joinCode}
              onChange={e => {
                setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
                setJoinError('');
              }}
              maxLength={8}
              spellCheck={false}
              autoComplete="off"
            />
            {joinError && (
              <p className="text-xs text-center" style={{ color: 'var(--neon-red)', fontFamily: 'var(--font-arena)', letterSpacing: '0.1em' }}>
                {joinError}
              </p>
            )}
            <button type="submit" className="btn-arena btn-arena-red">
              Enter the Ring
            </button>
          </form>
        </div>

        {/* Tagline */}
        <p className="text-xs" style={{ color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          LLM vs LLM · You write the strategy
        </p>
      </div>
    </div>
  );
}
