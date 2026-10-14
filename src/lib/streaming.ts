export type AudioMode = 'sub' | 'dub';
export interface StreamSubtitle { url: string; label?: string; srclang?: string; language?: string; format?: string; default?: boolean }
export interface StreamSource { url: string; type?: string; server?: string; label?: string; referer?: string; subtitles?: StreamSubtitle[]; isActive?: boolean; priority?: number }
export interface PlayableEpisode { id: string; number: number; title: string; audio: AudioMode; provider: string; providerLabel: string; duration?: number }
export interface ProviderEpisodes { meta?: { title?: string; source?: string }; episodes?: { sub?: unknown[]; dub?: unknown[] } }

const episodeCachePrefix = 'anitag:provider-episodes:v1:';
const episodeCacheTtl = 12 * 60 * 60 * 1000;
const episodeProviderGroups = [['animegg', 'anikoto'], ['mkissa', 'anibd']];

const localApiBase = import.meta.env.DEV && typeof window !== 'undefined' ? `${window.location.origin}/api` : '';
// Production Render deployment serves the UI and API from the same HTTPS origin.
const productionApiBase = typeof window !== 'undefined' ? (import.meta.env.VITE_STREAM_API_BASE || window.location.origin) : (import.meta.env.VITE_STREAM_API_BASE || '');
const base = (import.meta.env.DEV ? localApiBase : productionApiBase).replace(/\/+$/, '');

async function requestJson<T>(path: string, timeoutMs = 20000): Promise<T> {
  if (!base) throw new Error('Playback API is not configured for this hosted build. Set VITE_STREAM_API_BASE to an API you operate or are authorized to use.');
  let response: Response;
  try {
    response = await fetch(`${base}/${path.replace(/^\/+/, '')}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`The API timed out while loading ${path}. Provider searches can be slow; try again in a moment.`);
    }
    throw new Error(`Can't reach the streaming API at ${base}. Start your compatible API server or set VITE_STREAM_API_BASE in .env.`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(payload?.error || payload?.message || `Streaming API returned ${response.status} for ${path}.`);
  }
  return response.json() as Promise<T>;
}

function asEpisode(raw: unknown, provider: string, audio: AudioMode): PlayableEpisode | null {
  if (!raw || typeof raw !== 'object') return null;
  const ep = raw as Record<string, unknown>;
  const number = Number(ep.number ?? ep.episodeNumber);
  const id = typeof ep.id === 'string' ? ep.id.replace(/^\//, '') : '';
  if (!id || !Number.isFinite(number) || number < 1) return null;
  return {
    id,
    number,
    title: typeof ep.title === 'string' && ep.title.trim() ? ep.title : `Episode ${number}`,
    audio,
    provider,
    providerLabel: typeof ep.server === 'string' ? ep.server : provider,
    duration: typeof ep.duration === 'number' ? ep.duration : undefined,
  };
}

function parsePlayableEpisodes(payload: Record<string, unknown>): Map<string, PlayableEpisode[]> {
  const result = new Map<string, PlayableEpisode[]>();
  for (const [provider, raw] of Object.entries(payload)) {
    if (!raw || typeof raw !== 'object') continue;
    const data = raw as ProviderEpisodes;
    if (!data.episodes) continue;
    const episodes: PlayableEpisode[] = [];
    for (const rawEpisode of Array.isArray(data.episodes.sub) ? data.episodes.sub : []) {
      const episode = asEpisode(rawEpisode, provider, 'sub');
      if (episode) episodes.push(episode);
    }
    for (const rawEpisode of Array.isArray(data.episodes.dub) ? data.episodes.dub : []) {
      const episode = asEpisode(rawEpisode, provider, 'dub');
      if (episode) episodes.push(episode);
    }
    result.set(provider, episodes);
  }
  return result;
}

function flattenProviderEpisodes(byProvider: Map<string, PlayableEpisode[]>): PlayableEpisode[] {
  const providerOrder = ['animegg', 'anikoto', 'mkissa', 'anibd'];
  return [...byProvider.values()].flat().sort((a, b) => a.number - b.number ||
    (providerOrder.indexOf(a.provider) - providerOrder.indexOf(b.provider)) ||
    a.audio.localeCompare(b.audio));
}

function readEpisodeCache(anilistId: number): PlayableEpisode[] {
  try {
    const raw = localStorage.getItem(`${episodeCachePrefix}${anilistId}`);
    if (!raw) return [];
    const cached = JSON.parse(raw) as { savedAt?: number; episodes?: PlayableEpisode[] };
    if (!cached.savedAt || Date.now() - cached.savedAt > episodeCacheTtl || !Array.isArray(cached.episodes)) return [];
    return cached.episodes.filter((episode) => typeof episode?.id === 'string' && Number.isFinite(episode.number));
  } catch { return []; }
}

function writeEpisodeCache(anilistId: number, episodes: PlayableEpisode[]) {
  try {
    const key = `${episodeCachePrefix}${anilistId}`;
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), episodes }));
    const keys = Object.keys(localStorage).filter((item) => item.startsWith(episodeCachePrefix));
    if (keys.length > 8) {
      keys.filter((item) => item !== key)
        .sort((a, b) => Number(JSON.parse(localStorage.getItem(a) || '{}').savedAt || 0) - Number(JSON.parse(localStorage.getItem(b) || '{}').savedAt || 0))
        .slice(0, keys.length - 8)
        .forEach((item) => localStorage.removeItem(item));
    }
  } catch { /* The player still works when storage is full or unavailable. */ }
}

