// Character groups: the built-in roster plus user-made sets of eleven images that follow the same
// smallest → biggest hierarchy. Custom groups live in IndexedDB (metadata + thumbnails in one
// store, the full-size PNG blobs in another so listing groups never loads the big images).
import {TIERS} from './roster';

export const DEFAULT_GROUP_ID = 'default';
export const DEFAULT_GROUP_TITLE = 'Original';
export const SLOT_COUNT = TIERS.length;
export const MAX_TITLE_LENGTH = 24;
/** Uploads are downscaled so the longest side is at most this many px (alpha preserved). */
const MAX_IMAGE_SIDE = 512;
const THUMB_HEIGHT = 48;

const DB_NAME = 'mamboka';
const DB_VERSION = 1;
const GROUPS = 'groups';
const IMAGES = 'images';
const SELECTED_KEY = 'mamboka.group';

export interface GroupMeta {
  id: string;
  title: string;
  /** Character names, smallest → biggest (file names for uploads). */
  names: string[];
  /** Small data-URL previews, smallest → biggest, for listing without loading the blobs. */
  thumbs: string[];
  createdAt: number;
  updatedAt: number;
}

interface ImageRow {
  groupId: string;
  slot: number;
  /**
   * PNG bytes. Stored as an ArrayBuffer rather than a Blob: WebKit (iOS Safari) intermittently
   * aborts transactions that store Blobs ("Error preparing Blob/File data to be stored").
   */
  bytes: ArrayBuffer;
  type: string;
  /** Rows written by the first release stored the Blob itself. */
  blob?: Blob;
}

/** A group resolved for play: image URLs (static or object URLs) plus what the HUD needs. */
export interface ActiveGroup {
  /** Releases object URLs of a custom group. */
  release(): void;
  id: string;
  title: string;
  isDefault: boolean;
  sources: string[];
  names: string[];
  /** Voice clip per tier; only the built-in roster has them. */
  voices: Array<string | undefined>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  const {promise, resolve, reject} = Promise.withResolvers<T>();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(describe('request', req.error));
  return promise;
}

/** Waits for a transaction; the first failed request's error is reported when the transaction carries none (WebKit). */
function transactionDone(tx: IDBTransaction, firstRequestError: () => DOMException | null): Promise<void> {
  const {promise, resolve, reject} = Promise.withResolvers<void>();
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(describe('transaction', tx.error ?? firstRequestError()));
  tx.onabort = () => reject(describe('transaction', tx.error ?? firstRequestError()));
  return promise;
}

function describe(what: string, error: DOMException | null): Error {
  const detail = error ? `${error.name}: ${error.message}` : 'aborted without an error (storage full or restricted?)';
  return new Error(`IndexedDB ${what} failed — ${detail}`);
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const {promise, resolve, reject} = Promise.withResolvers<IDBDatabase>();
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(GROUPS)) db.createObjectStore(GROUPS, {keyPath: 'id'});
    if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, {keyPath: ['groupId', 'slot']});
  };
  req.onsuccess = () => {
    const db = req.result;
    // iOS closes connections of backgrounded pages; drop the cached one so the next call reopens.
    db.onclose = () => {
      if (dbPromise === promise) dbPromise = null;
    };
    db.onversionchange = () => {
      db.close();
      if (dbPromise === promise) dbPromise = null;
    };
    resolve(db);
  };
  req.onerror = () => reject(describe('open', req.error));
  req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  dbPromise = promise;
  promise.catch(() => {
    if (dbPromise === promise) dbPromise = null;
  });
  return promise;
}

/**
 * Runs `body` inside a transaction and waits for it to commit. `body` must be synchronous apart
 * from awaiting its own requests: a transaction auto-commits as soon as the task yields. A
 * connection that turns out to be closed is reopened once.
 */
async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => T | Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const db = await openDb();
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (err) {
      if (attempt === 0 && err instanceof DOMException && err.name === 'InvalidStateError') {
        dbPromise = null;
        continue;
      }
      throw err;
    }
    let firstError: DOMException | null = null;
    tx.addEventListener('error', e => {
      const target = e.target as IDBRequest | null;
      firstError ??= target?.error ?? null;
    });
    const result = await body(tx);
    await transactionDone(tx, () => firstError);
    return result;
  }
}

