import classNames from 'classnames';
import {
  type CSSProperties,
  type FC,
  type PointerEvent as ReactPointerEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {Sfx} from '@/game/audio';
import {type Phase, MambokaEngine} from '@/game/engine';
import {
  type ActiveGroup,
  type GroupMeta,
  DEFAULT_GROUP_ID,
  defaultGroup,
  deleteGroup,
  listGroups,
  readSelectedGroupId,
  resolveGroup,
  saveGroup,
  saveSelectedGroupId,
} from '@/game/groups';
import {
  type ScoreEntry,
  readLeaderboard,
  readPlayerName,
  recordScore,
  renameEntry,
  savePlayerName,
} from '@/game/leaderboard';
import {Renderer} from '@/game/renderer';
import {DROPPABLE_TIERS, MAMBO_CANCEL_POINTS, TIERS} from '@/game/roster';
import {type TierShape, loadShapes} from '@/game/shapes';

import {GroupsModal} from './Groups';
import {
  Bubble,
  EvolutionRing,
  GroupsIcon,
  MutedIcon,
  NextBubble,
  Overlay,
  PauseIcon,
  PlayIcon,
  RestartIcon,
  RoundButton,
  SoundIcon,
  TrophyIcon,
} from './hud';
import {LeaderboardCard, LeaderboardModal, NameField} from './Leaderboard';

const BEST_KEY = 'mamboka.best';
/** Keyboard aiming speed, world units per ms. */
const KEY_SPEED = 0.55;

const readBest = (): number => {
  const raw = Number(localStorage.getItem(BEST_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

/** A character group together with its traced silhouettes, ready for the engine. */
interface Active {
  group: ActiveGroup;
  shapes: TierShape[];
}

type Modal = 'help' | 'groups' | 'leaderboard' | null;

interface MambokaGameProps {
  /** CSS font-family of the display font (also used for canvas text). */
  fontFamily: string;
}

const MambokaGame: FC<MambokaGameProps> = memo(({fontFamily}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MambokaEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const keysRef = useRef({left: false, right: false});
  const pointerRef = useRef<{id: number} | null>(null);
  const hudRefs = useRef<{
    header: HTMLElement | null;
    footer: HTMLElement | null;
    left: HTMLElement | null;
    right: HTMLElement | null;
  }>({
    header: null,
    footer: null,
    left: null,
    right: null,
  });
  const setHeaderRef = useCallback((el: HTMLElement | null) => void (hudRefs.current.header = el), []);
  const setFooterRef = useCallback((el: HTMLElement | null) => void (hudRefs.current.footer = el), []);
  const setLeftRef = useCallback((el: HTMLElement | null) => void (hudRefs.current.left = el), []);
  const setRightRef = useCallback((el: HTMLElement | null) => void (hudRefs.current.right = el), []);

  const [active, setActive] = useState<Active | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customGroups, setCustomGroups] = useState<GroupMeta[]>([]);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [next, setNext] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [muted, setMuted] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [overCard, setOverCard] = useState(false);
  const [board, setBoard] = useState<ScoreEntry[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);

  // The 'over' handler is bound once per engine; it reads the current name and group from refs.
  const playerNameRef = useRef('');
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;

  /* ------------------------------------------------------------ character groups */

  const activationRef = useRef(0);
  /** Loads a group (falling back to the original cast) and traces its silhouettes; a new engine follows. */
  const activate = useCallback(async (id: string) => {
    const token = ++activationRef.current;
    setLoading(true);
    setLoadError(null);
    let group: ActiveGroup | null = null;
    try {
      if (id !== DEFAULT_GROUP_ID) {
        const meta = (await listGroups()).find(g => g.id === id);
        group = meta ? await resolveGroup(meta) : null;
      }
      group ??= defaultGroup();
      const shapes = await loadShapes(group.sources);
      if (token !== activationRef.current) {
        group.release();
        return;
      }
      activeRef.current?.group.release();
      saveSelectedGroupId(group.id);
      setLastEntryId(null);
      setOverCard(false);
      setActive({group, shapes});
    } catch (err) {
      group?.release();
      if (token === activationRef.current) setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (token === activationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const name = readPlayerName();
    setPlayerName(name);
    playerNameRef.current = name;
    setBoard(readLeaderboard());
    listGroups()
      .then(setCustomGroups)
      .catch((err: unknown) => console.warn('Mamboka: custom groups unavailable', err));
    void activate(readSelectedGroupId());
  }, [activate]);

  const refreshGroups = useCallback(async () => setCustomGroups(await listGroups()), []);

  const playDefault = useCallback(() => void activate(DEFAULT_GROUP_ID), [activate]);

  /* ------------------------------------------------------------ engine lifecycle */

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!active || !canvas || !stage) return;
    const {group, shapes} = active;

    // Only the original cast has voice lines; uploads keep the synthesised pops and jingles.
    const sfx = new Sfx(group.voices);
    sfxRef.current = sfx;
    setMuted(sfx.muted);

    const storedBest = readBest();
    setBest(storedBest);
    setScore(0);

    const engine = new MambokaEngine(shapes, storedBest);
    const colors = group.isDefault ? TIERS.map(t => t.color) : shapes.map(s => s.tint);
    const renderer = new Renderer(canvas, shapes, engine, fontFamily, colors);
    engineRef.current = engine;
    rendererRef.current = renderer;
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as {__mamboka?: MambokaEngine}).__mamboka = engine;
    }
    setNext(engine.next);
    setPhase(engine.phase);

    const offs = [
      engine.on('score', e => {
        setScore(e.score);
        setBest(e.best);
        localStorage.setItem(BEST_KEY, String(e.best));
      }),
      engine.on('hold', e => setNext(e.next)),
      engine.on('phase', e => setPhase(e.phase)),
      engine.on('drop', () => sfx.drop()),
      engine.on('land', e => sfx.land(e.tier)),
      engine.on('merge', e => {
        const now = performance.now();
        renderer.burst(e.x, e.y, e.tier, now);
        renderer.popup(e.x, e.y - 30, `+${e.points}`, now);
        if (e.piece) {
          renderer.markSpawn(e.piece.id, now);
          sfx.merge(e.tier);
        } else {
          sfx.cancel();
        }
      }),
      engine.on('over', e => {
        sfx.gameOver();
        if (e.score > 0) {
          const entry = recordScore(playerNameRef.current, e.score, group.title);
          setBoard(readLeaderboard());
          setLastEntryId(entry.id);
        }
        window.setTimeout(() => setOverCard(true), 900);
      }),
    ];

    // The canvas spans the whole page (so the wood/gingham backdrop is continuous under the HUD);
    // the world itself is fitted into the area the HUD overlays leave free.
    const fit = () => {
      const insets = {
        top: hudRefs.current.header?.offsetHeight ?? 0,
        bottom: hudRefs.current.footer?.offsetHeight ?? 0,
        left: hudRefs.current.left?.offsetWidth ?? 0,
        right: hudRefs.current.right?.offsetWidth ?? 0,
      };
      renderer.resize(stage.clientWidth, stage.clientHeight, window.devicePixelRatio || 1, insets);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    fit();

    let raf = 0;
    let last = performance.now();
    const frame = () => {
      // Effects are stamped with performance.now(), so the loop uses the same clock rather than the
      // rAF timestamp (which can trail it by a frame or more after a long task).
      const now = performance.now();
      const dt = Math.min(now - last, 100);
      last = now;
      const keys = keysRef.current;
      if (keys.left !== keys.right) engine.nudge((keys.right ? 1 : -1) * KEY_SPEED * dt);
      engine.update(dt);
      renderer.render(now, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      offs.forEach(off => off());
      sfx.stopVoices();
      engine.destroy();
      engineRef.current = null;
      rendererRef.current = null;
      sfxRef.current = null;
    };
  }, [active, fontFamily]);

  /* ------------------------------------------------------------ controls */

  const restart = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    sfxRef.current?.unlock();
    sfxRef.current?.stopVoices();
    sfxRef.current?.click();
    engine.reset();
    rendererRef.current?.clearEffects();
    setOverCard(false);
    setModal(null);
    setLastEntryId(null);
  }, []);

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    sfxRef.current?.unlock();
    sfxRef.current?.click();
    if (engine.phase === 'paused') engine.resume();
    else engine.pause();
  }, []);

  const resume = useCallback(() => {
    sfxRef.current?.click();
    engineRef.current?.resume();
    setModal(null);
  }, []);

  // A modal pauses a running game and resumes it on close; a game the player paused stays paused.
  const modalPausedRef = useRef(false);
  const openModal = useCallback((kind: Exclude<Modal, null>) => {
    sfxRef.current?.unlock();
    sfxRef.current?.click();
    const engine = engineRef.current;
    if (engine?.phase === 'ready') modalPausedRef.current = true;
    engine?.pause();
    setModal(kind);
  }, []);
  const openHelp = useCallback(() => openModal('help'), [openModal]);
  const openGroups = useCallback(() => openModal('groups'), [openModal]);
  const openLeaderboard = useCallback(() => openModal('leaderboard'), [openModal]);

  const closeModal = useCallback(() => {
    sfxRef.current?.click();
    setModal(null);
    if (modalPausedRef.current) engineRef.current?.resume();
    modalPausedRef.current = false;
  }, []);

  const toggleMute = useCallback(() => {
    const sfx = sfxRef.current;
    if (!sfx) return;
    sfx.unlock();
    sfx.setMuted(!sfx.muted);
    setMuted(sfx.muted);
    if (!sfx.muted) sfx.click();
  }, []);

  const changeName = useCallback(
    (name: string) => {
      setPlayerName(name);
      playerNameRef.current = name;
      savePlayerName(name);
      if (lastEntryId) setBoard(renameEntry(lastEntryId, name));
    },
    [lastEntryId],
  );

  const selectGroup = useCallback(
    (id: string) => {
      sfxRef.current?.click();
      setModal(null);
      modalPausedRef.current = false;
      void activate(id);
    },
    [activate],
  );

  const saveCustomGroup = useCallback(
    async (meta: GroupMeta, images: Blob[]) => {
      await saveGroup(meta, images);
      await refreshGroups();
      // A new group is played right away; edits to the current group reload it.
      const isNew = !customGroups.some(g => g.id === meta.id);
      if (isNew || activeRef.current?.group.id === meta.id) selectGroup(meta.id);
    },
    [customGroups, refreshGroups, selectGroup],
  );

  const removeCustomGroup = useCallback(
    async (id: string) => {
      await deleteGroup(id);
      await refreshGroups();
      if (activeRef.current?.group.id === id) selectGroup(DEFAULT_GROUP_ID);
    },
    [refreshGroups, selectGroup],
  );

  // Pointer aiming: hover/drag moves Poppy, release (or a tap) drops at that x.
  const aim = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    const renderer = rendererRef.current;
    if (!engine || !renderer) return;
    const rect = e.currentTarget.getBoundingClientRect();
    engine.moveTo(renderer.toWorldX(e.clientX - rect.left));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!e.isPrimary) return;
      // Only a mouse pointerdown grants user activation; a touch one does not, so unlocking
      // there would leave the AudioContext suspended (see onPointerUp).
      if (e.pointerType === 'mouse') sfxRef.current?.unlock();
      pointerRef.current = {id: e.pointerId};
      e.currentTarget.setPointerCapture(e.pointerId);
      aim(e);
    },
    [aim],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (pointerRef.current ? pointerRef.current.id === e.pointerId : e.pointerType === 'mouse') aim(e);
    },
    [aim],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (pointerRef.current?.id !== e.pointerId) return;
      pointerRef.current = null;
      // pointerup/touchend is the first activation-triggering event of a tap or drag on phones.
      sfxRef.current?.unlock();
      aim(e);
      engineRef.current?.drop();
    },
    [aim],
  );

  const onPointerCancel = useCallback(() => {
    pointerRef.current = null;
  }, []);

  // Keyboard: arrows aim, space/down drops, P pauses, R restarts, D shows silhouettes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine || e.metaKey || e.ctrlKey || e.altKey) return;
      // Typing a name or a group title must not drop characters or restart the game.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'ArrowLeft':
          keysRef.current.left = true;
          e.preventDefault();
          break;
        case 'ArrowRight':
          keysRef.current.right = true;
          e.preventDefault();
          break;
        case ' ':
        case 'ArrowDown':
        case 'Enter':
          if (modal) break;
          e.preventDefault();
          sfxRef.current?.unlock();
          engine.drop();
          break;
        case 'p':
        case 'P':
        case 'Escape':
          if (modal) closeModal();
          else if (engine.phase !== 'over') togglePause();
          break;
        case 'r':
        case 'R':
          if (!modal) restart();
          break;
        case 'd':
        case 'D':
          setDebug(d => !d);
          break;
        default:
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') keysRef.current.left = false;
      if (e.key === 'ArrowRight') keysRef.current.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [closeModal, modal, restart, togglePause]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.debug = debug;
  }, [debug, active]);

  // Pause when the tab is hidden so the physics does not run away.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) engineRef.current?.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /* ------------------------------------------------------------ render */

  const rootStyle = useMemo(() => ({fontFamily}), [fontFamily]);
  const group = active?.group ?? null;
  const sources = group?.sources ?? EMPTY;
  const names = group?.names ?? EMPTY;
  const showPause = phase === 'paused' && modal === null;

  return (
    <div className="mamboka relative h-dvh w-full overflow-hidden bg-[#c9884a]" ref={stageRef} style={rootStyle}>
      <canvas
        aria-label="Mamboka play field"
        className={classNames(
          'absolute inset-0 h-full w-full',
          phase === 'ready' ? 'cursor-crosshair' : 'cursor-default',
        )}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={canvasRef}
        role="application"
      />
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-[#fff5e2]">
          <span className="mk-banner animate-pulse rounded-full px-4 py-1 text-sm">tracing silhouettes…</span>
        </div>
      )}
      {loadError && (
        <Overlay>
          <div className="mk-card mk-pop w-full max-w-sm overflow-hidden text-center">
            <div className="mk-banner py-2 text-xl">Could not load characters</div>
            <div className="flex flex-col gap-3 p-5 text-sm">
              <p>{loadError}</p>
              <button className="mk-pill mk-pill-primary py-2 text-base" onClick={playDefault} type="button">
                Use the original characters
              </button>
              <button className="mk-pill mk-pill-secondary py-2 text-base" onClick={openGroups} type="button">
                Manage groups
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* Portrait HUD (phones): one row across the top, like the Aladdin X mobile version. */}
      <header
        className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden"
        ref={setHeaderRef}>
        <Bubble label="BEST SCORE" size="sm" value={best} />
        <Bubble label="SCORE" size="sm" value={score} />
        <NextBubble name={names[next] ?? ''} size="sm" src={sources[next] ?? ''} tier={next} />
        <RoundButton label={phase === 'paused' ? 'Resume' : 'Pause'} onClick={togglePause} size="sm">
          {phase === 'paused' ? <PlayIcon /> : <PauseIcon />}
        </RoundButton>
        <RoundButton label="Restart" onClick={restart} size="sm">
          <RestartIcon />
        </RoundButton>
      </header>

      {/* Landscape HUD (desktop): score + leaderboard on the left, Next + evolution ring on the right, like the Switch layout. */}
      <aside
        className="absolute inset-y-0 left-0 z-10 hidden w-56 flex-col items-center justify-center gap-6 px-4 md:flex lg:w-64 [@media(max-height:620px)]:gap-3"
        ref={setLeftRef}>
        <div className="mk-bubble h-44 w-44 shrink-0 lg:h-52 lg:w-52 [@media(max-height:620px)]:h-36 [@media(max-height:620px)]:w-36">
          <span className="mk-label text-lg">Score</span>
          <span className="mk-digits text-4xl lg:text-5xl">{score}</span>
          <span className="mk-best mt-2 text-[10px] uppercase tracking-wider">Best score</span>
          <span className="mk-best text-base">{best}</span>
        </div>
        <div className="w-full [@media(max-height:620px)]:hidden">
          <LeaderboardCard entries={board} highlightId={lastEntryId} onOpen={openLeaderboard} score={score} />
        </div>
      </aside>

      <aside
        className="absolute inset-y-0 right-0 z-10 hidden w-56 flex-col items-center justify-center gap-5 px-4 md:flex lg:w-64 [@media(max-height:620px)]:gap-3"
        ref={setRightRef}>
        <NextBubble name={names[next] ?? ''} size="lg" src={sources[next] ?? ''} tier={next} />
        <div className="[@media(max-height:620px)]:hidden">
          <EvolutionRing names={names} size={200} sources={sources} />
        </div>
        <button
          className="mk-label max-w-full truncate text-xs hover:underline"
          onClick={openGroups}
          title="Change characters"
          type="button">
          {group?.title ?? '…'}
        </button>
        <div className="flex max-w-[11.5rem] flex-wrap justify-center gap-3">
          <RoundButton label={phase === 'paused' ? 'Resume' : 'Pause'} onClick={togglePause} size="md">
            {phase === 'paused' ? <PlayIcon /> : <PauseIcon />}
          </RoundButton>
          <RoundButton label="Restart" onClick={restart} size="md">
            <RestartIcon />
          </RoundButton>
          <RoundButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} size="md">
            {muted ? <MutedIcon /> : <SoundIcon />}
          </RoundButton>
          <RoundButton label="Characters" onClick={openGroups} size="md">
            <GroupsIcon />
          </RoundButton>
          <RoundButton label="Leaderboard" onClick={openLeaderboard} size="md">
            <TrophyIcon />
          </RoundButton>
          <RoundButton label="How to play" onClick={openHelp} size="md">
            <span className="text-xl font-bold">?</span>
          </RoundButton>
        </div>
        <p className="mk-label text-center text-xs leading-relaxed">
          ← → aim · space drops
          <br />P pause · R restart
        </p>
      </aside>

      {/* Phones: sound, help, characters and leaderboard tucked under the play field. */}
      <footer
        className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 md:hidden"
        ref={setFooterRef}>
        <RoundButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} size="xs">
          {muted ? <MutedIcon /> : <SoundIcon />}
        </RoundButton>
        <RoundButton label="Characters" onClick={openGroups} size="xs">
          <GroupsIcon />
        </RoundButton>
        <RoundButton label="Leaderboard" onClick={openLeaderboard} size="xs">
          <TrophyIcon />
        </RoundButton>
        <RoundButton label="How to play" onClick={openHelp} size="xs">
          <span className="text-base font-bold">?</span>
        </RoundButton>
        <span className="mk-label min-w-0 truncate text-xs">{group?.title ?? '…'} · drag, release to drop</span>
      </footer>

      {showPause && (
        <Overlay>
          <div className="mk-card mk-pop w-72 overflow-hidden text-center">
            <div className="mk-banner py-2 text-2xl">Paused</div>
            <div className="flex flex-col gap-3 p-5">
              <button className="mk-pill mk-pill-primary py-2 text-lg" onClick={resume} type="button">
                Resume
              </button>
              <button className="mk-pill mk-pill-secondary py-2 text-lg" onClick={openGroups} type="button">
                Characters
              </button>
              <button className="mk-pill mk-pill-secondary py-2 text-lg" onClick={openLeaderboard} type="button">
                Leaderboard
              </button>
              <button className="mk-pill mk-pill-secondary py-2 text-lg" onClick={openHelp} type="button">
                How to play
              </button>
              <button className="mk-pill mk-pill-secondary py-2 text-lg" onClick={restart} type="button">
                Restart
              </button>
            </div>
          </div>
        </Overlay>
      )}
      {modal === 'help' && <HelpCard names={names} onClose={closeModal} sources={sources} />}
      {modal === 'leaderboard' && <LeaderboardModal entries={board} highlightId={lastEntryId} onClose={closeModal} />}
      {modal === 'groups' && (
        <GroupsModal
          activeId={group?.id ?? DEFAULT_GROUP_ID}
          defaultThumbs={DEFAULT_THUMBS}
          groups={customGroups}
          onClose={closeModal}
          onDelete={removeCustomGroup}
          onSave={saveCustomGroup}
          onSelect={selectGroup}
        />
      )}
      {phase === 'over' && overCard && modal === null && (
        <GameOverCard
          best={best}
          board={board}
          lastEntryId={lastEntryId}
          names={names}
          onHelp={openHelp}
          onLeaderboard={openLeaderboard}
          onName={changeName}
          onRestart={restart}
          playerName={playerName}
          score={score}
          sources={sources}
        />
      )}
    </div>
  );
});
MambokaGame.displayName = 'MambokaGame';

