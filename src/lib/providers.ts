/** Stable boundary between AniTAG's UI and any authorized playback integration. */
export interface Episode { id: string; number: number; title?: string; language?: 'sub' | 'dub' | 'unknown' }
export interface PlaybackSource { id: string; label: string; url: string; mimeType?: string; subtitles?: { language: string; label: string; url: string }[] }
export interface AnimeProvider {
  readonly id: string;
  readonly label: string;
  search(title: string): Promise<{ id: string; title: string }[]>;
  getEpisodes(animeId: string): Promise<Episode[]>;
  getSources(episodeId: string): Promise<PlaybackSource[]>;
}

/** Providers are intentionally not wired until a source is verified and authorized. */
export class ProviderRegistry {
  private readonly providers = new Map<string, AnimeProvider>();
  register(provider: AnimeProvider): void { this.providers.set(provider.id, provider); }
  getAll(): AnimeProvider[] { return [...this.providers.values()]; }
  get(id: string): AnimeProvider | undefined { return this.providers.get(id); }
}
export const providerRegistry = new ProviderRegistry();
