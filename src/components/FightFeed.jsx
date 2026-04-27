import { useEffect, useRef } from 'react';

export default function FightFeed({ entries = [], fighterAColor = '#818cf8', fighterBColor = '#f472b6' }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div
      className="bg-gray-900 rounded-xl overflow-y-auto font-mono"
      style={{ height: '200px', fontSize: '11px', lineHeight: '1.6' }}
    >
      <div className="p-2 space-y-0.5">
        {entries.length === 0 && (
          <div className="text-gray-600 text-center py-4">Fight feed will appear here...</div>
        )}
        {entries.map(entry => (
          <div
            key={entry.id}
            className={[
              'px-2 py-0.5 rounded',
              entry.isBatchSeparator ? 'text-gray-400 text-center border-t border-gray-700 mt-1 pt-1' : '',
              entry.highlight ? 'bg-red-900/40 text-red-300 font-bold text-sm' : ''
            ].join(' ')}
            style={{
              color: entry.isBatchSeparator || entry.highlight
                ? undefined
                : entry.fighter === 'A' ? fighterAColor
                : entry.fighter === 'B' ? fighterBColor
                : '#6b7280'
            }}
          >
            {entry.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
