import classNames from 'classnames';
import {type ChangeEvent, type FC, memo, useCallback} from 'react';

import {type ScoreEntry, MAX_NAME_LENGTH, rankOf} from '@/game/leaderboard';

import {Overlay} from './hud';

const dateLabel = (at: number) => new Date(at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});

/** Ranked rows; the row for `highlightId` (this run) is outlined. */
export const LeaderboardList: FC<{entries: ScoreEntry[]; highlightId: string | null; limit: number; dense?: boolean}> =
  memo(({entries, highlightId, limit, dense}) => (
    <ol className={classNames('flex flex-col', dense ? 'gap-1' : 'gap-1.5')}>
      {entries.length === 0 && <li className="mk-best py-2 text-center text-xs">no runs yet — evolve to the top!</li>}
      {entries.slice(0, limit).map((e, i) => (
        <li
          className={classNames(
            'flex items-center gap-2 rounded-full px-3',
            dense ? 'py-0.5' : 'py-1',
            i < 3 ? `mk-rank-${i + 1}` : 'bg-white/50',
            e.id === highlightId && 'mk-rank-now',
          )}
          key={e.id}>
          <span className={classNames('w-7 shrink-0 font-bold', dense ? 'text-xs' : 'text-sm')}>#{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">
            <span className={classNames('font-bold', dense ? 'text-xs' : 'text-sm')}>{e.name}</span>
            {!dense && (
              <span className="mk-best ml-2 text-[10px]">
                {e.group || 'Original'} · {dateLabel(e.at)}
              </span>
            )}
          </span>
          <span className={classNames('mk-best shrink-0', dense ? 'text-sm' : 'text-base')}>{e.score}</span>
        </li>
      ))}
    </ol>
  ));
LeaderboardList.displayName = 'LeaderboardList';

/** Compact card for the desktop side column: top five plus the live score. */
export const LeaderboardCard: FC<{
  entries: ScoreEntry[];
  highlightId: string | null;
  score: number;
  onOpen: () => void;
}> = memo(({entries, highlightId, score, onOpen}) => {
  const rank = highlightId ? rankOf(entries, highlightId) : 0;
  return (
    <div className="mk-card w-full overflow-hidden text-sm">
      <button
        className="mk-banner block w-full py-1 text-center text-base"
        onClick={onOpen}
        title="Open the leaderboard"
        type="button">
        Leaderboard
      </button>
      <div className="p-2">
        <LeaderboardList dense entries={entries} highlightId={highlightId} limit={5} />
        <div className="mt-1 flex items-center justify-between rounded-full bg-white/60 px-3 py-1">
          <span className="text-xs font-bold">{rank > 0 ? `#${rank}` : 'NOW'}</span>
          <span className="mk-best text-base">{score}</span>
        </div>
      </div>
    </div>
  );
});
LeaderboardCard.displayName = 'LeaderboardCard';

/** Player-name input used on the game-over card; the caller renames the recorded entry live. */
export const NameField: FC<{value: string; onChange: (name: string) => void}> = memo(({value, onChange}) => {
  const handle = useCallback((e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value), [onChange]);
  return (
    <label className="flex w-full items-center gap-2 text-sm">
      <span className="mk-best shrink-0 text-xs uppercase tracking-wider">Name</span>
      <input
        aria-label="Your name for the leaderboard"
        autoComplete="nickname"
        className="mk-input min-w-0 flex-1"
        maxLength={MAX_NAME_LENGTH}
        onChange={handle}
        placeholder="Anonymous"
        type="text"
        value={value}
      />
    </label>
  );
});
NameField.displayName = 'NameField';

export const LeaderboardModal: FC<{entries: ScoreEntry[]; highlightId: string | null; onClose: () => void}> = memo(
  ({entries, highlightId, onClose}) => (
    <Overlay>
      <div className="mk-card mk-pop flex max-h-full w-full max-w-lg flex-col overflow-hidden">
        <div className="mk-banner py-2 text-center text-2xl">Leaderboard</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <LeaderboardList entries={entries} highlightId={highlightId} limit={50} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#f1d5a4] p-3">
          <span className="mk-best text-xs">Scores are kept on this device.</span>
          <button className="mk-pill mk-pill-primary px-8 py-1.5 text-base" onClick={onClose} type="button">
            Back
          </button>
        </div>
      </div>
    </Overlay>
  ),
);
LeaderboardModal.displayName = 'LeaderboardModal';