export default MambokaGame;

const EMPTY: readonly string[] = [];
const DEFAULT_THUMBS: string[] = [];
for (const t of TIERS) DEFAULT_THUMBS.push(t.src);

/* ---------------------------------------------------------------- cards */

const HELP_ROW_STYLES: CSSProperties[] = [];
for (let i = 0; i < TIERS.length; i++) HELP_ROW_STYLES.push({height: 24 + i * 6, maxWidth: 40 + i * 4});

const HelpCard: FC<{sources: readonly string[]; names: readonly string[]; onClose: () => void}> = memo(
  ({sources, names, onClose}) => {
    const last = names[names.length - 1] ?? 'Mambo';
    return (
      <Overlay>
        <div className="mk-card mk-pop max-h-full w-full max-w-2xl overflow-y-auto">
          <div className="mk-banner py-2 text-center text-2xl">How to play</div>
          <div className="flex flex-col gap-4 p-5 text-sm leading-relaxed md:text-base">
            <p>
              There are {TIERS.length} characters in total. Drop them into the box; when two of the same kind touch,
              they evolve into the next one. Evolve all the way to <b>{last}</b> so you can fit more in the box.
            </p>
            <div className="flex items-end justify-center gap-1 overflow-x-auto py-2">
              {sources.map((src, i) => (
                <img
                  alt={names[i] ?? ''}
                  className="shrink-0 object-contain"
                  draggable={false}
                  key={i}
                  src={src}
                  style={HELP_ROW_STYLES[i]}
                  title={names[i] ?? ''}
                />
              ))}
            </div>
            <div className="h-2 rounded-full bg-gradient-to-r from-[#f7b27c] via-[#fde28a] to-[#9ad46c]" />
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Only the {DROPPABLE_TIERS} smallest characters fall from Poppy the cloud; the Next bubble shows what
                comes after.
              </li>
              <li>
                Points per evolution:{' '}
                {TIERS.slice(1)
                  .map(t => t.points)
                  .join(', ')}
                . Two of the biggest cancel out for {MAMBO_CANCEL_POINTS}.
              </li>
              <li>The characters stack by their real silhouettes, not boxes, so they nestle into each other.</li>
              <li>If a character settles above the rim of the box, it is game over.</li>
              <li>
                Touch: drag Poppy and release, or tap where you want to drop. Keyboard: ← → aim, space drops, P pauses,
                R restarts.
              </li>
              <li>
                <b>Characters</b> lets you upload your own eleven (smallest → biggest) and save them as a group;
                <b> Leaderboard</b> keeps named scores on this device.
              </li>
            </ul>
            <p className="mk-best text-xs">A parody of Suika Game (Aladdin X). {last} is the watermelon.</p>
            <button className="mk-pill mk-pill-primary self-center px-10 py-2 text-lg" onClick={onClose} type="button">
              Back
            </button>
          </div>
        </div>
      </Overlay>
    );
  },
);
HelpCard.displayName = 'HelpCard';

