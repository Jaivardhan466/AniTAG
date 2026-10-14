import type { Anime } from '../types/anime';

const WATCHLIST_KEY = 'anitag:watchlist:v1';
const FAVORITES_KEY = 'anitag:favorites:v1';
const LIBRARY_KEY = 'anitag:library:v1';
const HISTORY_KEY = 'anitag:history:v1';
const safeRead = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const safeWrite = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };

export type LibraryStatus = 'watchlist' | 'watching' | 'completed' | 'plan-to-watch' | 'on-hold' | 'dropped';
export interface LibraryEntry { anime: Anime; status: LibraryStatus; updatedAt: number; progressEpisode?: number }
export interface WatchProgress { anime: Anime; episode: number; updatedAt: number; currentTime?: number; duration?: number }

export function getWatchlist(): Anime[] { return safeRead<Anime[]>(WATCHLIST_KEY, []); }
export function isInWatchlist(id: number): boolean { return getWatchlist().some((anime) => anime.id === id); }
export function toggleWatchlist(anime: Anime): Anime[] {
  const current = getWatchlist();
  const next = current.some((item) => item.id === anime.id) ? current.filter((item) => item.id !== anime.id) : [anime, ...current];
  safeWrite(WATCHLIST_KEY, next);
  const entries = safeRead<LibraryEntry[]>(LIBRARY_KEY, []).filter((entry) => entry.anime.id !== anime.id);
  if (next.some((item) => item.id === anime.id)) entries.unshift({ anime, status: 'watchlist', updatedAt: Date.now() });
  safeWrite(LIBRARY_KEY, entries);
  return next;
}
export function getLibraryEntries(): LibraryEntry[] {
  const entries = safeRead<LibraryEntry[]>(LIBRARY_KEY, []);
  const known = new Set(entries.map((entry) => entry.anime.id));
  const legacy = getWatchlist().filter((anime) => !known.has(anime.id)).map((anime) => ({ anime, status: 'watchlist' as const, updatedAt: 0 }));
  return [...entries, ...legacy];
}
export function setLibraryStatus(anime: Anime, status: LibraryStatus): LibraryEntry[] {
  const entries = getLibraryEntries().filter((entry) => entry.anime.id !== anime.id);
  const next = [{ anime, status, updatedAt: Date.now() }, ...entries];
  safeWrite(LIBRARY_KEY, next);
  const watchlist = getWatchlist().filter((item) => item.id !== anime.id);
  if (status === 'watchlist') watchlist.unshift(anime);
  safeWrite(WATCHLIST_KEY, watchlist);
  return next;
}
export function removeFromLibrary(id: number): LibraryEntry[] {
  const next = getLibraryEntries().filter((entry) => entry.anime.id !== id);
  safeWrite(LIBRARY_KEY, next);
  safeWrite(WATCHLIST_KEY, getWatchlist().filter((anime) => anime.id !== id));
  return next;
}
export function getFavorites(): Anime[] { return safeRead<Anime[]>(FAVORITES_KEY, []); }
export function toggleFavorite(anime: Anime): Anime[] {
  const current = getFavorites();
  const next = current.some((item) => item.id === anime.id) ? current.filter((item) => item.id !== anime.id) : [anime, ...current];
  safeWrite(FAVORITES_KEY, next);
  return next;
}
export function getWatchHistory(): WatchProgress[] { return safeRead<WatchProgress[]>(HISTORY_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt); }
export function saveWatchProgress(anime: Anime, episode: number, currentTime = 0, duration = 0): void {
  const next = [{ anime, episode, currentTime, duration, updatedAt: Date.now() }, ...getWatchHistory().filter((item) => item.anime.id !== anime.id)].slice(0, 100);
  safeWrite(HISTORY_KEY, next);
  const entry = getLibraryEntries().find((item) => item.anime.id === anime.id);
  if (!entry || entry.status === 'watchlist' || entry.status === 'plan-to-watch') setLibraryStatus(anime, 'watching');
}
export function removeHistoryItem(id: number): WatchProgress[] {
  const next = getWatchHistory().filter((item) => item.anime.id !== id);
  safeWrite(HISTORY_KEY, next);
  return next;
}
export function clearWatchHistory(): void { safeWrite(HISTORY_KEY, []); }
export function clearSavedProgress(): void {
  safeWrite(HISTORY_KEY, []);
  const next = getLibraryEntries().map((entry) => ({ ...entry, progressEpisode: undefined }));
  safeWrite(LIBRARY_KEY, next);
}
export function clearLocalLibrary(): void { safeWrite(WATCHLIST_KEY, []); safeWrite(FAVORITES_KEY, []); safeWrite(LIBRARY_KEY, []); }

export function exportLocalData(): string { return JSON.stringify({ format: 'anitag-backup', version: 1, exportedAt: new Date().toISOString(), watchlist: safeRead<Anime[]>(WATCHLIST_KEY, []), favorites: safeRead<Anime[]>(FAVORITES_KEY, []), library: safeRead<LibraryEntry[]>(LIBRARY_KEY, []), history: safeRead<WatchProgress[]>(HISTORY_KEY, []) }, null, 2); }
export function importLocalData(text: string): void { const data = JSON.parse(text); if (data?.format !== 'anitag-backup' || data.version !== 1) throw new Error('This is not a supported AniTAG backup.'); const valid = (value: unknown) => Array.isArray(value); if (![data.watchlist, data.favorites, data.library, data.history].every(valid)) throw new Error('Backup data is incomplete or invalid.'); if (![...data.watchlist, ...data.favorites].every((item: any) => Number.isInteger(item?.id)) || !data.library.every((item: any) => Number.isInteger(item?.anime?.id)) || !data.history.every((item: any) => Number.isInteger(item?.anime?.id))) throw new Error('Backup contains invalid anime entries.'); safeWrite(WATCHLIST_KEY, data.watchlist); safeWrite(FAVORITES_KEY, data.favorites); safeWrite(LIBRARY_KEY, data.library); safeWrite(HISTORY_KEY, data.history); }
