import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Search, RefreshCw, Star, Tv, Heart, CirclePlay, Play, ChevronDown, X, Menu, CheckCircle2, AlertCircle, Home, Compass, Library, History, Settings, Download, WifiOff, Sun, Moon, Monitor, Trash2, Share2, LayoutGrid, List, ChevronRight, RotateCcw } from 'lucide-react';
import { getAnimeById, getPopular, getTrending, getTopRated, getRecentlyAdded, getSeasonal, searchAnime } from './lib/anilist';
import { clearSavedProgress, clearWatchHistory, exportLocalData, importLocalData, getFavorites, getLibraryEntries, getWatchHistory, getWatchlist, removeFromLibrary, removeHistoryItem, saveWatchProgress, setLibraryStatus, toggleFavorite, toggleWatchlist } from './lib/library';
import type { LibraryEntry, LibraryStatus, WatchProgress } from './lib/library';
import AnimeCard from './components/AnimeCard';
import type { Anime, AnimeConnection } from './types/anime';
const VideoPlayer = lazy(() => import('./components/GlassVideoPlayer'));
import { getEpisodeSources, getPlayableEpisodes, getStreamApiBase } from './lib/streaming';
import type { PlayableEpisode, StreamSource } from './lib/streaming';

function titleOf(anime: Anime) {
  return anime.title?.english || anime.title?.romaji || anime.title?.native || 'Untitled anime';
}

function clockLabel(seconds: number) { const minutes = Math.floor(seconds / 60); const remainder = Math.floor(seconds % 60); return minutes + ':' + String(remainder).padStart(2, '0'); }

type AppView = 'home' | 'browse' | 'library' | 'history' | 'settings' | 'about' | 'contact';
type LibraryTab = LibraryStatus | 'favorites';
interface UserSettings { theme: 'dark' | 'light' | 'system'; palette: 'graphite' | 'ocean' | 'violet' | 'rose' | 'amber'; autoplayNext: boolean; playbackSpeed: number; subtitleLanguage: string; audioLanguage: 'sub' | 'dub' }
interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
const SETTINGS_KEY = 'anitag:settings:v1';
const defaultSettings: UserSettings = { theme: 'dark', palette: 'graphite', autoplayNext: true, playbackSpeed: 1, subtitleLanguage: 'off', audioLanguage: 'sub' };
function readSettings(): UserSettings { try { const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); const merged = { ...defaultSettings, ...stored }; if (stored.palette === 'amber') merged.palette = 'graphite'; return merged; } catch { return defaultSettings; } }
function BrandMark() { return <img className='brand-mark' src='/anitag-mark.svg' alt='' width='34' height='34' />; }

