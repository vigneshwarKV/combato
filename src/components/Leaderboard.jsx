import { useEffect, useState } from 'react';
import Icon from './design/Icons.jsx';
import { fetchLeaderboard } from '../lib/leaderboard.js';
import { getCurrentUser } from '../lib/auth.js';

// Global leaderboard panel (rendered inside the shared Modal). Daily / Weekly
// windows come straight from the get_leaderboard RPC; the signed-in player's own
// row is highlighted.
export default function Leaderboard() {
  const [period, setPeriod] = useState('daily');
  const [rows, setRows] = useState(null); // null = still loading
  const [uid, setUid] = useState(null);
  const loading = rows === null;

  useEffect(() => {
    getCurrentUser().then((u) => setUid(u?.id ?? null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard(period).then((data) => {
      if (!cancelled) setRows(data);
    });
    return () => { cancelled = true; };
  }, [period]);

  return (
    <div className="lb">
      <h2><Icon name="trophy" size={20} />&nbsp;Leaderboard</h2>

      <div className="tabs">
        <button className={`tab ${period === 'daily' ? 'active' : ''}`} onClick={() => setPeriod('daily')}>Today</button>
        <button className={`tab ${period === 'weekly' ? 'active' : ''}`} onClick={() => setPeriod('weekly')}>This Week</button>
      </div>

      {loading ? (
        <div className="lb-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="lb-empty">No scores yet — play a match to get on the board.</div>
      ) : (
        <ol className="lb-list">
          {rows.map((r) => (
            <li key={r.user_id} className={`lb-row ${r.user_id === uid ? 'me' : ''}`}>
              <span className="lb-rank">{r.rank}</span>
              <span className="lb-handle">{r.handle}{r.user_id === uid ? ' (you)' : ''}</span>
              <span className="lb-score">{r.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
