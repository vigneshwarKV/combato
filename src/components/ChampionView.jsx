import { CHARACTERS } from '../data/characters.js';
import CharImage from './CharImage.jsx';
import CharacterPreview from './CharacterPreview.jsx';

export default function ChampionView({ champion, isHost, onBackToLobby, onCloseRoom }) {
  const char = champion?.character ? CHARACTERS[champion.character] : null;

  if (!champion) {
    return (
      <div className="champion-stage">
        <div className="champion-trophy">🏆</div>
        <div className="champion-title" style={{ color: 'var(--text-muted)' }}>NO CHAMPION</div>
        <div className="champion-subtitle">DRAW — Both Eliminated</div>
        {isHost && (
          <div className="champion-actions">
            <button className="btn-arena" onClick={onBackToLobby}>Back to Lobby</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="champion-stage">
      <div className="champion-trophy">🏆</div>
      <div className="champion-title">CHAMPION</div>

      <div className="champion-avatar-wrap">
        <div className="champion-avatar-glow" />
        {/* Live idle sprite — renders PNG and spine fighters alike (e.g. Monkey
            King / spine characters have no static preview.png, so the old
            <CharImage> fell back to a letter box). Falls back to CharImage for
            any character the renderer can't load. */}
        {char
          ? <CharacterPreview characterId={champion.character} width={220} height={260} mode="idle" />
          : <CharImage char={char} size={200} />}
      </div>

      <div className="champion-name">{champion.name}</div>
      {char && <div className="champion-char-name">{char.name}</div>}

      {isHost && (
        <div className="champion-actions">
          <button className="btn-arena" onClick={onBackToLobby}>
            Back to Lobby
          </button>
          <button className="btn-arena btn-arena-ghost" onClick={onCloseRoom}>
            Close Room
          </button>
        </div>
      )}
    </div>
  );
}
