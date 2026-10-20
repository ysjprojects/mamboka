// Device-local leaderboard: every finished run is recorded under the player's name (editable
// afterwards) together with the character group it was played with. Kept in localStorage; it is
// small JSON and read synchronously at mount.

export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  /** Title of the character group the run was played with. */
  group: string;
  /** Unix ms of the game over. */
  at: number;
}

const KEY = 'mamboka.leaderboard';
const LEGACY_KEY = 'mamboka.ranking';
const NAME_KEY = 'mamboka.player';
/** Scores kept before older/lower ones fall off. */
const CAPACITY = 50;
export const ANONYMOUS = 'Anonymous';
export const MAX_NAME_LENGTH = 16;

const byScore = (a: ScoreEntry, b: ScoreEntry) => b.score - a.score || a.at - b.at;

function isEntry(value: unknown): value is ScoreEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<ScoreEntry>;
  return (
    typeof e.id === 'string' && typeof e.name === 'string' && typeof e.score === 'number' && typeof e.at === 'number'
  );
}

function write(entries: ScoreEntry[]): ScoreEntry[] {
  const kept = entries.sort(byScore).slice(0, CAPACITY);
  localStorage.setItem(KEY, JSON.stringify(kept));
  return kept;
}

export function readLeaderboard(): ScoreEntry[] {
  try {
    migrateRanking();
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter(isEntry)
          .map(e => (typeof e.group === 'string' ? e : {...e, group: ''}))
          .sort(byScore)
      : [];
  } catch {
    return [];
  }
}

/** The first release stored unnamed `{score, at}` rows under `mamboka.ranking`; fold them in once. */
function migrateRanking(): void {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (raw === null) return;
  localStorage.removeItem(LEGACY_KEY);
  const rows = JSON.parse(raw) as unknown;
  if (!Array.isArray(rows)) return;
  const migrated = rows
    .filter(
      (r): r is {score: number; at: number} =>
        typeof r === 'object' && r !== null && typeof (r as {score?: unknown}).score === 'number',
    )
    .map(r => ({id: `legacy-${r.at}`, name: ANONYMOUS, score: r.score, group: 'Original', at: r.at}));
  const current = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
  write([...(Array.isArray(current) ? current.filter(isEntry) : []), ...migrated]);
}

export function recordScore(name: string, score: number, group: string): ScoreEntry {
  const entry: ScoreEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName(name),
    score,
    group,
    at: Date.now(),
  };
  write([...readLeaderboard(), entry]);
  return entry;
}

export function renameEntry(id: string, name: string): ScoreEntry[] {
  const cleaned = cleanName(name);
  return write(readLeaderboard().map(e => (e.id === id ? {...e, name: cleaned} : e)));
}

/** 1-based rank of `id`, or 0 when it is not on the board. */
export function rankOf(entries: ScoreEntry[], id: string): number {
  return entries.findIndex(e => e.id === id) + 1;
}

export function readPlayerName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

export function savePlayerName(name: string): void {
  localStorage.setItem(NAME_KEY, name.slice(0, MAX_NAME_LENGTH));
}

export function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : ANONYMOUS;
}