export async function getPlayableEpisodes(anilistId: number, onUpdate?: (episodes: PlayableEpisode[]) => void): Promise<PlayableEpisode[]> {
  const byProvider = new Map<string, PlayableEpisode[]>();
  const cached = readEpisodeCache(anilistId);
  if (cached.length) {
    for (const episode of cached) {
      const providerEpisodes = byProvider.get(episode.provider) || [];
      providerEpisodes.push(episode);
      byProvider.set(episode.provider, providerEpisodes);
    }
    onUpdate?.(flattenProviderEpisodes(byProvider));
  }

  for (const group of episodeProviderGroups) {
    await Promise.allSettled(group.map(async (provider) => {
      const payload = await requestJson<Record<string, unknown>>(`episodes/${provider}/${anilistId}?map=false`, 90000);
      const parsed = parsePlayableEpisodes(payload);
      const fresh = parsed.get(provider);
      if (!fresh?.length) return;
      byProvider.set(provider, fresh);
      const episodes = flattenProviderEpisodes(byProvider);
      writeEpisodeCache(anilistId, episodes);
      onUpdate?.(episodes);
    }));
  }

  const episodes = flattenProviderEpisodes(byProvider);
  if (episodes.length) writeEpisodeCache(anilistId, episodes);
  return episodes;
}

export async function getEpisodeSources(episode: PlayableEpisode): Promise<StreamSource[]> {
  const payload = await requestJson<{ streams?: StreamSource[]; sources?: StreamSource[]; subtitles?: StreamSubtitle[] }>(episode.id);
  const streams = Array.isArray(payload.streams) ? payload.streams : Array.isArray(payload.sources) ? payload.sources : [];
  const proxyHosts: string[] = String(import.meta.env.VITE_STREAM_PROXY_HOSTS || 'flixcloud.cc').split(',').map((host: string) => host.trim().toLowerCase()).filter(Boolean);
  return streams.filter((source) => typeof source.url === 'string' && /^https?:\/\//i.test(source.url)).map((source) => {
    const isEmbed = source.type?.toLowerCase() === 'embed';
    const host = new URL(source.url).hostname.toLowerCase();
    const shouldProxy = !isEmbed && proxyHosts.some((suffix: string) => host === suffix || host.endsWith(`.${suffix}`));
    const referer = source.referer ? new URL(source.referer).origin : new URL(source.url).origin;
    const proxiedUrl = (url: string) => {
      const endpoint = new URL(`${base}/proxy`);
      endpoint.searchParams.set('url', url);
      endpoint.searchParams.set('referer', referer);
      return endpoint.toString();
    };
    const subtitles = source.subtitles || payload.subtitles || [];
    return {
      ...source,
      url: shouldProxy ? proxiedUrl(source.url) : source.url,
      subtitles: subtitles.map((subtitle) => ({ ...subtitle, url: shouldProxy ? proxiedUrl(subtitle.url) : subtitle.url })),
    };
  });
}

export function getStreamApiBase() { return base; }