/** Custom groups, newest first. */
export async function listGroups(): Promise<GroupMeta[]> {
  const rows = await transact([GROUPS], 'readonly', tx => request(tx.objectStore(GROUPS).getAll()));
  return (rows as GroupMeta[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The eleven stored images of a group, smallest → biggest; null when the group does not exist. */
export async function loadGroupImages(id: string): Promise<Blob[] | null> {
  const rows = (await transact([IMAGES], 'readonly', tx =>
    request(tx.objectStore(IMAGES).getAll(IDBKeyRange.bound([id, 0], [id, SLOT_COUNT - 1]))),
  )) as ImageRow[];
  if (rows.length !== SLOT_COUNT) return null;
  return rows.sort((a, b) => a.slot - b.slot).map(r => r.blob ?? new Blob([r.bytes], {type: r.type}));
}

/** Creates or replaces a group and all of its images in one transaction. */
export async function saveGroup(meta: GroupMeta, images: Blob[]): Promise<void> {
  if (images.length !== SLOT_COUNT) throw new Error(`A group needs ${SLOT_COUNT} images`);
  // Read the bytes before opening the transaction: nothing asynchronous may happen inside it.
  const rows: ImageRow[] = await Promise.all(
    images.map(async (blob, slot) => ({
      groupId: meta.id,
      slot,
      bytes: await blob.arrayBuffer(),
      type: blob.type || 'image/png',
    })),
  );
  await transact([GROUPS, IMAGES], 'readwrite', tx => {
    tx.objectStore(GROUPS).put(meta);
    const store = tx.objectStore(IMAGES);
    for (const row of rows) store.put(row);
  });
}

export async function deleteGroup(id: string): Promise<void> {
  await transact([GROUPS, IMAGES], 'readwrite', tx => {
    tx.objectStore(GROUPS).delete(id);
    tx.objectStore(IMAGES).delete(IDBKeyRange.bound([id, 0], [id, SLOT_COUNT - 1]));
  });
}

export function readSelectedGroupId(): string {
  return localStorage.getItem(SELECTED_KEY) ?? DEFAULT_GROUP_ID;
}

export function saveSelectedGroupId(id: string): void {
  localStorage.setItem(SELECTED_KEY, id);
}

export function newGroupId(): string {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultGroup(): ActiveGroup {
  return {
    id: DEFAULT_GROUP_ID,
    title: DEFAULT_GROUP_TITLE,
    isDefault: true,
    sources: TIERS.map(t => t.src),
    names: TIERS.map(t => t.name),
    voices: TIERS.map(t => t.voice),
    release: () => undefined,
  };
}

/** Resolves a stored custom group into object URLs; null when it no longer exists. */
export async function resolveGroup(meta: GroupMeta): Promise<ActiveGroup | null> {
  const images = await loadGroupImages(meta.id);
  if (!images) return null;
  const sources = images.map(blob => URL.createObjectURL(blob));
  return {
    id: meta.id,
    title: meta.title,
    isDefault: false,
    sources,
    names: meta.names,
    voices: [],
    release: () => sources.forEach(url => URL.revokeObjectURL(url)),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const {promise, resolve, reject} = Promise.withResolvers<HTMLImageElement>();
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Not a readable image'));
  image.src = src;
  return promise;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const {promise, resolve, reject} = Promise.withResolvers<Blob>();
  canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), 'image/png');
  return promise;
}

/**
 * Normalises an upload for storage: decoded through an <img> (so EXIF orientation applies),
 * downscaled to at most MAX_IMAGE_SIDE and re-encoded as PNG to keep transparency, plus a small
 * thumbnail data URL for group lists.
 */
export async function importImage(file: File): Promise<{blob: Blob; thumb: string; name: string}> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas);

    const thumb = document.createElement('canvas');
    const ts = THUMB_HEIGHT / canvas.height;
    thumb.width = Math.max(1, Math.round(canvas.width * ts));
    thumb.height = THUMB_HEIGHT;
    thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height);

    return {
      blob,
      thumb: thumb.toDataURL('image/png'),
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Character',
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
