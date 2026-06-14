import Icon from './Icons.jsx';

// Shown when a player tries to enter the ring without a fighter + strategy.
// Used on the home page (gating the action buttons) and on the room page
// (gating a new user who lands on a shared /room/:code link).
export default function NeedSetupPrompt({ onClose, onChoose }) {
  return (
    <>
      <h2>Set up your fighter first</h2>
      <p>You need to pick a character and write a strategy before stepping into the ring.</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>NOT NOW</button>
        <button className="btn" onClick={onChoose} style={{ flex: 1 }}>
          <Icon name="sparkle" size={14} />&nbsp;OPEN SETTINGS
        </button>
      </div>
    </>
  );
}
