import classNames from 'classnames';
import {
  type ChangeEvent,
  type CSSProperties,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type GroupMeta,
  DEFAULT_GROUP_ID,
  DEFAULT_GROUP_TITLE,
  importImage,
  loadGroupImages,
  MAX_TITLE_LENGTH,
  newGroupId,
  SLOT_COUNT,
} from '@/game/groups';

import {GroupsIcon, Overlay, UploadIcon} from './hud';

interface Slot {
  blob: Blob;
  url: string;
  thumb: string;
  name: string;
}

interface Draft {
  id: string | null;
  createdAt: number;
  title: string;
  slots: Array<Slot | null>;
}

const emptyDraft = (): Draft => ({
  id: null,
  createdAt: Date.now(),
  title: '',
  slots: Array.from({length: SLOT_COUNT}, () => null),
});

const byName = (a: File, b: File) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});

export interface GroupsModalProps {
  activeId: string;
  groups: GroupMeta[];
  defaultThumbs: readonly string[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onSave: (meta: GroupMeta, images: Blob[]) => Promise<void>;
}

/** Lists the built-in roster and every saved group; hosts the editor for new/edited groups. */
export const GroupsModal: FC<GroupsModalProps> = memo(
  ({activeId, groups, defaultThumbs, onClose, onSelect, onDelete, onSave}) => {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Object URLs created for previews; revoked when the editor closes.
    const urlsRef = useRef<string[]>([]);

    const releaseUrls = useCallback(() => {
      urlsRef.current.forEach(url => URL.revokeObjectURL(url));
      urlsRef.current = [];
    }, []);
    useEffect(() => releaseUrls, [releaseUrls]);

    const startNew = useCallback(() => {
      setError(null);
      setDraft(emptyDraft());
    }, []);

    const startEdit = useCallback(
      async (id: string) => {
        const meta = groups.find(g => g.id === id);
        if (!meta) return;
        setBusy(true);
        setError(null);
        try {
          const images = await loadGroupImages(id);
          if (!images) throw new Error('This group is missing its images.');
          const slots = images.map((blob, i) => {
            const url = URL.createObjectURL(blob);
            urlsRef.current.push(url);
            return {blob, url, thumb: meta.thumbs[i] ?? '', name: meta.names[i] ?? `Character ${i + 1}`};
          });
          setDraft({id, createdAt: meta.createdAt, title: meta.title, slots});
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      },
      [groups],
    );

    const cancelEdit = useCallback(() => {
      releaseUrls();
      setDraft(null);
      setError(null);
    }, [releaseUrls]);

    const setTitle = useCallback((e: ChangeEvent<HTMLInputElement>) => {
      const title = e.target.value;
      setDraft(d => (d ? {...d, title} : d));
    }, []);

    const placeFiles = useCallback(async (files: File[], from: number) => {
      setBusy(true);
      setError(null);
      try {
        const imported = await Promise.all(files.map(importImage));
        setDraft(d => {
          if (!d) return d;
          const slots = d.slots.slice();
          imported.forEach((img, i) => {
            const at = from + i;
            if (at >= SLOT_COUNT) return;
            const url = URL.createObjectURL(img.blob);
            urlsRef.current.push(url);
            slots[at] = {blob: img.blob, url, thumb: img.thumb, name: img.name};
          });
          return {...d, slots};
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }, []);

    const pickOne = useCallback((index: number, file: File) => void placeFiles([file], index), [placeFiles]);

    /** Moves the character at `from` to position `to`; the ones in between shift along the chain. */
    const reorder = useCallback((from: number, to: number) => {
      setDraft(d => {
        if (!d || from === to) return d;
        const slots = d.slots.slice();
        const [moved] = slots.splice(from, 1);
        slots.splice(to, 0, moved);
        return {...d, slots};
      });
    }, []);

    const pickMany = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []).sort(byName);
        e.target.value = '';
        if (files.length > 0) void placeFiles(files.slice(0, SLOT_COUNT), 0);
      },
      [placeFiles],
    );

    const save = useCallback(async () => {
      if (!draft) return;
      const title = draft.title.trim().slice(0, MAX_TITLE_LENGTH);
      const slots = draft.slots;
      if (!title || slots.some(s => s === null)) return;
      setBusy(true);
      setError(null);
      try {
        const filled = slots as Slot[];
        const now = Date.now();
        await onSave(
          {
            id: draft.id ?? newGroupId(),
            title,
            names: filled.map(s => s.name),
            thumbs: filled.map(s => s.thumb),
            createdAt: draft.createdAt,
            updatedAt: now,
          },
          filled.map(s => s.blob),
        );
        releaseUrls();
        setDraft(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }, [draft, onSave, releaseUrls]);

    const remove = useCallback(
      async (id: string) => {
        const meta = groups.find(g => g.id === id);
        if (!meta || !window.confirm(`Delete "${meta.title}"? This cannot be undone.`)) return;
        setBusy(true);
        try {
          await onDelete(id);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      },
      [groups, onDelete],
    );

    const ready = draft !== null && draft.title.trim().length > 0 && draft.slots.every(s => s !== null);

    return (
      <Overlay>
        <div
          className={classNames(
            'mk-card mk-pop flex max-h-full w-full flex-col overflow-hidden',
            draft ? 'max-w-4xl' : 'max-w-2xl',
          )}>
          <div className="mk-banner py-2 text-center text-2xl">
            {draft ? (draft.id ? 'Edit group' : 'New group') : 'Characters'}
          </div>

          {draft === null ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              <p className="mk-best mb-3 text-xs">
                Pick which set of eleven characters to play with. Switching starts a new run. Voice lines belong to the
                original cast only; your own groups keep the pops and jingles.
              </p>
              <ul className="flex flex-col gap-2">
                <GroupRow
                  active={activeId === DEFAULT_GROUP_ID}
                  id={DEFAULT_GROUP_ID}
                  onPlay={onSelect}
                  subtitle="the original eleven, with voice lines"
                  thumbs={defaultThumbs}
                  title={DEFAULT_GROUP_TITLE}
                />
                {groups.map(g => (
                  <GroupRow
                    active={activeId === g.id}
                    id={g.id}
                    key={g.id}
                    onDelete={remove}
                    onEdit={startEdit}
                    onPlay={onSelect}
                    subtitle={`${g.names[0]} → ${g.names[g.names.length - 1]}`}
                    thumbs={g.thumbs}
                    title={g.title}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              <label className="flex items-center gap-2 text-sm">
                <span className="mk-best shrink-0 text-xs uppercase tracking-wider">Title</span>
                <input
                  aria-label="Group title"
                  className="mk-input min-w-0 flex-1"
                  maxLength={MAX_TITLE_LENGTH}
                  onChange={setTitle}
                  placeholder="e.g. Lunch crew"
                  type="text"
                  value={draft.title}
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="mk-pill mk-pill-secondary flex cursor-pointer items-center gap-2 px-4 py-1.5 text-sm">
                  <UploadIcon />
                  Pick {SLOT_COUNT} images at once
                  <input accept="image/*" className="sr-only" multiple onChange={pickMany} type="file" />
                </label>
                <span className="mk-best text-xs">sorted by file name, smallest first</span>
              </div>
              <p className="mk-best mt-3 text-xs">
                Clockwise from the top: #1 is the smallest, two of the same evolve into the next one along the arrows,
                and two #{SLOT_COUNT}s cancel out. Tap a slot to pick its image, drag one to change the order.
              </p>
              <EvolutionEditor onPick={pickOne} onReorder={reorder} slots={draft.slots} />
              <p className="mk-best mt-3 text-xs">
                Transparent PNGs collide by their silhouette; opaque images collide as rectangles. Images are downscaled
                to 512 px and stored in this browser only.
              </p>
            </div>
          )}

          {error && <p className="px-4 pb-1 text-sm text-[#c0392b]">{error}</p>}

          <div className="flex items-center justify-between gap-2 border-t border-[#f1d5a4] p-3">
            {draft === null ? (
              <>
                <button
                  className="mk-pill mk-pill-secondary flex items-center gap-2 px-5 py-1.5 text-base"
                  disabled={busy}
                  onClick={startNew}
                  type="button">
                  <GroupsIcon />
                  New group
                </button>
                <button className="mk-pill mk-pill-primary px-8 py-1.5 text-base" onClick={onClose} type="button">
                  Back
                </button>
              </>
            ) : (
              <>
                <button
                  className="mk-pill mk-pill-secondary px-5 py-1.5 text-base"
                  disabled={busy}
                  onClick={cancelEdit}
                  type="button">
                  Cancel
                </button>
                <button
                  className="mk-pill mk-pill-primary px-8 py-1.5 text-base disabled:opacity-50"
                  disabled={!ready || busy}
                  onClick={save}
                  type="button">
                  {busy ? 'Working…' : draft.id ? 'Save changes' : 'Save & play'}
                </button>
              </>
            )}
          </div>
        </div>
      </Overlay>
    );
  },
);
GroupsModal.displayName = 'GroupsModal';

const GroupRow: FC<{
  id: string;
  title: string;
  subtitle: string;
  thumbs: readonly string[];
  active: boolean;
  onPlay: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}> = memo(({id, title, subtitle, thumbs, active, onPlay, onEdit, onDelete}) => {
  const play = useCallback(() => onPlay(id), [onPlay, id]);
  const edit = useCallback(() => onEdit?.(id), [onEdit, id]);
  const del = useCallback(() => onDelete?.(id), [onDelete, id]);
  return (
    <li
      className={classNames(
        'mk-group-row flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-center',
        active && 'mk-group-row-active',
      )}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-bold">{title}</span>
          {active && <span className="mk-banner rounded-full px-2 py-0.5 text-[10px]">playing</span>}
        </div>
        <div className="mk-best truncate text-xs">{subtitle}</div>
        <div className="mt-1 flex h-9 items-end gap-0.5 overflow-hidden">
          {thumbs.map((src, i) => (
            <img
              alt=""
              className="max-w-[9%] object-contain"
              draggable={false}
              key={i}
              src={src}
              style={THUMB_STYLES[i]}
            />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {onEdit && (
          <button className="mk-pill mk-pill-secondary px-4 py-1 text-sm" onClick={edit} type="button">
            Edit
          </button>
        )}
        {onDelete && (
          <button className="mk-pill mk-pill-secondary px-4 py-1 text-sm" onClick={del} type="button">
            Delete
          </button>
        )}
        <button className="mk-pill mk-pill-primary px-5 py-1 text-sm" disabled={active} onClick={play} type="button">
          {active ? 'Playing' : 'Play'}
        </button>
      </div>
    </li>
  );
});
GroupRow.displayName = 'GroupRow';

const THUMB_STYLES: CSSProperties[] = [];
for (let i = 0; i < SLOT_COUNT; i++) THUMB_STYLES.push({height: 14 + i * 2.2});

/* ---------------------------------------------------------------- ring editor */

/** Pointer travel (px) before a press on a slot becomes a drag instead of a tap. */
const DRAG_THRESHOLD = 8;

interface RingMetrics {
  /** Outer square size of the ring in px. */
  size: number;
  /** Slot box size in px. */
  slot: number;
}

/** The ring fills the modal on phones and settles at 480 px on wider screens. */
const useRingMetrics = (): RingMetrics => {
  const [metrics, setMetrics] = useState<RingMetrics>({size: 480, slot: 72});
  useEffect(() => {
    const measure = () => {
      const size = Math.max(260, Math.min(480, window.innerWidth - 72));
      setMetrics({size, slot: size >= 420 ? 72 : size >= 340 ? 60 : 52});
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return metrics;
};

/** Position label: the ends of the chain are named, the middle only prompts while empty. */
const slotHint = (index: number, filled: boolean) =>
  index === 0 ? 'smallest' : index === SLOT_COUNT - 1 ? 'biggest' : filled ? '' : 'tap to pick';

interface DragState {
  from: number;
  x: number;
  y: number;
  /** Slot under the pointer, or null when none is close enough. */
  over: number | null;
}

/**
 * Eleven slots around a ring, #1 at the top and the chain running clockwise, with an arrow on the
 * ring between each pair. Tapping a slot opens the file picker; dragging one drops it at another
 * position and shifts the slots in between.
 */
const EvolutionEditor: FC<{
  slots: Array<Slot | null>;
  onPick: (index: number, file: File) => void;
  onReorder: (from: number, to: number) => void;
}> = memo(({slots, onPick, onReorder}) => {
  const {size, slot: slotSize} = useRingMetrics();
  const [drag, setDrag] = useState<DragState | null>(null);
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);

  const geometry = useMemo(() => {
    const centre = size / 2;
    const radius = centre - slotSize / 2 - 6;
    const step = (Math.PI * 2) / SLOT_COUNT;
    const at = (angle: number) => ({x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle)});
    const positions: CSSProperties[] = [];
    const arrows: CSSProperties[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const angle = -Math.PI / 2 + i * step;
      const p = at(angle);
      positions.push({left: p.x, top: p.y, width: slotSize, height: slotSize, transform: 'translate(-50%, -50%)'});
      const mid = at(angle + step / 2);
      // A right-pointing glyph rotated to the clockwise tangent at the midpoint between two slots.
      arrows.push({
        left: mid.x,
        top: mid.y,
        transform: `translate(-50%, -50%) rotate(${((angle + step / 2) * 180) / Math.PI + 90}deg)`,
      });
    }
    return {
      positions,
      arrows,
      ring: {width: size, height: size, '--mk-ring-r': `${radius}px`} as CSSProperties,
    };
  }, [size, slotSize]);

  const nearestSlot = useCallback(
    (x: number, y: number): number | null => {
      let best: number | null = null;
      let bestDist = slotSize * 0.9;
      slotRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      return best;
    },
    [slotSize],
  );

  // Pointer positions are converted to ring-local coordinates: the card is animated with a
  // transform, which would make `position: fixed` measure from the card instead of the viewport.
  const ringRef = useRef<HTMLDivElement>(null);
  const local = useCallback((x: number, y: number) => {
    const r = ringRef.current?.getBoundingClientRect();
    return r ? {x: x - r.left, y: y - r.top} : {x, y};
  }, []);

  const onDragMove = useCallback(
    (from: number, x: number, y: number) => setDrag({from, ...local(x, y), over: nearestSlot(x, y)}),
    [local, nearestSlot],
  );
  const onDragEnd = useCallback(
    (from: number, x: number, y: number) => {
      const over = nearestSlot(x, y);
      setDrag(null);
      if (over !== null && over !== from) onReorder(from, over);
    },
    [nearestSlot, onReorder],
  );
  const onDragCancel = useCallback(() => setDrag(null), []);
  const setSlotRef = useCallback((index: number, el: HTMLDivElement | null) => void (slotRefs.current[index] = el), []);

  const ghostStyle = useMemo<CSSProperties | undefined>(
    () =>
      drag
        ? {left: drag.x, top: drag.y, width: slotSize, height: slotSize, transform: 'translate(-50%, -50%)'}
        : undefined,
    [drag, slotSize],
  );
  const dragged = drag ? slots[drag.from] : null;

  return (
    <div className="mt-3 flex justify-center">
      <div className="mk-evo relative select-none" ref={ringRef} style={geometry.ring}>
        <div className="mk-evo-ring absolute inset-0 rounded-full" />
        <div className="mk-label absolute left-1/2 top-1/2 w-2/5 -translate-x-1/2 -translate-y-1/2 text-center text-xs leading-tight">
          Circle of
          <br />
          Evolution
        </div>
        {geometry.arrows.map((style, i) => (
          <span
            aria-hidden="true"
            className={classNames(
              'pointer-events-none absolute text-base font-bold leading-none',
              i === SLOT_COUNT - 1 ? 'text-[#b98450] opacity-60' : 'text-[#c97a2c]',
            )}
            key={i}
            style={style}>
            {i === SLOT_COUNT - 1 ? '✕' : '➜'}
          </span>
        ))}
        {slots.map((slot, i) => (
          <RingSlot
            dragging={drag?.from === i}
            index={i}
            key={i}
            onDragCancel={onDragCancel}
            onDragEnd={onDragEnd}
            onDragMove={onDragMove}
            onPick={onPick}
            setRef={setSlotRef}
            slot={slot}
            style={geometry.positions[i]}
            target={drag !== null && drag.over === i && drag.from !== i}
          />
        ))}
        {dragged && ghostStyle && (
          <div
            className="mk-slot mk-slot-filled mk-slot-ghost pointer-events-none absolute z-20 flex items-center justify-center rounded-xl p-1"
            style={ghostStyle}>
            <img alt="" className="max-h-full max-w-full object-contain" draggable={false} src={dragged.url} />
          </div>
        )}
      </div>
    </div>
  );
});
EvolutionEditor.displayName = 'EvolutionEditor';

const RingSlot: FC<{
  index: number;
  slot: Slot | null;
  style: CSSProperties;
  dragging: boolean;
  target: boolean;
  onPick: (index: number, file: File) => void;
  onDragMove: (from: number, x: number, y: number) => void;
  onDragEnd: (from: number, x: number, y: number) => void;
  onDragCancel: () => void;
  setRef: (index: number, el: HTMLDivElement | null) => void;
}> = memo(({index, slot, style, dragging, target, onPick, onDragMove, onDragEnd, onDragCancel, setRef}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  // Press bookkeeping: where it started and whether it has turned into a drag.
  const pressRef = useRef<{id: number; x: number; y: number; dragging: boolean} | null>(null);

  const ref = useCallback((el: HTMLDivElement | null) => setRef(index, el), [setRef, index]);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) onPick(index, file);
    },
    [index, onPick],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    pressRef.current = {id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false};
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (!press || press.id !== e.pointerId) return;
      // Only a filled slot can be picked up; an empty one is just a button.
      if (!press.dragging && slot && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD)
        press.dragging = true;
      if (press.dragging) onDragMove(index, e.clientX, e.clientY);
    },
    [index, onDragMove, slot],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (!press || press.id !== e.pointerId) return;
      pressRef.current = null;
      if (press.dragging) onDragEnd(index, e.clientX, e.clientY);
      else inputRef.current?.click();
    },
    [index, onDragEnd],
  );

  const onPointerCancel = useCallback(() => {
    if (pressRef.current?.dragging) onDragCancel();
    pressRef.current = null;
  }, [onDragCancel]);

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  }, []);

  const hint = slotHint(index, slot !== null);
  return (
    <div
      aria-label={`Slot ${index + 1}${slot ? `: ${slot.name}` : ''}`}
      className={classNames(
        'mk-slot absolute flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl p-1 [touch-action:none]',
        slot && 'mk-slot-filled',
        slot && 'cursor-grab',
        dragging && 'mk-slot-dragging',
        target && 'mk-slot-target',
      )}
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={ref}
      role="button"
      style={style}
      tabIndex={0}
      title={slot ? `${slot.name} — drag to reorder` : 'Pick an image'}>
      <span className="mk-best text-[10px] font-bold leading-none">#{index + 1}</span>
      <span className="flex min-h-0 w-full flex-1 items-center justify-center">
        {slot ? (
          <img alt={slot.name} className="max-h-full max-w-full object-contain" draggable={false} src={slot.url} />
        ) : (
          <UploadIcon />
        )}
      </span>
      {hint && <span className="mk-best w-full truncate text-center text-[8px] leading-none">{hint}</span>}
      <input accept="image/*" className="sr-only" onChange={onChange} ref={inputRef} tabIndex={-1} type="file" />
    </div>
  );
});
RingSlot.displayName = 'RingSlot';
