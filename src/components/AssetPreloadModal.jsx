// Blocking, non-dismissable overlay shown while the fight assets preload (see
// assetPreloader.js). Mandatory: there is no close button — the player leaves
// it only when loading finishes, or via "Continue anyway" on a failure.
//
// Reuses the existing .modal-backdrop / .modal styling but deliberately omits
// the DesignKit Modal's close button so it can't be dismissed early.

const BAR_TRACK = {
  height: 10,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.10)',
  overflow: 'hidden',
  margin: '18px 0 10px',
};

export default function AssetPreloadModal({ done = 0, total = 0, status = 'loading', onRetry, onContinue }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const isError = status === 'error';

  return (
    <div className="modal-backdrop" style={{ zIndex: 2000 }}>
      <div className="modal" style={{ maxWidth: 440, textAlign: 'center' }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          {isError ? 'DOWNLOAD INTERRUPTED' : 'PREPARING THE ARENA'}
        </div>
        <h2
          className="f-display"
          style={{ fontSize: 26, letterSpacing: '0.04em', color: 'var(--gold)', margin: '0 0 4px' }}
        >
          {isError ? 'Some assets failed' : 'Downloading fighters…'}
        </h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: '0 0 4px', lineHeight: 1.5 }}>
          {isError
            ? 'Check your connection and retry, or continue — anything missing will load during the fight.'
            : 'Loading every fighter, sound and effect once so battles run without stutter.'}
        </p>

        <div style={BAR_TRACK}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: 'var(--gold)',
              borderRadius: 999,
              transition: 'width 0.2s ease',
            }}
          />
        </div>

        <div className="f-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
          {total > 0 ? `${done} / ${total} assets · ${pct}%` : 'Starting…'}
        </div>

        {isError && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-sm btn-ghost" onClick={onContinue}>CONTINUE ANYWAY</button>
            <button className="btn btn-sm" onClick={onRetry}>RETRY</button>
          </div>
        )}
      </div>
    </div>
  );
}
