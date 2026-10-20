import classNames from 'classnames';
import {type FC, type ReactNode, memo, useMemo} from 'react';

export const BUBBLE_SIZES = {
  sm: 'h-16 w-16 shrink-0',
  lg: 'h-40 w-40 shrink-0 lg:h-44 lg:w-44 [@media(max-height:620px)]:h-32 [@media(max-height:620px)]:w-32',
} as const;

/** Phone HUD score panel: the score with the best underneath, in one pill that grows with the row. */
export const ScorePill: FC<{score: number; best: number}> = memo(({score, best}) => (
  <div className="mk-bubble mk-bubble-wide h-16 min-w-[7rem] max-w-[13rem] flex-1 px-4">
    <span className="mk-label text-[10px] leading-none">SCORE</span>
    <span className="mk-digits mt-0.5 text-2xl">{score}</span>
    <span className="mk-best mt-1 text-[10px] uppercase leading-none tracking-wider">Best {best}</span>
  </div>
));
ScorePill.displayName = 'ScorePill';

export const NextBubble: FC<{tier: number; src: string; name: string; size: keyof typeof BUBBLE_SIZES}> = memo(
  ({tier, src, name, size}) => {
    const large = size === 'lg';
    const style = useMemo(() => ({transform: `scale(${0.75 + 0.06 * tier})`}), [tier]);
    return (
      <div className={classNames('mk-bubble', BUBBLE_SIZES[size])}>
        <span className={classNames('mk-label leading-none', large ? 'text-lg' : 'text-[10px]')}>Next</span>
        {src && (
          <img
            alt={name}
            className={classNames('mt-1 object-contain', large ? 'h-24 max-w-[80%]' : 'h-9 max-w-[80%]')}
            draggable={false}
            src={src}
            style={style}
          />
        )}
      </div>
    );
  },
);

export const RoundButton: FC<{label: string; onClick: () => void; children: ReactNode}> = memo(
  ({label, onClick, children}) => (
    <button aria-label={label} className="mk-round h-12 w-12 shrink-0" onClick={onClick} title={label} type="button">
      {children}
    </button>
  ),
);
RoundButton.displayName = 'RoundButton';

export const Overlay: FC<{children: ReactNode}> = memo(({children}) => (
  <div className="mk-overlay absolute inset-0 z-30 flex items-center justify-center bg-[rgba(70,40,10,0.35)] backdrop-blur-[1.5px]">
    {children}
  </div>
));
Overlay.displayName = 'Overlay';

/** The "Circle of Evolution": all tiers around a ring, smallest at the top, growing clockwise. */
export const EvolutionRing: FC<{size: number; sources: readonly string[]; names: readonly string[]}> = memo(
  ({size, sources, names}) => {
    const style = useMemo(() => ({width: size, height: size}), [size]);
    const items = useMemo(
      () =>
        sources.map((src, i) => {
          const angle = -Math.PI / 2 + (i / sources.length) * Math.PI * 2;
          const radius = size * 0.4;
          return {
            src,
            name: names[i] ?? `#${i + 1}`,
            style: {
              left: size / 2 + Math.cos(angle) * radius,
              top: size / 2 + Math.sin(angle) * radius,
              height: size * (0.075 + i * 0.013),
              maxWidth: size * 0.16,
              transform: 'translate(-50%, -50%)',
            },
          };
        }),
      [size, sources, names],
    );
    return (
      <div className="relative" style={style}>
        <div className="mk-ring absolute inset-[18%]" />
        <span className="mk-label absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-[10px] leading-tight">
          Circle of
          <br />
          Evolution
        </span>
        {items.map(({src, name, style: s}, i) => (
          <img
            alt={name}
            className="absolute object-contain"
            draggable={false}
            key={i}
            src={src}
            style={s}
            title={name}
          />
        ))}
      </div>
    );
  },
);
EvolutionRing.displayName = 'EvolutionRing';

/* ---------------------------------------------------------------- icons */

export const PauseIcon: FC = memo(() => (
  <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
    <rect height="16" rx="2" width="5" x="5" y="4" />
    <rect height="16" rx="2" width="5" x="14" y="4" />
  </svg>
));
PauseIcon.displayName = 'PauseIcon';

export const PlayIcon: FC = memo(() => (
  <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
    <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z" />
  </svg>
));
PlayIcon.displayName = 'PlayIcon';

const STROKE = {
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  strokeWidth: 2.4,
  viewBox: '0 0 24 24',
} as const;

export const RestartIcon: FC = memo(() => (
  <svg {...STROKE} height="20" strokeWidth="2.6" width="20">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v5h-5" />
  </svg>
));
RestartIcon.displayName = 'RestartIcon';

export const SoundIcon: FC = memo(() => (
  <svg {...STROKE} height="18" width="18">
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19.5 5.5a9 9 0 0 1 0 13" />
  </svg>
));
SoundIcon.displayName = 'SoundIcon';

export const MutedIcon: FC = memo(() => (
  <svg {...STROKE} height="18" width="18">
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
    <path d="M16 9l5 6" />
    <path d="M21 9l-5 6" />
  </svg>
));
MutedIcon.displayName = 'MutedIcon';

export const TrophyIcon: FC = memo(() => (
  <svg {...STROKE} height="18" width="18">
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
    <path d="M8 6H5a1 1 0 0 0-1 1 4 4 0 0 0 4 4" />
    <path d="M16 6h3a1 1 0 0 1 1 1 4 4 0 0 1-4 4" />
    <path d="M12 13v4" />
    <path d="M8 20h8" />
    <path d="M9 17h6l1 3H8l1-3z" fill="currentColor" />
  </svg>
));
TrophyIcon.displayName = 'TrophyIcon';

export const GroupsIcon: FC = memo(() => (
  <svg {...STROKE} height="18" width="18">
    <circle cx="8" cy="8" r="3" />
    <circle cx="16.5" cy="9.5" r="2.5" />
    <path d="M3 19a5 5 0 0 1 10 0" />
    <path d="M13.5 18.5a4 4 0 0 1 7.5-1" />
  </svg>
));
GroupsIcon.displayName = 'GroupsIcon';

export const UploadIcon: FC = memo(() => (
  <svg {...STROKE} height="18" width="18">
    <path d="M12 16V5" />
    <path d="M7 10l5-5 5 5" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </svg>
));
UploadIcon.displayName = 'UploadIcon';