function App() {
  const [items, setItems] = useState<Anime[]>([]);
  const [saved, setSaved] = useState<Anime[]>([]);
  const [search, setSearch] = useState('');
  const [catalogTerm, setCatalogTerm] = useState('');
  const [suggestions, setSuggestions] = useState<Anime[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mode, setMode] = useState<'trending' | 'popular' | 'saved'>('trending');
  const [view, setView] = useState<AppView>('home');
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('watchlist');
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [favorites, setFavorites] = useState<Anime[]>([]);
  const [historyItems, setHistoryItems] = useState<WatchProgress[]>([]);
  const [popularItems, setPopularItems] = useState<Anime[]>([]);
  const [topRatedItems, setTopRatedItems] = useState<Anime[]>([]);
  const [seasonalItems, setSeasonalItems] = useState<Anime[]>([]);
  const [recentItems, setRecentItems] = useState<Anime[]>([]);
  const [settings, setSettings] = useState<UserSettings>(readSettings);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('anitag:recent-searches:v1') || '[]'); } catch { return []; } });
  const [genreFilter, setGenreFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortFilter, setSortFilter] = useState('relevance');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [episodeSearch, setEpisodeSearch] = useState('');
  const [episodeRange, setEpisodeRange] = useState('all');
  const [expandedDescription, setExpandedDescription] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'history' | 'progress' | 'reset' | null>(null);
  const [resumeTime, setResumeTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Anime | null>(null);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [watching, setWatching] = useState<Anime | null>(null);
  const [watchEpisodes, setWatchEpisodes] = useState<PlayableEpisode[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<PlayableEpisode | null>(null);
  const [streamSources, setStreamSources] = useState<StreamSource[]>([]);
  const [currentSource, setCurrentSource] = useState<StreamSource | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [watchAudio, setWatchAudio] = useState<'sub' | 'dub'>('sub');
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [watchError, setWatchError] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  async function load(nextMode = mode, term = catalogTerm, nextPage = 1, append = false) {
    if (nextMode === 'saved') {
      const list = getWatchlist();
      setItems(Array.isArray(list) ? list : []);
      setPage(1);
      setHasNextPage(false);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      let result: AnimeConnection;
      if (term.trim()) result = await searchAnime(term.trim(), nextPage);
      else result = await (nextMode === 'popular' ? getPopular(nextPage) : getTrending(nextPage));
      const nextItems = Array.isArray(result?.nodes) ? result.nodes : [];
      setItems((current) => append ? [...current, ...nextItems.filter((anime) => !current.some((old) => old.id === anime.id))] : nextItems);
      setPage(result?.pageInfo?.currentPage ?? nextPage);
      setHasNextPage(Boolean(result?.pageInfo?.hasNextPage));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const list = getWatchlist();
    setSaved(Array.isArray(list) ? list : []);
    setLibraryEntries(getLibraryEntries());
    setFavorites(getFavorites());
    setHistoryItems(getWatchHistory());
    void load('trending', '', 1, false);

  }, []);

  useEffect(() => {
    const root = document.querySelector('.home-rails'); if (!root) return;
    const setters: Record<string, (items: Anime[]) => void> = { popular: setPopularItems, rated: setTopRatedItems, recent: setRecentItems };
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return; const section = entry.target as HTMLElement; const feed = section.dataset.feed; if (!feed || section.dataset.loaded === 'true') return; section.dataset.loaded = 'true'; observer.unobserve(section);
      const setter = setters[feed]; if (setter) { const request = feed === 'popular' ? getPopular(1) : feed === 'rated' ? getTopRated(1) : getRecentlyAdded(1); void request.then(result => setter(result.nodes)).catch(() => setter([])); }
      if (feed === 'seasonal') { const month = new Date().getMonth() + 1; const season = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL'; void getSeasonal(season, new Date().getFullYear(), 1).then(result => setSeasonalItems(result.nodes)).catch(() => setSeasonalItems([])); }
    }), { rootMargin: '500px 0px' });
    root.querySelectorAll<HTMLElement>('[data-feed]').forEach(section => observer.observe(section)); return () => observer.disconnect();
  }, [view]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('anime'); if (!id || !/^\d+$/.test(id)) return; let cancelled = false; void getAnimeById(Number(id)).then(anime => { if (!cancelled) setSelected(anime); }).catch(() => { if (!cancelled) setNotice({kind:'error',message:'This shared anime link could not be loaded.'}); }); return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2 || mode === 'saved') {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchAnime(term, 1);
        if (!cancelled) setSuggestions((result.nodes || []).slice(0, 6));
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, mode]);

  useEffect(() => {
    const updateOnline = () => { setIsOnline(true); setNotice({ kind: 'success', message: 'Connection restored.' }); };
    const updateOffline = () => { setIsOnline(false); setNotice({ kind: 'error', message: 'You are offline. Saved titles remain available.' }); };
    const captureInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const installed = () => { setInstallPrompt(null); setNotice({ kind: 'success', message: 'AniTAG was installed.' }); };
    window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOffline); window.addEventListener('beforeinstallprompt', captureInstall); window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOffline); window.removeEventListener('beforeinstallprompt', captureInstall); window.removeEventListener('appinstalled', installed); };
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    const resolved = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.palette = settings.palette || 'graphite';
  }, [settings]);

  useEffect(() => {
    if (!watching) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [watching]);

  useEffect(() => { if (selected) setExpandedDescription(false); }, [selected]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) setShowSuggestions(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  function navigate(next: AppView) {
    setView(next); setMobileMenuOpen(false); setShowSuggestions(false);
    if (next === 'library') { setLibraryEntries(getLibraryEntries()); setFavorites(getFavorites()); setSaved(getWatchlist()); }
    if (next === 'history') setHistoryItems(getWatchHistory());
    if (next === 'browse') { setMode('trending'); if (!items.length) void load('trending', '', 1, false); }
  }

  function downloadBackup() { const blob = new Blob([exportLocalData()], {type:'application/json'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'anitag-backup.json'; link.click(); URL.revokeObjectURL(url); setNotice({kind:'success',message:'AniTAG backup downloaded.'}); }
  async function restoreBackup(file?: File) { if (!file) return; try { importLocalData(await file.text()); setSaved(getWatchlist()); setLibraryEntries(getLibraryEntries()); setFavorites(getFavorites()); setHistoryItems(getWatchHistory()); setNotice({kind:'success',message:'AniTAG backup restored on this device.'}); } catch(e) { setNotice({kind:'error',message:e instanceof Error ? e.message : 'Could not restore this backup.'}); } }
  function updateSettings(change: Partial<UserSettings>) { setSettings(current => ({ ...current, ...change })); }
  function chooseLibraryStatus(anime: Anime, status: LibraryStatus) {
    const next = setLibraryStatus(anime, status); setLibraryEntries(next); setSaved(getWatchlist());
    setNotice({ kind: 'success', message: status === 'watchlist' ? 'Added to your watchlist.' : 'Library status updated.' });
  }
  function favorite(anime: Anime) { const next = toggleFavorite(anime); setFavorites(next); setNotice({ kind: 'success', message: next.some(item => item.id === anime.id) ? 'Added to favourites.' : 'Removed from favourites.' }); }
  async function installApp() { if (!installPrompt) return; await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === 'accepted') setInstallPrompt(null); }
  function clearData(action: 'history' | 'progress' | 'reset') {
    if (action === 'history') { clearWatchHistory(); setHistoryItems([]); }
    if (action === 'progress') { clearSavedProgress(); setHistoryItems([]); setLibraryEntries(getLibraryEntries()); }
    if (action === 'reset') { localStorage.removeItem('anitag:watchlist:v1'); localStorage.removeItem('anitag:favorites:v1'); localStorage.removeItem('anitag:library:v1'); localStorage.removeItem('anitag:history:v1'); localStorage.removeItem(SETTINGS_KEY); setSaved([]); setFavorites([]); setLibraryEntries([]); setHistoryItems([]); setSettings(defaultSettings); }
    setConfirmAction(null); setNotice({ kind: 'success', message: action === 'history' ? 'Watch history cleared.' : action === 'progress' ? 'Saved progress cleared.' : 'AniTAG settings and library reset.' });
  }
  async function shareAnime(anime: Anime) {
    const url = window.location.origin + '/?anime=' + anime.id;
    try { if (navigator.share) await navigator.share({ title: titleOf(anime), url }); else { await navigator.clipboard.writeText(url); setNotice({ kind: 'success', message: 'Anime link copied.' }); } }
    catch { setNotice({ kind: 'error', message: 'Could not share this title.' }); }
  }

  function changeMode(next: 'trending' | 'popular' | 'saved') {
    setView('browse');
    setMode(next);
    setSearch('');
    setCatalogTerm('');
    setSuggestions([]);
    setShowSuggestions(false);
    void load(next, '', 1, false);
  }

  function save(anime: Anime) {
    try {
      const alreadySaved = saved.some((item) => item.id === anime.id);
      const next = toggleWatchlist(anime);
      setSaved(Array.isArray(next) ? next : []);
      setLibraryEntries(getLibraryEntries());
      setNotice({ kind: 'success', message: alreadySaved ? 'Removed from your list.' : 'Added to your list.' });
      if (mode === 'saved') void load('saved', '', 1, false);
    } catch {
      setNotice({ kind: 'error', message: 'Could not update your list. Check browser storage settings.' });
    }
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const term = search.trim();
    setView('browse');
    setMode('trending');
    setCatalogTerm(term);
    if (term) { const next = [term, ...recentSearches.filter(value => value.toLowerCase() !== term.toLowerCase())].slice(0, 8); setRecentSearches(next); localStorage.setItem('anitag:recent-searches:v1', JSON.stringify(next)); }
    setShowSuggestions(false);
    void load('trending', term, 1, false);
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
  }

  function chooseSuggestion(anime: Anime) {
    setSelected(anime);
    setShowSuggestions(false);
  }

  const openWatch = useCallback((anime: Anime) => {
    setSelected(null);
    setWatching(anime);
    setWatchEpisodes([]);
    setCurrentEpisode(null);
    setStreamSources([]);
    setCurrentSource(null);
    setWatchError('');
    setPlayerError('');
    setWatchAudio(settings.audioLanguage);
    const previous = getWatchHistory().find(item => item.anime.id === anime.id);
    setResumeTime(previous?.currentTime || 0);
    setEpisodeSearch(''); setEpisodeRange('all');
  }, [settings.audioLanguage]);

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    let choseInitialEpisode = false;
    setEpisodesLoading(true);
    setWatchError('');
    const applyEpisodes = (episodes: PlayableEpisode[]) => {
      if (cancelled) return;
      setWatchEpisodes(episodes);
      if (!choseInitialEpisode && episodes.length) {
        const resume = getWatchHistory().find(item => item.anime.id === watching.id);
        const preferredAudio = settings.audioLanguage;
        const first = episodes.find(ep => ep.number === resume?.episode && ep.audio === preferredAudio) || episodes.find((ep) => ep.audio === preferredAudio) || episodes[0] || null;
        setCurrentEpisode(first);
        if (first) setWatchAudio(first.audio);
        choseInitialEpisode = Boolean(first);
        setEpisodesLoading(false);
      }
    };
    void getPlayableEpisodes(watching.id, applyEpisodes).then((episodes) => {
      if (cancelled) return;
      applyEpisodes(episodes);
      if (!episodes.length) setWatchError('No playable episodes were returned by the configured streaming API. Check that this anime is available from a source you are authorized to use.');
    }).catch((e: unknown) => {
      if (!cancelled) setWatchError(e instanceof Error ? e.message : 'Could not load episodes.');
    }).finally(() => { if (!cancelled) setEpisodesLoading(false); });
    return () => { cancelled = true; };
  }, [watching, settings.audioLanguage]);

  useEffect(() => {
    if (!watching || !currentEpisode) return;
    let cancelled = false;
    setSourcesLoading(true);
    setStreamSources([]);
    setCurrentSource(null);
    setPlayerError('');
    void getEpisodeSources(currentEpisode).then((sources) => {
      if (cancelled) return;
      setStreamSources(sources);
      const directIndex = sources.findIndex(source => source.type?.toLowerCase() !== 'embed');
      const activeDirectIndex = sources.findIndex(source => source.isActive && source.type?.toLowerCase() !== 'embed');
      const activeIndex = activeDirectIndex >= 0 ? activeDirectIndex : directIndex >= 0 ? directIndex : Math.max(0, sources.findIndex((source) => source.isActive));
      setSourceIndex(activeIndex);
      setCurrentSource(sources[activeIndex] || null);
      if (!sources.length) setPlayerError('This episode has no playable source. Try another provider, audio option, or episode.');
    }).catch((e: unknown) => {
      if (!cancelled) setPlayerError(e instanceof Error ? e.message : 'Could not load stream sources.');
    }).finally(() => { if (!cancelled) setSourcesLoading(false); });
    return () => { cancelled = true; };
  }, [watching, currentEpisode]);

  useEffect(() => {
    if (!watching || !currentEpisode || !currentSource || sourcesLoading) return;
    const previous = getWatchHistory().find(item => item.anime.id === watching.id);
    if (!previous || previous.episode !== currentEpisode.number) saveWatchProgress(watching, currentEpisode.number, 0, currentEpisode.duration || 0);
    setHistoryItems(getWatchHistory()); setLibraryEntries(getLibraryEntries());
  }, [watching, currentEpisode, currentSource, sourcesLoading]);

  const handlePlayerError = useCallback((message: string) => setPlayerError(message), []);

  function chooseAudio(audio: 'sub' | 'dub') {
    if (!currentEpisode) return;
    const sameEpisode = watchEpisodes.filter((ep) => ep.number === currentEpisode.number && ep.audio === audio);
    if (!sameEpisode.length) return;
    setWatchAudio(audio);
    setCurrentEpisode(sameEpisode.find((ep) => ep.provider === currentEpisode.provider) || sameEpisode[0]);
  }

  function chooseEpisode(number: number) {
    const options = watchEpisodes.filter((ep) => ep.number === number && ep.audio === watchAudio);
    const next = options.find((ep) => ep.provider === currentEpisode?.provider) || options[0];
    if (next) { if (currentEpisode?.number !== next.number) setResumeTime(0); setCurrentEpisode(next); }
  }

  function changeEpisode(direction: -1 | 1) {
    if (!currentEpisode) return;
    const numbers = [...new Set(watchEpisodes.filter((ep) => ep.audio === watchAudio).map((ep) => ep.number))].sort((a, b) => a - b);
    const index = numbers.indexOf(currentEpisode.number);
    const nextNumber = numbers[index + direction];
    if (nextNumber !== undefined) chooseEpisode(nextNumber);
  }

  const episodeNumbers = [...new Set(watchEpisodes.filter((ep) => ep.audio === watchAudio).map((ep) => ep.number))].sort((a, b) => a - b);
  const visibleEpisodeNumbers = episodeNumbers.filter(number => (episodeRange === 'all' || (number >= Number(episodeRange.split('-')[0]) && number <= Number(episodeRange.split('-')[1]))) && (!episodeSearch || String(number).includes(episodeSearch) || (watchEpisodes.find(ep => ep.number === number && ep.audio === watchAudio)?.title || '').toLowerCase().includes(episodeSearch.toLowerCase())));
  const episodeRanges = Array.from({ length: Math.ceil(episodeNumbers.length / 100) }, (_, index) => { const start = index * 100 + 1; const end = Math.min((index + 1) * 100, episodeNumbers[episodeNumbers.length - 1] || 0); return { value: start + '-' + end, label: start + '–' + end }; });
  const currentEpisodeSources = currentEpisode ? watchEpisodes.filter((ep) => ep.number === currentEpisode.number && ep.audio === watchAudio) : [];
  const directStreamSources = streamSources.filter((source) => source.type?.toLowerCase() !== 'embed');
  const streamOptions = directStreamSources.length ? directStreamSources : streamSources;

  const heading = catalogTerm ? 'Results for “' + catalogTerm + '”' : mode === 'saved' ? 'Your watchlist' : mode === 'popular' ? 'Popular right now' : 'Trending anime';
  const activeFilters = Boolean(genreFilter || yearFilter || formatFilter || statusFilter);
  const filteredItems = [...items].filter(anime => (!genreFilter || anime.genres.includes(genreFilter)) && (!yearFilter || String(anime.seasonYear || '') === yearFilter) && (!formatFilter || anime.format === formatFilter) && (!statusFilter || anime.status === statusFilter)).sort((a,b) => sortFilter === 'rating' ? (b.averageScore || 0) - (a.averageScore || 0) : sortFilter === 'year' ? (b.seasonYear || 0) - (a.seasonYear || 0) : 0);
  const libraryViewItems = libraryTab === 'favorites' ? favorites : libraryEntries.filter(entry => entry.status === libraryTab).map(entry => entry.anime);
  const updateProgress = useCallback((seconds: number, total: number) => { if (!watching || !currentEpisode) return; saveWatchProgress(watching, currentEpisode.number, seconds, total); setHistoryItems(getWatchHistory()); setLibraryEntries(getLibraryEntries()); }, [watching, currentEpisode]);
  const seasonTitle = seasonalItems.length ? 'This season · ' + new Date().getFullYear() : 'Seasonal picks';
  const recommendedItems = (favorites.length ? items.filter(anime => favorites.some(f => anime.genres.some(g => f.genres.includes(g)))) : topRatedItems).slice(0, 10);
  const renderAnimeCards = (list: Anime[]) => list.map(anime => <AnimeCard key={anime.id} anime={anime} saved={libraryEntries.some(entry => entry.anime.id === anime.id) || saved.some(item => item.id === anime.id)} favorite={favorites.some(item => item.id === anime.id)} progress={historyItems.find(item => item.anime.id === anime.id) ? 'Resume · Ep ' + historyItems.find(item => item.anime.id === anime.id)?.episode : undefined} onDetails={() => setSelected(anime)} onWatch={() => openWatch(anime)} onSave={() => save(anime)} onFavorite={() => favorite(anime)} />);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    document.title = selected ? `${titleOf(selected)} · AniTAG` : watching ? `Watching ${titleOf(watching)} · AniTAG` : 'AniTAG — Anime, picked for you';
  }, [selected, watching]);

  if (window.location.pathname !== '/') return <main className="not-found"><a className="wordmark" href="/"><BrandMark />AniTAG</a><span className="eyebrow">404 · PAGE NOT FOUND</span><h1>This page wandered<br/><span>off the screen.</span></h1><p>The address may be old, or the page may have moved.</p><a className="primary" href="/">Back to discover</a></main>;

  return <main className="shell">
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="AniTAG home"><BrandMark /><span>AniTAG</span></a>
      <button className="mobile-menu-toggle" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={19}/> : <Menu size={19}/>}</button>
      <nav className={mobileMenuOpen ? 'menu-open' : ''} aria-label="Main navigation">
        <button className={view === 'home' ? 'active' : ''} onClick={() => navigate('home')}><Home size={15}/> Home</button>
        <button className={view === 'browse' ? 'active' : ''} onClick={() => navigate('browse')}><Compass size={15}/> Browse</button>
        <button className={view === 'library' ? 'active' : ''} onClick={() => navigate('library')}><Library size={15}/> My Library <span className="count">{libraryEntries.length}</span></button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => navigate('history')}><History size={15}/> History</button>
        <button className={'settings-nav ' + (view === 'settings' ? 'active' : '')} onClick={() => navigate('settings')} title='Settings' aria-label='Settings'><Settings size={15}/><span>Settings</span></button>
      </nav>
      <div className="search-wrap" ref={searchBoxRef}>
        <form className="search" onSubmit={submitSearch}>
          <Search size={17}/>
          <input aria-label="Search anime" value={search} onFocus={() => setShowSuggestions(true)} onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }} placeholder="Search anime…"/>
          {search && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => { setSearch(''); setSuggestions([]); setShowSuggestions(false); }}><X size={14}/></button>}
          <button type="submit" aria-label="Submit search"><span>↵</span></button>
        </form>
        {showSuggestions && (search.trim().length >= 2 || (!search.trim() && recentSearches.length > 0)) && <div className="suggestions">
          <div className="suggestion-heading">{search.trim().length >= 2 ? 'SEARCH SUGGESTIONS' : 'RECENT SEARCHES'}</div>
          {search.trim().length >= 2 ? suggestions.length ? suggestions.map((anime) => <button className="suggestion-item" key={anime.id} onClick={() => chooseSuggestion(anime)}>
            <img src={anime.coverImage?.large || '/anime-fallback.svg'} alt="" loading="lazy" decoding="async" onError={event=>{event.currentTarget.src='/anime-fallback.svg'}} />
            <span className="suggestion-copy"><strong>{titleOf(anime)}</strong><small>{anime.seasonYear || 'Year unknown'} · {anime.format || 'Anime'}</small></span><ChevronDown className="suggestion-arrow" size={14}/>
          </button>) : <div className="suggestion-empty">Searching titles…</div> : recentSearches.map(term => <button className="recent-search-item" key={term} onClick={() => { setSearch(term); setCatalogTerm(term); setView('browse'); setShowSuggestions(false); void load('trending', term, 1, false); }}><Search size={13}/>{term}</button>)}
          {search.trim().length >= 2 && <button className="suggestion-all" onClick={() => submitSearch({ preventDefault: () => {} } as React.FormEvent)}>View all results <span>↗</span></button>}
        </div>}
      </div>
    </header>

    {view === 'home' && <>
    <section className="intro featured" style={items[0]?.bannerImage ? { backgroundImage: 'linear-gradient(90deg,rgba(8,8,10,.82) 3%,rgba(8,8,10,.56) 38%,rgba(8,8,10,.14) 78%),linear-gradient(0deg,#09090b 0%,transparent 58%),url("' + items[0].bannerImage + '")' } : undefined}>
      <div className="featured-copy"><div className="eyebrow"><span className="dot"/> FEATURED FOR YOU</div>
      <h1>{items[0] ? titleOf(items[0]) : <>Find your next<br/><span>favorite story.</span></>}</h1>
      <div className="featured-facts">{items[0]?.averageScore ? <span className="featured-score"><Star size={14} fill="currentColor"/> {(items[0].averageScore / 10).toFixed(1)}</span> : null}{items[0]?.seasonYear && <span>{items[0].seasonYear}</span>}{items[0]?.format && <span>{items[0].format}</span>}{items[0]?.episodes && <span>{items[0].episodes} episodes</span>}</div>
      <p>{items[0]?.description ? items[0].description.replace(/<[^>]*>/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"') : 'Discover anime, keep your personal watchlist, and pick up where you left off.'}</p>
      <div className="intro-actions">{items[0] && <button className="primary" onClick={() => openWatch(items[0])}><CirclePlay size={17}/> Watch now</button>}{items[0] && <button className="secondary" onClick={() => setSelected(items[0])}>More info</button>}<button className="secondary" onClick={() => navigate('library')}><Heart size={16}/> My library</button>{installPrompt && <button className="secondary install-button" onClick={() => void installApp()}><Download size={16}/> Install app</button>}</div></div>
    </section>
    <div className="home-rails">
      <section className="home-rail continue-rail"><div className="rail-heading"><div><div className="eyebrow">PICK UP WHERE YOU LEFT OFF</div><h2>Continue Watching</h2></div><button className="text-link" onClick={() => navigate('history')}>Watch history <ChevronRight size={15}/></button></div>{historyItems.length > 0 ? <div className="continue-row">{historyItems.slice(0,6).map(progress => <article className="continue-card" key={progress.anime.id}><button className="continue-cover" onClick={() => openWatch(progress.anime)}><img src={progress.anime.coverImage?.large || '/anime-fallback.svg'} alt="" onError={event=>{event.currentTarget.src='/anime-fallback.svg'}}/><span className="continue-play"><Play size={17} fill="currentColor"/></span><span className="continue-caption"><strong>{titleOf(progress.anime)}</strong><small>Episode {progress.episode} · {(progress.currentTime || 0) > 0 ? `${clockLabel(progress.currentTime || 0)} watched` : 'Ready to continue'}</small></span><span className="continue-progress"><i style={{width:(progress.duration ? Math.min(100,(progress.currentTime || 0)/progress.duration*100) : 8)+'%'}}/></span></button></article>)}</div> : <div className="continue-empty"><span className="empty-orbit"><History size={20}/></span><div><strong>Your watch journey starts here</strong><p>Open an episode and it will appear here, ready to continue.</p></div></div>}</section>
      <section className="home-rail"><div className="rail-heading"><div><div className="eyebrow">FRESH FROM THE GRAND LINE</div><h2>Trending Anime</h2></div><button className="text-link" onClick={() => navigate('browse')}>Browse all <ChevronRight size={15}/></button></div><div className="rail-grid">{renderAnimeCards(items.slice(0,10))}</div></section>
      <section className="home-rail" data-feed="popular"><div className="rail-heading"><div><div className="eyebrow">FAN FAVOURITES</div><h2>Popular Anime</h2></div><button className="text-link" onClick={() => { setView('browse'); changeMode('popular'); }}>View all <ChevronRight size={15}/></button></div><div className="rail-grid">{renderAnimeCards(popularItems.slice(0,10))}</div></section>
      <section className="home-rail" data-feed="rated"><div className="rail-heading"><div><div className="eyebrow">HIGHLY RATED</div><h2>Top Rated</h2></div><button className="text-link" onClick={() => navigate('browse')}>Explore <ChevronRight size={15}/></button></div><div className="rail-grid">{renderAnimeCards(topRatedItems.slice(0,10))}</div></section>
      <section className="home-rail" data-feed="seasonal"><div className="rail-heading"><div><div className="eyebrow">NOW AIRING</div><h2>{seasonTitle}</h2></div><button className="text-link" onClick={() => navigate('browse')}>Season guide <ChevronRight size={15}/></button></div><div className="rail-grid">{renderAnimeCards(seasonalItems.slice(0,10))}</div></section>
      <section className="home-rail" data-feed="recent"><div className="rail-heading"><div><div className="eyebrow">NEW STORIES</div><h2>Recently Added</h2></div><button className="text-link" onClick={() => navigate('browse')}>Browse all <ChevronRight size={15}/></button></div><div className="rail-grid">{renderAnimeCards(recentItems.slice(0,10))}</div></section>
      <section className="home-rail"><div className="rail-heading"><div><div className="eyebrow">PICKED FOR YOUR TASTE</div><h2>Recommended</h2></div><button className="text-link" onClick={() => navigate('library')}>Tune with favourites <ChevronRight size={15}/></button></div><div className="rail-grid">{renderAnimeCards(recommendedItems)}</div></section>
    </div></>}

    {view === 'browse' && <section id="catalog" className="catalog">
      <div className="section-head"><div><div className="eyebrow">THE CATALOG</div><h2>{heading}</h2><p className="result-count">{items.length ? `${filteredItems.length} of ${items.length} titles` : ''}</p></div><button className="icon-button" onClick={() => void load(mode, catalogTerm, 1, false)} title="Refresh"><RefreshCw size={16}/></button></div>
      {!loading && items.length > 0 && <div className="browse-toolbar"><div className="filter-controls"><select aria-label="Filter by genre" value={genreFilter} onChange={event=>setGenreFilter(event.target.value)}><option value=''>All genres</option>{[...new Set(items.flatMap(item=>item.genres))].sort().map(genre=><option key={genre}>{genre}</option>)}</select><select aria-label="Filter by year" value={yearFilter} onChange={event=>setYearFilter(event.target.value)}><option value=''>Any year</option>{[...new Set(items.map(item=>item.seasonYear).filter(Boolean))].sort((a,b)=>(b||0)-(a||0)).map(year=><option key={year} value={year!}>{year}</option>)}</select><select aria-label="Filter by format" value={formatFilter} onChange={event=>setFormatFilter(event.target.value)}><option value=''>Any format</option>{[...new Set(items.map(item=>item.format).filter(Boolean))].map(format=><option key={format!}>{format}</option>)}</select><select aria-label="Sort results" value={sortFilter} onChange={event=>setSortFilter(event.target.value)}><option value='relevance'>Relevance</option><option value='rating'>Top rated</option><option value='year'>Newest</option></select>{activeFilters&&<button className="text-link" onClick={()=>{setGenreFilter('');setYearFilter('');setFormatFilter('');setStatusFilter('')}}>Clear filters <X size={14}/></button>}</div><div className="layout-toggle"><button className={layout==='grid'?'selected':''} onClick={()=>setLayout('grid')} aria-label="Grid view"><LayoutGrid size={16}/></button><button className={layout==='list'?'selected':''} onClick={()=>setLayout('list')} aria-label="List view"><List size={16}/></button></div></div>}
      {loading ? <div className="state"><span className="spinner"/> Loading anime metadata…</div>
      : error ? <div className="state error"><p>{error}</p><button className="secondary" onClick={() => void load(mode, catalogTerm, 1, false)}>Try again</button></div>
      : filteredItems.length === 0 ? <div className="state">{items.length ? 'No titles match these filters.' : (mode === 'saved' ? 'Your list is empty. Save a title using the bookmark button.' : 'No results found. Try another title.')}</div>
      : items.length === 0 ? <div className="state">{mode === 'saved' ? 'Your list is empty. Save a title using the bookmark button.' : 'No results found. Try another title.'}</div>
      : <>
        <div className={`grid ${layout === 'list' ? 'list-layout' : ''}`}>{filteredItems.map((anime) => <article className="anime-card" key={anime.id}>
          <button className="poster-button" onClick={() => setSelected(anime)} aria-label={`Details for ${titleOf(anime)}`}>
            <img className="poster" src={anime.coverImage?.large || anime.coverImage?.extraLarge || '/anime-fallback.svg'} alt={titleOf(anime)} loading="lazy" decoding="async"/>
            <span className="poster-overlay"><CirclePlay size={30}/><span>View details</span></span>
          </button>
          <div className="card-meta"><div className="card-title" title={titleOf(anime)}>{titleOf(anime)}</div>
            <div className="muted-line">{anime.seasonYear || 'Year unknown'} <span>·</span> {anime.format || 'Anime'} {anime.episodes ? `· ${anime.episodes} eps` : ''}</div>
            <div className="card-bottom"><span className="score"><Star size={13} fill="currentColor"/>{anime.averageScore ? (anime.averageScore / 10).toFixed(1) : '—'}</span>
              <div className="card-actions"><button className="watch-card-button" onClick={() => openWatch(anime)} title="Watch episode"><Play size={13}/> Watch</button><button className={`save-button ${saved.some((item) => item.id === anime.id) ? 'saved' : ''}`} onClick={() => save(anime)} title="Toggle watchlist"><BookmarkPlus size={16}/></button></div>
            </div>
          </div>
        </article>)}</div>
        {mode !== 'saved' && hasNextPage && <div className="load-more-wrap"><button className="secondary load-more" disabled={loadingMore} onClick={() => void load(mode, catalogTerm, page + 1, true)}>{loadingMore ? <><span className="spinner small-spinner"/> Loading more…</> : <>Show more anime <ChevronDown size={16}/></>}</button></div>}
        {mode !== 'saved' && !hasNextPage && items.length > 0 && <p className="end-of-results">You’re all caught up with the available results.</p>}
      </>}
    </section>}

    {view === 'library' && <section className='page-section library-page'>
      <div className='page-title-row'><div><div className='eyebrow'>YOUR PERSONAL COLLECTION</div><h1>My Library</h1><p>Keep your watchlist, favourites, and anime progress together.</p></div><span className='library-total'>{libraryEntries.length} saved titles</span></div>
      <div className='library-tabs' role='tablist' aria-label='Library categories'>{([{id:'watchlist',label:'Watchlist'},{id:'favorites',label:'Favourites'},{id:'watching',label:'Watching'},{id:'completed',label:'Completed'},{id:'plan-to-watch',label:'Plan to Watch'},{id:'on-hold',label:'On Hold'},{id:'dropped',label:'Dropped'}] as {id:LibraryTab;label:string}[]).map(tab=><button key={tab.id} role='tab' aria-selected={libraryTab===tab.id} className={libraryTab===tab.id?'selected':''} onClick={()=>setLibraryTab(tab.id)}>{tab.label}<span>{tab.id==='favorites'?favorites.length:libraryEntries.filter(entry=>entry.status===tab.id).length}</span></button>)}</div>
      {libraryViewItems.length ? <div className='grid'>{renderAnimeCards(libraryViewItems)}</div> : <div className='empty-panel'><span className='empty-orbit'><Library size={25}/></span><h2>{libraryTab==='favorites'?'No favourites yet':'This shelf is waiting for a story'}</h2><p>{libraryTab==='favorites'?'Tap the heart on any anime to keep it close.':'Add a title from Browse, then use your library to organize it.'}</p><button className='primary' onClick={()=>navigate('browse')}>Explore anime</button></div>}
    </section>}

    {view === 'history' && <section className='page-section history-page'>
      <div className='page-title-row'><div><div className='eyebrow'>YOUR RECENT SESSIONS</div><h1>Watch History</h1><p>Resume from where you left off on this device.</p></div>{historyItems.length>0&&<button className='secondary clear-history' onClick={()=>setConfirmAction('history')}><Trash2 size={15}/> Clear history</button>}</div>
      {historyItems.length ? <div className='history-list'>{historyItems.map(progress=><article className='history-entry' key={progress.anime.id}><img src={progress.anime.coverImage?.large||'/anime-fallback.svg'} alt='' onError={event=>{event.currentTarget.src='/anime-fallback.svg'}}/><div className='history-entry-copy'><span className='eyebrow'>EPISODE {progress.episode}</span><h2>{titleOf(progress.anime)}</h2><p>Last watched {new Date(progress.updatedAt).toLocaleString()}</p><div className='history-progress'><i style={{width:(progress.duration?Math.min(100,(progress.currentTime||0)/progress.duration*100):0)+'%'}}/></div><small>{(progress.currentTime||0)>0?clockLabel(progress.currentTime||0)+' watched':'Saved episode · resume from start'} {progress.duration?' / '+clockLabel(progress.duration):''}</small></div><button className='watch-card-button resume-button' onClick={()=>openWatch(progress.anime)}><Play size={14}/> Resume</button><button className='save-button history-remove' aria-label={'Remove '+titleOf(progress.anime)+' from history'} title='Remove from history' onClick={()=>{setHistoryItems(removeHistoryItem(progress.anime.id));setNotice({kind:'success',message:'Removed from watch history.'})}}><X size={16}/></button></article>)}</div> : <div className='empty-panel'><span className='empty-orbit'><History size={25}/></span><h2>Your next session starts here</h2><p>Anime you watch will show up here with episode and progress details.</p><button className='primary' onClick={()=>navigate('browse')}>Find something to watch</button></div>}
    </section>}

    {view === 'settings' && <section className='page-section settings-page'>
      <div className='page-title-row'><div><div className='eyebrow'>MAKE IT YOURS</div><h1>Settings</h1><p>Shape how AniTAG looks and how your player behaves.</p></div></div>
      <div className='settings-layout'><div className='settings-nav-list'><a href='#appearance'>Appearance</a><a href='#player-settings'>Player</a><a href='#library-settings'>Library</a><a href='#about-settings'>About</a></div><div className='settings-content'>
        <section id='appearance' className='settings-card'><div className='settings-card-title'><div><span className='eyebrow'>VISUALS</span><h2>Appearance</h2></div></div><p>Choose a theme for this device.</p><div className='theme-options'>{([{id:'dark',label:'Dark',icon:<Moon size={17}/>},{id:'light',label:'Light',icon:<Sun size={17}/>},{id:'system',label:'System',icon:<Monitor size={17}/>} ] as {id:UserSettings['theme'];label:string;icon:React.ReactNode}[]).map(item=><button key={item.id} className={settings.theme===item.id?'selected':''} onClick={()=>updateSettings({theme:item.id})}>{item.icon}{item.label}</button>)}</div><div className='palette-picker' aria-label='Accent colour'><span className='palette-label'>Accent palette</span><div className='palette-options'>{([{id:'graphite',label:'Graphite',color:'#bec3ce'},{id:'ocean',label:'Ocean',color:'#82b7c7'},{id:'violet',label:'Violet',color:'#b39bd5'},{id:'rose',label:'Rose',color:'#d496a4'},{id:'amber',label:'Amber',color:'#d2b17b'}] as {id:UserSettings['palette'];label:string;color:string}[]).map(item=><button key={item.id} className={'palette-option '+((settings.palette||'graphite')===item.id?'selected':'')} aria-pressed={(settings.palette||'graphite')===item.id} onClick={()=>updateSettings({palette:item.id})}><i style={{backgroundColor:item.color}}/><span>{item.label}</span></button>)}</div></div></section>
        <section id='player-settings' className='settings-card'><div><span className='eyebrow'>PLAYBACK</span><h2>Player preferences</h2></div><label className='setting-row'><span><strong>Autoplay next episode</strong><small>Move to the next episode when this one ends.</small></span><input type='checkbox' checked={settings.autoplayNext} onChange={event=>updateSettings({autoplayNext:event.target.checked})}/></label><label className='setting-row'><span><strong>Default playback speed</strong><small>New playback sessions start at this speed.</small></span><select value={settings.playbackSpeed} onChange={event=>updateSettings({playbackSpeed:Number(event.target.value)})}><option value='0.75'>0.75×</option><option value='1'>1×</option><option value='1.25'>1.25×</option><option value='1.5'>1.5×</option><option value='2'>2×</option></select></label><label className='setting-row'><span><strong>Subtitle preference</strong><small>Applied when a matching track is available.</small></span><select value={settings.subtitleLanguage} onChange={event=>updateSettings({subtitleLanguage:event.target.value})}><option value='off'>Off by default</option><option value='en'>English</option><option value='ja'>Japanese</option></select></label><label className='setting-row'><span><strong>Audio preference</strong><small>Choose your preferred track when available.</small></span><select value={settings.audioLanguage} onChange={event=>updateSettings({audioLanguage:event.target.value as 'sub'|'dub'})}><option value='sub'>Japanese · SUB</option><option value='dub'>English · DUB</option></select></label></section>
        <section id='library-settings' className='settings-card'><div><span className='eyebrow'>LOCAL DATA</span><h2>Library & history</h2></div><p>Your saved titles and watch progress stay in this browser.</p><div className='settings-actions'><button className='secondary' onClick={downloadBackup}><Download size={14}/> Export backup</button><label className='secondary backup-import'><Download size={14}/> Import backup<input type='file' accept='application/json,.json' onChange={event=>{void restoreBackup(event.target.files?.[0]);event.currentTarget.value=''}}/></label><button className='secondary' onClick={()=>setConfirmAction('history')}><Trash2 size={14}/> Clear watch history</button><button className='secondary' onClick={()=>setConfirmAction('progress')}><Trash2 size={14}/> Clear saved progress</button><button className='danger-button' onClick={()=>setConfirmAction('reset')}><RotateCcw size={14}/> Reset AniTAG</button></div></section>
        <section id='about-settings' className='settings-card about-settings'><div><span className='eyebrow'>ABOUT</span><h2>AniTAG</h2></div><p>Anime discovery and your personal library, in one cinematic space.</p><div className='about-meta'><span>Version <strong>0.2.0</strong></span><span>Metadata by <a href='https://anilist.co' target='_blank' rel='noreferrer'>AniList ↗</a></span><span className={isOnline?'online-state':'offline-state'}>{isOnline?'Online':'Offline'}</span></div>{installPrompt?<button className='primary install-action' onClick={()=>void installApp()}><Download size={15}/> Install AniTAG</button>:<small className='install-hint'>Install option appears when your browser supports it.</small>}</section>
      </div></div>
    </section>}

    {view === 'about' && <section className='page-section info-page'><div className='eyebrow'>OUR VOYAGE</div><h1>AniTAG, for anime fans.</h1><p>Discover anime, keep a personal watchlist, and pick up where you left off in one cinematic space.</p><div className='info-panels'><article><span className='eyebrow'>DISCOVER</span><h2>Find your next story</h2><p>Explore trending, popular, seasonal and top rated anime. Metadata is provided by AniList.</p></article><article><span className='eyebrow'>YOUR LIBRARY</span><h2>Made for your device</h2><p>Watch progress, favourites, settings and your library are saved locally in this browser. Use browser backup tools to keep your data portable.</p></article><article><span className='eyebrow'>PLAYBACK</span><h2>Bring an authorized source</h2><p>AniTAG needs a separately configured streaming API that you are authorized to use. AniList provides metadata, not video.</p></article></div></section>}
    {view === 'contact' && <section className='page-section info-page'><div className='eyebrow'>SAY HELLO</div><h1>Contact</h1><p>Questions, feedback, or a bug to report? Use the project contact address configured by its maintainer.</p>{import.meta.env.VITE_CONTACT_EMAIL ? <a className='primary' href={'mailto:'+import.meta.env.VITE_CONTACT_EMAIL+'?subject='+encodeURIComponent('AniTAG feedback')}>Email AniTAG support</a> : <div className='contact-note'>Contact email is not configured yet. The site maintainer can set <code>VITE_CONTACT_EMAIL</code> in the frontend environment.</div>}</section>}
    
    <footer className="site-footer"><div className="footer-brand"><a className="wordmark small" href="/" aria-label="AniTAG home"><BrandMark />AniTAG</a><p>Your next story is one click away.</p></div><div className="footer-links"><button className="footer-link" onClick={() => {navigate('home');changeMode('trending')}}>Discover anime</button><button className="footer-link" onClick={() => navigate('library')}>My library</button><button className="footer-link" onClick={() => navigate('about')}>About AniTAG</button><button className="footer-link" onClick={() => navigate('contact')}>Contact</button><a href="https://anilist.co" target="_blank" rel="noreferrer">Metadata by AniList ↗</a></div><div className="footer-bottom"><span className="footer-status"><span className="dot"/> Metadata loads on demand</span><span>Progress is saved on this device</span><span>© {new Date().getFullYear()} AniTAG</span></div></footer>

    {notice && <div className={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <CheckCircle2 size={17}/> : <AlertCircle size={17}/>}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15}/></button></div>}


    {!isOnline && <div className='offline-banner' role='status'><WifiOff size={15}/> Offline mode · saved titles are available</div>}
    {confirmAction && <div className='modal-backdrop confirm-backdrop' onMouseDown={event=>{if(event.target===event.currentTarget)setConfirmAction(null)}}><section className='confirm-dialog' role='alertdialog' aria-modal='true' aria-labelledby='confirm-title'><span className='empty-orbit'><Trash2 size={22}/></span><h2 id='confirm-title'>{confirmAction==='history'?'Clear watch history?':confirmAction==='progress'?'Clear saved progress?':'Reset AniTAG?'}</h2><p>{confirmAction==='history'?'This removes your recent viewing sessions from this browser.':confirmAction==='progress'?'This clears all saved episode progress from your library.':'This resets your library, favourites, history, and preferences on this device.'}</p><div className='confirm-actions'><button className='secondary' onClick={()=>setConfirmAction(null)}>Cancel</button><button className='danger-button' onClick={()=>clearData(confirmAction)}>Confirm</button></div></section></div>}
    {selected && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
      <section className="detail-modal" role="dialog" aria-modal="true" aria-label={titleOf(selected)}>
        <button className="close" onClick={() => setSelected(null)} aria-label="Close">×</button>
        {selected.bannerImage && <img className="detail-banner" src={selected.bannerImage} alt=""/>}
        <div className="detail-content"><div className="eyebrow">ANIME DETAILS</div><h2>{titleOf(selected)}</h2>
          <div className="detail-stats"><span><Star size={14}/> {selected.averageScore ? `${selected.averageScore / 10}/10` : 'Unrated'}</span><span><Tv size={14}/> {selected.episodes ?? '?'} episodes</span><span>{selected.seasonYear ?? 'Year unknown'}</span></div>
          <p className={expandedDescription ? 'full-description' : 'clamped-description'}>{(selected.description || 'No description available.').replace(/<[^>]*>/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"')}</p><button className='text-link description-toggle' onClick={()=>setExpandedDescription(value=>!value)}>{expandedDescription?'Show less':'Read full synopsis'} <ChevronDown size={14}/></button>
          <div className="genres">{(selected.genres || []).map((genre) => <span key={genre}>{genre}</span>)}</div>
          <div className="detail-actions"><button className="primary" onClick={() => openWatch(selected)}><Play size={16}/> Watch episodes</button><button className="secondary" onClick={() => save(selected)}><BookmarkPlus size={16}/>{saved.some((item) => item.id === selected.id) ? 'Remove from list' : 'Add to watchlist'}</button><button className="secondary" aria-label="Add to favourites" onClick={()=>favorite(selected)}><Heart size={16}/>{favorites.some(item=>item.id===selected.id)?'Favourited':'Favourite'}</button><button className="secondary share-button" onClick={()=>void shareAnime(selected)}><Share2 size={16}/> Share</button></div><label className='status-picker'>Library status <select value={libraryEntries.find(entry=>entry.anime.id===selected.id)?.status||'watchlist'} onChange={event=>event.target.value==='remove'?(setLibraryEntries(removeFromLibrary(selected.id)),setSaved(getWatchlist()),setNotice({kind:'success',message:'Removed from your library.'})):chooseLibraryStatus(selected,event.target.value as LibraryStatus)}><option value='watchlist'>Watchlist</option><option value='watching'>Watching</option><option value='completed'>Completed</option><option value='plan-to-watch'>Plan to watch</option><option value='on-hold'>On hold</option><option value='dropped'>Dropped</option><option value='remove'>Remove from library</option></select></label>{libraryEntries.some(entry=>entry.anime.id===selected.id)&&<button className='text-link remove-library' onClick={()=>{setLibraryEntries(removeFromLibrary(selected.id));setSaved(getWatchlist());setNotice({kind:'success',message:'Removed from your library.'})}}>Remove from library <X size={14}/></button>}
          <p className="notice">Playback needs a compatible streaming API configured in .env. Only connect sources you are authorized to stream.</p>
        </div>
      </section>
    </div>}

    {watching && <div className="watch-backdrop">
      <section className="watch-page" role="dialog" aria-modal="true" aria-label={`Watch ${titleOf(watching)}`}>
        <header className="watch-header">
          <button className="secondary watch-back" onClick={() => { setWatching(null); setCurrentEpisode(null); setStreamSources([]); }}>← Back</button>
          <div className="watch-heading"><strong>{titleOf(watching)}</strong><span>{currentEpisode ? `Episode ${currentEpisode.number} · ${currentEpisode.title}` : 'Episode player'}</span></div>
          <button className="close watch-close" onClick={() => { setWatching(null); setCurrentEpisode(null); }} aria-label="Close player">×</button>
        </header>
        <div className="watch-layout">
          <div className="watch-main">
            {currentEpisode && currentSource && !sourcesLoading
              ? <Suspense fallback={<div className="video-placeholder"><span className="spinner"/><span>Preparing player…</span></div>}><VideoPlayer key={playerAttempt} source={currentSource} onError={handlePlayerError} startTime={resumeTime} defaultSpeed={settings.playbackSpeed} onProgress={updateProgress} onEnded={() => { if (settings.autoplayNext) changeEpisode(1); }} subtitleLanguage={settings.subtitleLanguage} /></Suspense>
              : <div className="video-placeholder">
                  {episodesLoading || sourcesLoading ? <><span className="spinner"/> <span>Loading {episodesLoading ? 'episodes' : 'stream'}…</span></>
                    : <><Play size={32}/><strong>{watchError ? 'Episodes unavailable' : 'No playable stream selected'}</strong><span>{watchError || playerError || 'Choose an episode to begin.'}</span></>}
                </div>}
            {playerError && <div className="stream-alert" role="alert"><span>{playerError}</span><button className="secondary" onClick={() => { setPlayerError(''); if (streamSources.length) setPlayerAttempt((attempt) => attempt + 1); else if (currentEpisode) setCurrentEpisode({ ...currentEpisode }); }}>Retry</button></div>}
            <div className="watch-controls-row">
              <div className="audio-toggle" aria-label="Audio language">
                <button className={watchAudio === 'sub' ? 'selected' : ''} disabled={!watchEpisodes.some((ep) => ep.audio === 'sub')} onClick={() => chooseAudio('sub')}>Japanese · SUB</button>
                <button className={watchAudio === 'dub' ? 'selected' : ''} disabled={!watchEpisodes.some((ep) => ep.audio === 'dub')} onClick={() => chooseAudio('dub')}>DUB</button>
              </div>
              <label className="server-select">Source
                <select value={currentEpisode?.id || ''} disabled={currentEpisodeSources.length < 2} onChange={(e) => { const next = currentEpisodeSources.find((ep) => ep.id === e.target.value); if (next) setCurrentEpisode(next); }}>
                  {currentEpisodeSources.map((ep) => <option key={ep.id} value={ep.id}>{ep.providerLabel}</option>)}
                </select>
              </label>
              <label className="server-select">Stream
                <select value={String(Math.max(0, streamOptions.indexOf(currentSource || streamSources[sourceIndex])))} disabled={streamOptions.length < 2} onChange={(e) => { const source = streamOptions[Number(e.target.value)]; if (!source) return; setSourceIndex(streamSources.indexOf(source)); setCurrentSource(source); setPlayerError(''); }}>
                  {streamOptions.map((source, index) => <option key={`${source.url}-${index}`} value={String(index)}>{source.label || source.server || `Server ${index + 1}`}</option>)}
                </select>
              </label>
            </div>
            <div className="episode-nav">
              <button className="secondary" disabled={!currentEpisode || !episodeNumbers.some((n) => n < currentEpisode.number)} onClick={() => changeEpisode(-1)}>← Previous episode</button>
              <button className="secondary" disabled={!currentEpisode || !episodeNumbers.some((n) => n > currentEpisode.number)} onClick={() => changeEpisode(1)}>Next episode →</button>
            </div>
            {watchError && <div className="watch-setup"><strong>Streaming API setup</strong><p>{watchError}</p><button className="secondary" onClick={() => { setWatchError(''); setWatching({ ...watching }); }}>Retry episode list</button><p>Set <code>VITE_STREAM_API_BASE</code> in AniTAG's <code>.env</code> to your compatible API URL, then restart <code>npm run dev</code>. The API must return episode IDs and playable source URLs from its <code>/episodes/:id</code> and watch endpoints.</p><small>Configured API: {getStreamApiBase()}</small></div>}
          </div>
          <aside className="episode-sidebar">
            <div className="episode-sidebar-head"><div><strong>Episodes</strong><small>{episodeNumbers.length} available in this audio mode</small></div><span className="audio-chip">{watchAudio.toUpperCase()}</span></div>
            <div className="episode-filters"><input aria-label="Search episodes" placeholder="Search episodes…" value={episodeSearch} onChange={event=>setEpisodeSearch(event.target.value)}/>{episodeRanges.length>1&&<select aria-label="Episode range" value={episodeRange} onChange={event=>setEpisodeRange(event.target.value)}><option value="all">All episodes</option>{episodeRanges.map(range=><option key={range.value} value={range.value}>{range.label}</option>)}</select>}</div>
            {episodesLoading ? <div className="episode-list-state"><span className="spinner"/> Loading episode list…</div>
              : visibleEpisodeNumbers.length ? <div className="episode-list">{visibleEpisodeNumbers.map((number) => {
                  const ep = watchEpisodes.find((item) => item.number === number && item.audio === watchAudio);
                  if (!ep) return null;
                  return <button key={number} className={`episode-row ${currentEpisode?.number === number ? 'active' : ''}`} onClick={() => chooseEpisode(number)}><span className="episode-number">{String(number).padStart(2, '0')}</span><span className="episode-row-copy"><strong>{ep.title}</strong><small>{ep.providerLabel}</small></span><Play size={14}/></button>;
                })}</div>
              : <div className="episode-list-state">{watchError || 'No episodes for this audio mode.'}</div>}
          </aside>
        </div>
      </section>
    </div>}
  </main>;
}

export default App;
