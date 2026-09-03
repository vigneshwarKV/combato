import Icon from '../design/Icons.jsx';
import HomeArena from '../design/HomeArena.jsx';

// Portrait home (cinematic variant) — wired to the same handlers HomePage
// uses for landscape/desktop. Animation is the real fight engine via
// <HomeArena/>, and the action trio reuses the .action / .action-row classes
// so it inherits the same compact 3-up colored styling the landscape mobile
// view already uses (design.css @media max-width: 760px).

function MHTopbar({ onSettings, onHowTo, onRules, onLeaderboard }) {
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
      {/* Same pair as the desktop header, in the same order: rules then tour. */}
      {onRules && (
        <button className="mh-howto" onClick={onRules}>
          <Icon name="rules" size={11} />&nbsp;Rules
        </button>
      )}
      {onHowTo && (
        <button className="mh-howto" onClick={onHowTo}>
          <Icon name="play" size={11} />&nbsp;How to Play
        </button>
      )}
      {onLeaderboard && (
        <button className="mh-howto" onClick={onLeaderboard}>
          <Icon name="trophy" size={11} />&nbsp;Board
        </button>
      )}
      <button className="mh-iconbtn" aria-label="Loadout" onClick={onSettings}>
        <Icon name="loadout" size={14} />
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

export default function MobileHome({ onQuick, on1v1, onTournament, onSettings, onHowTo, onRules, onLeaderboard, showArena = true }) {
  // Fighter loadout lives in /setup (the loadout icon in the topbar) so the home
  // page stays focused on the three ways to play.
  return (
    <div className="mh-page mh-var-b">
      <MHTopbar onSettings={onSettings} onHowTo={onHowTo} onRules={onRules} onLeaderboard={onLeaderboard} />
      <div className="mh-body">
        <div className="mh-hero-b">
          {/* Tagline leads, wordmark follows — matches desktop HomePage. */}
          <p className="mh-wordmark-sub">
            The AI wrestling arena. Build strategy and unleash your bot.
          </p>
          {/* One word now, so no <br/> — the lockup is a single 7-letter run. */}
          <h1 className="mh-wordmark-b">
            COMBAT<span className="kk">O</span>
          </h1>
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
            title="Play 1v1"
            icon={<Icon name="swords" size={26} />}
            desc="Duel a friend head-to-head. Share a code."
            cta="Start a duel"
            onClick={on1v1}
          />
          <MHAction
            tone="ink"
            title="Tournament"
            icon={<Icon name="trophy" size={26} />}
            desc="Host a 2–16 player bracket or join one."
            cta="Host or join"
            onClick={onTournament}
          />
        </div>
      </div>
    </div>
  );
}
