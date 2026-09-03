import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/design/Icons.jsx';
import { loadProfile, saveProfile } from '../data/designData.js';
import { upsertHandle } from '../lib/profiles.js';
import { getCurrentUser } from '../lib/auth.js';

// "My Profile" — shows the fighter name (editable inline, with an edit pencil and
// a tick to save) and the account email. The name is the same handle used
// everywhere: it lives in localStorage (loadProfile) and mirrors to the server
// (upsertHandle) so the leaderboard shows it. Email is read-only, from the auth
// session — guests are anonymous and have no email.
export default function ProfilePage() {
  const navigate = useNavigate();
  const [handle, setHandle] = useState(() => loadProfile().handle || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(handle);
  const [email, setEmail] = useState(null);
  const [isGuest, setIsGuest] = useState(false);

  // Design tokens (matches HomePage / CharSelectPage).
  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  // Resolve the signed-in account (for the email row).
  useEffect(() => {
    let alive = true;
    getCurrentUser()
      .then(u => {
        if (!alive) return;
        setEmail(u?.email ?? null);
        setIsGuest(!!u?.is_anonymous);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  function startEdit() { setDraft(handle); setEditing(true); }
  function cancelEdit() { setDraft(handle); setEditing(false); }

  function save() {
    const clean = draft.trim();
    if (!clean) return;
    saveProfile({ ...loadProfile(), handle: clean });
    setHandle(clean);
    setEditing(false);
    // Best-effort server mirror so the leaderboard name updates too.
    upsertHandle(clean).catch(() => {});
  }

  const emailText = email || (isGuest ? 'Guest account' : 'Not signed in');

  return (
    <div className="bg-arena profile-page">
      <div className="topbar su-topbar">
        <div className="topbar-brand" onClick={() => navigate('/')}>
          <span>COMBAT<span className="kk">O</span></span>
        </div>
        <span className="topbar-div" />
        <span className="su-topbar-title">
          <Icon name="user" size={16} />
          My Profile
        </span>
        <div className="topbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
          <Icon name="back" size={12} />&nbsp;HOME
        </button>
      </div>

      <div className="profile-main">
        <div className="profile-card">
          <div className="profile-avatar"><Icon name="user" size={34} /></div>

          <div className="profile-fields">
          <div className="profile-field">
            <span className="profile-field-label">Fighter name</span>
            {editing ? (
              <div className="profile-value-row is-editing">
                <input
                  className="profile-input"
                  value={draft}
                  autoFocus
                  maxLength={16}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save();
                    else if (e.key === 'Escape') cancelEdit();
                  }}
                  aria-label="Fighter name"
                />
                <button
                  className="profile-iconbtn is-save"
                  onClick={save}
                  disabled={!draft.trim()}
                  aria-label="Save name"
                  title="Save"
                >
                  <Icon name="check" size={16} />
                </button>
                <button className="profile-iconbtn" onClick={cancelEdit} aria-label="Cancel" title="Cancel">
                  <Icon name="close" size={15} />
                </button>
              </div>
            ) : (
              <div className="profile-value-row">
                <span className="profile-value">{handle || 'Unnamed'}</span>
                <button className="profile-iconbtn" onClick={startEdit} aria-label="Edit name" title="Edit">
                  <Icon name="edit" size={15} />
                </button>
              </div>
            )}
          </div>

          <div className="profile-field">
            <span className="profile-field-label">Email</span>
            <div className="profile-value-row">
              <span className="profile-value profile-value-muted">{emailText}</span>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