const GameOverCard: FC<{
  score: number;
  best: number;
  board: ScoreEntry[];
  lastEntryId: string | null;
  playerName: string;
  sources: readonly string[];
  names: readonly string[];
  onName: (name: string) => void;
  onRestart: () => void;
  onHelp: () => void;
  onLeaderboard: () => void;
}> = memo(({score, best, board, lastEntryId, playerName, sources, names, onName, onRestart, onHelp, onLeaderboard}) => {
  const rank = lastEntryId ? board.findIndex(e => e.id === lastEntryId) + 1 : 0;
  const isBest = score > 0 && score >= best;
  return (
    <Overlay>
      <div className="mk-card mk-pop flex max-h-full w-full max-w-md flex-col overflow-hidden">
        <div className="mk-banner py-2 text-center text-3xl">Game over</div>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-4 sm:p-5">
          <div className="mk-bubble h-36 w-36 shrink-0">
            <span className="mk-label text-base">Score</span>
            <span className="mk-digits text-4xl">{score}</span>
            <span className="mk-best mt-2 text-[10px] uppercase tracking-wider">Best score</span>
            <span className="mk-best text-base">{best}</span>
          </div>
          {isBest && <div className="mk-banner rounded-full px-4 py-1 text-sm">\ New best score! /</div>}
          {lastEntryId && (
            <>
              <NameField onChange={onName} value={playerName} />
              <button className="mk-best text-sm hover:underline" onClick={onLeaderboard} type="button">
                Ranked <b>#{rank}</b> on this device — see the leaderboard
              </button>
            </>
          )}
          <div className="[@media(max-height:700px)]:hidden">
            <EvolutionRing names={names} size={160} sources={sources} />
          </div>
        </div>
        <div className="flex gap-3 border-t border-[#f1d5a4] p-3">
          <button className="mk-pill mk-pill-secondary flex-1 py-2 text-lg" onClick={onHelp} type="button">
            How to play
          </button>
          <button className="mk-pill mk-pill-primary flex-1 py-2 text-lg" onClick={onRestart} type="button">
            Restart
          </button>
        </div>
      </div>
    </Overlay>
  );
});
GameOverCard.displayName = 'GameOverCard';
