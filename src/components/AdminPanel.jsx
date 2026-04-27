import { useState } from 'react';

const FIGHTER_COUNTS = [2, 4, 8, 16];

export default function AdminPanel({
  fighters,
  onNewTournament,
  onGenerateBracket,
  onStartTournament,
  onStartNextMatch,
  onForceNextBatch,
  onStartUpdateWindow,
  tournamentConfig,
  onUpdateN,
  onUpdateDefaultKey,
  bracketExists,
  tournamentStarted,
  currentScreen
}) {
  const [updateMinutes, setUpdateMinutes] = useState(2);
  const [copiedId, setCopiedId]           = useState(null);
  const [confirmReset, setConfirmReset]   = useState(false);
  const [newTournamentSize, setNewTournamentSize] = useState(16);
  const [defaultKey, setDefaultKey]       = useState(tournamentConfig.defaultApiKey || '');

  const readyCount = fighters.filter(f => f.prompt).length;
  const isValidBracketSize = [2, 4, 8, 16].includes(fighters.length);

  const handleCopyUrl = (fighter) => {
    const url = `${window.location.origin}${window.location.pathname}?fighter=${fighter.id}`;
    navigator.clipboard.writeText(url);
    setCopiedId(fighter.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleNewTournament = () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    onNewTournament(newTournamentSize);
  };

  return (
    <div className="bg-gray-800 rounded-xl p-4 space-y-5 text-sm" style={{ width: '300px' }}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Admin Panel</h2>
        <span className="text-xs text-gray-400">{readyCount}/{fighters.length} ready</span>
      </div>

      {/* Default API key */}
      <div>
        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
          Default Groq API Key
        </label>
        <input
          type="password"
          value={defaultKey}
          onChange={e => setDefaultKey(e.target.value)}
          onBlur={() => onUpdateDefaultKey(defaultKey)}
          placeholder="gsk_..."
          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500"
        />
        <p className="text-xs text-gray-600 mt-1">Used for fighters who don't supply their own key.</p>
      </div>

      {/* N selector */}
      <div>
        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
          Moves per batch (N)
        </label>
        <div className="flex gap-2 items-center">
          {[1, 3, 5, 8].map(v => (
            <button
              key={v}
              disabled={tournamentStarted}
              onClick={() => onUpdateN(v)}
              className={`px-3 py-1.5 rounded font-bold transition-colors text-sm
                ${tournamentConfig.n === v ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}
                ${tournamentStarted ? 'opacity-40 cursor-not-allowed' : ''}
              `}
            >
              {v}
            </button>
          ))}
          {tournamentStarted && <span className="text-xs text-gray-500">Locked</span>}
        </div>
      </div>

      {/* Fighter roster */}
      <div>
        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
          Fighters ({fighters.length})
        </label>
        <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {fighters.map(f => (
            <div key={f.id} className="flex items-center gap-2 bg-gray-700 rounded-lg px-2.5 py-1.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: f.color }} />
              <span className="flex-1 text-xs font-semibold truncate">{f.name}</span>
              {f.prompt
                ? <span className="text-green-400 text-xs">✓</span>
                : <span className="text-gray-600 text-xs">—</span>}
              <button
                onClick={() => handleCopyUrl(f)}
                className={`text-xs px-2 py-0.5 rounded transition-colors shrink-0 ${
                  copiedId === f.id
                    ? 'bg-green-700 text-green-200'
                    : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                }`}
              >
                {copiedId === f.id ? '✓' : 'URL'}
              </button>
            </div>
          ))}
          {fighters.length === 0 && (
            <div className="text-gray-500 text-xs text-center py-4">
              Click "New Tournament" to seed the roster
            </div>
          )}
        </div>
      </div>

      {/* Tournament controls */}
      <div className="space-y-2 border-t border-gray-700 pt-4">

        {!bracketExists && isValidBracketSize && fighters.length > 0 && (
          <button
            onClick={onGenerateBracket}
            className="w-full py-2 bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded-lg transition-colors"
          >
            Generate Bracket ({fighters.length})
          </button>
        )}

        {bracketExists && !tournamentStarted && currentScreen !== 'fight' && (
          <button
            onClick={onStartTournament}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-colors"
          >
            🔒 Start Tournament (Lock Prompts)
          </button>
        )}

        {bracketExists && tournamentStarted && currentScreen !== 'fight' && (
          <button
            onClick={onStartNextMatch}
            className="w-full py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition-colors"
          >
            ▶ Start Next Match
          </button>
        )}

        {currentScreen === 'fight' && (
          <button
            onClick={onForceNextBatch}
            className="w-full py-2 bg-orange-700 hover:bg-orange-600 text-white font-bold rounded-lg transition-colors"
          >
            ⚡ Force Next Batch
          </button>
        )}

        {/* New Tournament — always available */}
        <div className="pt-1">
          {confirmReset ? (
            <div className="space-y-2">
              <p className="text-xs text-red-400 text-center font-semibold">
                Resets all prompts &amp; bracket. Pick size:
              </p>
              <div className="flex gap-1.5 justify-center">
                {FIGHTER_COUNTS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewTournamentSize(c)}
                    className={`px-3 py-1.5 rounded font-bold text-sm transition-colors ${
                      newTournamentSize === c
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleNewTournament}
                  className="flex-1 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-bold rounded-lg">
                  Reset ({newTournamentSize} fighters)
                </button>
                <button onClick={() => setConfirmReset(false)}
                  className="flex-1 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-xs font-bold rounded-lg">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={handleNewTournament}
              className="w-full py-2 bg-gray-700 hover:bg-red-900 border border-gray-600 hover:border-red-700 text-gray-300 hover:text-red-300 text-xs font-bold rounded-lg transition-colors">
              🔄 New Tournament
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
