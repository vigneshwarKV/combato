const ACTION_LABELS = {
  punch:     '👊 PUNCH',
  kick:      '🦵 KICK',
  jump:      '↑ JUMP',
  crouch:    '↓ CROUCH',
  defend:    '🛡 DEFEND',
  supermove: '⚡ SUPER!',
  none:      '💤 NONE',
};

// Fighter renders ONLY the character + action label.
// HP bars and names are owned by Arena.
export default function Fighter({ fighter, animClass = 'anim-idle', animKey = 0, hitClass = '', hitKey = 0, side = 'A', currentAction = null }) {
  const { color = '#6366f1', hp = 100 } = fighter;
  const isDead = hp <= 0;
  const isDefending = animClass === 'anim-defend';

  const colorBack = color + 'aa';

  return (
    <div className="flex flex-col items-center gap-2 select-none">

      {/* Action label */}
      <div className="h-8 mb-4 flex items-center justify-center">
        {currentAction && (
          <span
            key={currentAction + Date.now()}
            className="action-label-pop text-sm font-black tracking-wide px-3 py-1 rounded"
            style={{
              color: animClass === 'anim-supermove' ? '#fbbf24' : color,
              backgroundColor: color + '22',
              border: `1px solid ${color}55`,
              whiteSpace: 'nowrap'
            }}
          >
            {ACTION_LABELS[currentAction] || currentAction.toUpperCase()}
          </span>
        )}
      </div>

      {/* Flip wrapper — scaleX(-1) for side B so they face each other */}
      <div style={{ transform: side === 'B' ? 'scaleX(-1)' : undefined }}>

        <div key={`${animClass}-${animKey}`} className={`fighter-root ${animClass}`}>

          {/* Charge aura — ki energy glow during supermove charge phase */}
          <div className="fighter-aura" style={{
            position: 'absolute',
            top: '100px', left: '55px',
            width: '160px', height: '160px',
            marginTop: '-80px', marginLeft: '-80px',
            borderRadius: '50%',
            pointerEvents: 'none',
            zIndex: 0,
            opacity: 0,
          }} />

          <div key={`hit-${hitKey}`} className={`fighter-character ${hitClass}`} style={{ position: 'relative', width: '110px', height: '200px' }}>

            {/* ── HAIR SPIKES (Goku style — swept back, side profile) ── */}
            {/* Head is at left:43, width:40 → center x≈63. Spikes anchored at x≈50 (rear of head) */}
            <div style={{ position: 'absolute', top: '6px', left: '44px', zIndex: 8 }}>
              {/* Tallest spike — dead centre, pointing straight up */}
              <div style={{ position: 'absolute', width: 0, height: 0,
                borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
                borderBottom: `30px solid ${color}`, top: '-30px', left: '2px' }} />
              {/* Left spike — leans back (away from opponent) */}
              <div style={{ position: 'absolute', width: 0, height: 0,
                borderLeft: '7px solid transparent', borderRight: '7px solid transparent',
                borderBottom: `24px solid ${color}`, top: '-22px', left: '-12px', transform: 'rotate(-30deg)' }} />
              {/* Right spike — leans slightly forward */}
              <div style={{ position: 'absolute', width: 0, height: 0,
                borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
                borderBottom: `20px solid ${color}`, top: '-18px', left: '18px', transform: 'rotate(22deg)' }} />
              {/* Far-right small spike */}
              <div style={{ position: 'absolute', width: 0, height: 0,
                borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                borderBottom: `14px solid ${color}`, top: '-11px', left: '32px', transform: 'rotate(40deg)' }} />
            </div>

            {/* ── HEAD ── */}
            <div className="fighter-head" style={{
              position: 'absolute',
              width: '40px', height: '40px',
              backgroundColor: color,
              borderRadius: '50% 55% 50% 45% / 55% 55% 50% 50%',
              top: '8px', left: '43px', zIndex: 7,
              border: '2px solid rgba(255,255,255,0.28)',
              boxShadow: `0 0 16px ${color}66`,
            }}>
              {!isDead ? (
                <>
                  <div style={{ position: 'absolute', width: '13px', height: '2.5px',
                    backgroundColor: 'rgba(0,0,0,0.45)', top: '9px', right: '5px',
                    transform: 'rotate(-22deg)', borderRadius: '2px' }} />
                  <div style={{ position: 'absolute', width: '10px', height: '10px',
                    backgroundColor: 'white', borderRadius: '50%', top: '14px', right: '5px' }}>
                    <div style={{ width: '6px', height: '6px', backgroundColor: '#111',
                      borderRadius: '50%', position: 'absolute', top: '2px', right: '0.5px' }} />
                  </div>
                </>
              ) : (
                <div style={{ position: 'absolute', top: '11px', right: '5px',
                  color: 'white', fontWeight: 'bold', fontSize: '14px' }}>✕</div>
              )}
            </div>

            {/* ── NECK ── */}
            <div style={{
              position: 'absolute', width: '14px', height: '12px',
              backgroundColor: color, top: '46px', left: '52px', zIndex: 5,
            }} />

            {/* ── BACK ARM ── */}
            <div className="fighter-arm-back" style={{
              position: 'absolute', top: '58px', left: '24px', zIndex: 2,
              transformOrigin: '10px 0px',
            }}>
              <div style={{ width: '13px', height: '33px', backgroundColor: colorBack,
                borderRadius: '6px', transform: 'rotate(14deg)', transformOrigin: 'top center' }} />
              <div className="fighter-forearm-back" style={{
                width: '11px', height: '28px', backgroundColor: colorBack,
                borderRadius: '5px', marginTop: '2px', marginLeft: '2px',
                transform: 'rotate(-10deg)', transformOrigin: 'top center',
              }}>
                <div style={{ width: '15px', height: '12px', backgroundColor: colorBack,
                  borderRadius: '3px', position: 'absolute', bottom: '-8px', left: '-2px' }} />
              </div>
            </div>

            {/* ── TORSO ── */}
            <div className="fighter-torso" style={{
              position: 'absolute',
              width: '48px', height: '54px',
              backgroundColor: color + 'dd',
              top: '56px', left: '32px', zIndex: 4,
              borderRadius: '8px 5px 5px 7px',
              border: '1.5px solid rgba(255,255,255,0.22)',
              boxShadow: `inset 0 2px 8px rgba(255,255,255,0.14), 0 0 12px ${color}33`,
            }}>
              <div style={{ position: 'absolute', bottom: '11px', left: 0, right: 0,
                height: '3px', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: '1px' }} />
            </div>

            {/* ── FRONT ARM ── */}
            <div className="fighter-arm-front" style={{
              position: 'absolute', top: '59px', left: '75px', zIndex: 6,
              transformOrigin: '9px 0px',
            }}>
              <div className="fighter-upper-arm-front" style={{
                width: '14px', height: '34px', backgroundColor: color,
                borderRadius: '6px', transform: 'rotate(-8deg)', transformOrigin: 'top center',
              }} />
              <div className="fighter-forearm-front" style={{
                position: 'relative',
                width: '12px', height: '28px', backgroundColor: color,
                borderRadius: '5px', marginTop: '2px', marginLeft: '1px',
                transform: 'rotate(10deg)', transformOrigin: 'top center',
              }}>
                <div className="fighter-fist" style={{
                  width: '18px', height: '14px', backgroundColor: color,
                  borderRadius: '4px', position: 'absolute', bottom: '-10px', left: '-3px',
                  border: '1px solid rgba(255,255,255,0.35)', zIndex: 7,
                }} />
              </div>
            </div>

            {/* ── FIREBALL ── */}
            <div className="fighter-fireball" style={{
              position: 'absolute', top: '82px', left: '72px',
              width: 0, height: 0, opacity: 0, zIndex: 10,
              borderRadius: '50%', pointerEvents: 'none',
            }} />

            {/* ── BACK LEG ── */}
            <div className="fighter-leg-back" style={{
              position: 'absolute', top: '108px', left: '30px', zIndex: 2,
              transformOrigin: '9px 0px',
            }}>
              <div className="fighter-thigh-back" style={{
                width: '18px', height: '42px', backgroundColor: colorBack,
                borderRadius: '6px', transform: 'rotate(7deg)', transformOrigin: 'top center',
              }} />
              <div className="fighter-shin-back" style={{
                width: '14px', height: '38px', backgroundColor: colorBack,
                borderRadius: '4px 4px 5px 5px', marginTop: '1px', marginLeft: '2px',
                transform: 'rotate(-11deg)', transformOrigin: 'top center',
              }}>
                <div style={{ width: '24px', height: '9px', backgroundColor: colorBack,
                  borderRadius: '2px 5px 5px 2px', position: 'absolute', bottom: '-5px', left: '-3px' }} />
              </div>
            </div>

            {/* ── FRONT LEG ── */}
            <div className="fighter-leg-front" style={{
              position: 'absolute', top: '107px', left: '50px', zIndex: 5,
              transformOrigin: '9px 0px',
            }}>
              <div className="fighter-thigh-front" style={{
                width: '18px', height: '42px', backgroundColor: color,
                borderRadius: '6px', transform: 'rotate(-5deg)', transformOrigin: 'top center',
              }} />
              <div className="fighter-shin-front" style={{
                width: '14px', height: '38px', backgroundColor: color,
                borderRadius: '4px 4px 5px 5px', marginTop: '1px', marginLeft: '2px',
                transform: 'rotate(7deg)', transformOrigin: 'top center',
              }}>
                <div style={{ width: '28px', height: '9px', backgroundColor: color,
                  borderRadius: '2px 6px 6px 2px', position: 'absolute', bottom: '-5px', left: '-1px' }} />
              </div>
            </div>

            {/* ── SHIELD ── */}
            {isDefending && (
              <div className="fighter-shield" style={{
                position: 'absolute',
                top: '38px', left: '86px',
                width: '46px', height: '108px',
                zIndex: 16,
                pointerEvents: 'none',
              }} />
            )}


          </div>
        </div>
      </div>
    </div>
  );
}
