import { PLAYER_MOVE_TOKENS } from '../../engine/prompts.js';

// The game-plan editor: one plan's name + text, the "example" filler, and the
// move vocabulary on the box floor. Shared so the setup page and the tutorial
// show the SAME control — the tutorial's whole point is "this is the screen
// where you write it", which a lookalike would undo.
//
//   onNameChange — omit to render the name as fixed text (the tutorial pins it)
//   onDelete     — omit to hide the delete button (setup hides it on the last plan)
//   exampleCue   — pulse a "Press here" bubble under the example button
//   readOnly     — the tutorial types into the box; the player can't fight it
export default function PlanEditor({
  name, onNameChange,
  text, onTextChange,
  onExample, exampleCue = false,
  onDelete,
  readOnly = false,
  nameId = 'su-plan-name',
  namePlaceholder = 'e.g. Attack, Defend, Adapt',
  textPlaceholder = 'e.g. Defend until my meter is full, then land a super move.',
  label = 'Your game plan',
}) {
  return (
    <div className="su-plan-editor">
      {/* Title bar: the name is what shows on the plan pill, so it lives one
          step from it, next to the delete for the plan being edited. */}
      <div className="su-plan-head">
        <label className="su-plan-nlabel" htmlFor={onNameChange ? nameId : undefined}>NAME</label>
        {onNameChange ? (
          <input
            id={nameId}
            className="su-plan-name"
            value={name || ''}
            onChange={e => onNameChange(e.target.value.slice(0, 20))}
            placeholder={namePlaceholder}
            maxLength={20}
            aria-label={`${label} name`}
          />
        ) : (
          <span className="su-plan-name su-plan-name--fixed">{name}</span>
        )}
        {onDelete && (
          <button className="su-plan-del" onClick={onDelete} aria-label="Delete this plan">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
            </svg>
          </button>
        )}
      </div>

      <div className="su-plan-textwrap">
        {/* readOnly is display-only, not just uneditable: it also drops out of
            the tab order and stops taking pointer events, because a tap on it
            opened the phone keyboard over the tutorial. */}
        <textarea
          className={`su-plan-text${readOnly ? ' is-locked' : ''}`}
          value={text || ''}
          onChange={e => onTextChange(e.target.value.slice(0, 240))}
          placeholder={textPlaceholder}
          aria-label={label}
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
        />
        <button className="su-plan-example" onClick={onExample}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 4l3 3-3 3M20 7h-4a3 3 0 0 0-3 3" /><path d="M7 20l-3-3 3-3M4 17h4a3 3 0 0 0 3-3" /></svg>
          example
        </button>
        {exampleCue && (
          <span className="plan-cue plan-cue--example">
            <span className="plan-cue-arrow">▲</span>
            <span className="plan-cue-text">Press here</span>
          </span>
        )}

        {/* On the floor of the text box: the exact move tokens the engine
            accepts, so a plan can name them instead of inventing its own words
            for them. Shown without the token underscores — plans are written in
            plain English, and the model reads "defend high" the same. */}
        <div className="su-plan-tip">
          <span className="su-tip-label">MOVES</span>
          <span className="su-tip-vals">
            {PLAYER_MOVE_TOKENS.map(m => <code key={m}>{m.replace(/_/g, ' ')}</code>)}
          </span>
        </div>
      </div>
    </div>
  );
}
