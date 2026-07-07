import Icon from '../design/Icons.jsx';
import HomeArena from '../design/HomeArena.jsx';

// Portrait home (cinematic variant) — wired to the same handlers HomePage
// uses for landscape/desktop. Animation is the real fight engine via
// <HomeArena/>, and the action trio reuses the .action / .action-row classes
// so it inherits the same compact 3-up colored styling the landscape mobile
// view already uses (design.css @media max-width: 760px).

function MHTopbar({ onSettings, onHowTo }) {
  return (
    <div className="mh-topbar">
      <div className="mh-brand">
        <span className="dot" />
        <span>PK</span>
      </div>
      <div className="mh-bread">
        <span className="crumb-eyebrow">Arena</span>
        <span className="crumb-active">Home</span>
      </div>
      <div style={{ flex: 1 }} />
      {onHowTo && (
        <button className="mh-howto" onClick={onHowTo}>
          <Icon name="play" size={11} />&nbsp;How to Play
        </button>
      )}
      <button className="mh-iconbtn" aria-label="Settings" onClick={onSettings}>
        <Icon name="gear" size={14} />
      </button>
    </div>
  );
}

function MHAction({ tone, title, icon, desc, cta, onClick }) {
  return (
    <div
      className={`action ${tone}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <div className="action-head">
        <div className="action-title">{title}</div>
        <div className="action-icon">{icon}</div>
      </div>
      <div className="action-desc">{desc}</div>
      <div className="action-cta">
        <span>{cta}</span>
        <Icon name="arrow" size={14} />
      </div>
    </div>
  );
}

export default function MobileHome({ onQuick, onHost, onJoin, onSettings, onHowTo, showArena = true }) {
  // Fighter loadout lives in /setup (the gear icon in the topbar) so the home
  // page stays focused on Play / Host / Join.
  return (
    <div className="mh-page mh-var-b">
      <MHTopbar onSettings={onSettings} onHowTo={onHowTo} />
      <div className="mh-body">
        <div className="mh-hero-b">
          <h1 className="mh-wordmark-b">
            PROMPT<br/><span className="kk">KOMBAT</span>
          </h1>
          <p className="mh-wordmark-sub">
            The AI wrestling arena. Write the strategy. Watch the bots fight.
          </p>
        </div>

        {showArena && <HomeArena />}

        <div className="action-row">
          <MHAction
            tone="gold"
            title="Play vs Bot"
            icon={<Icon name="bot" size={26} />}
            desc="Solo skirmish vs a random AI fighter."
            cta="Quick fight"
            onClick={onQuick}
          />
          <MHAction
            tone="red"
            title="Host Tournament"
            icon={<Icon name="trophy" size={26} />}
            desc="Open a 4 / 8 / 16 player bracket. You set the rules."
            cta="Open lobby"
            onClick={onHost}
          />
          <MHAction
            tone="ink"
            title="Join Tournament"
            icon={<Icon name="enter" size={26} />}
            desc="Enter a private room code or drop into a public bracket."
            cta="Find a match"
            onClick={onJoin}
          />
        </div>
      </div>
    </div>
  );
}
