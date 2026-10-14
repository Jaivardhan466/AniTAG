import type { Anime, AnimeConnection } from '../types/anime';

const ENDPOINT = 'https://graphql.anilist.co';
const CACHE_TTL = 5 * 60 * 1000;
const responseCache = new Map<string, { expires: number; value: unknown }>();
const pendingRequests = new Map<string, Promise<unknown>>();
const ANIME_FIELDS = `
  id idMal
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large color }
  bannerImage episodes status season seasonYear averageScore genres format
`;

async function query<T>(queryText: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = JSON.stringify([queryText, variables]); const cached = responseCache.get(key); if (cached && cached.expires > Date.now()) return cached.value as T;
  const pending = pendingRequests.get(key); if (pending) return pending as Promise<T>;
  const request = (async (): Promise<T> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: queryText, variables }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('AniList rate limit reached. Wait a little and retry.');
    throw new Error(`AniList request failed (${response.status}). Please retry.`);
  }
  const payload = await response.json() as { data?: T; errors?: { message?: string }[] };
  if (payload.errors?.length) throw new Error(payload.errors[0]?.message || 'AniList returned an error.');
  if (!payload.data) throw new Error('AniList returned an empty response.');
  responseCache.set(key, { expires: Date.now() + CACHE_TTL, value: payload.data });
  return payload.data;
  })();
  pendingRequests.set(key, request);
  try { return await request; } finally { pendingRequests.delete(key); }
}

// AniList calls the result list `media`; the app uses the normalized name `nodes`.
// Normalize the API response here so React never receives an undefined `items` array.
type AniListPage = { media?: Anime[]; pageInfo?: { currentPage: number; hasNextPage: boolean } };
function normalizePage(page: AniListPage | undefined): AnimeConnection {
  return {
    nodes: Array.isArray(page?.media) ? page.media : [],
    pageInfo: page?.pageInfo ?? { currentPage: 1, hasNextPage: false },
  };
}

export async function getTrending(page = 1): Promise<AnimeConnection> {
  const data = await query<{ Page?: AniListPage }>(`query ($page: Int) { Page(page: $page, perPage: 24) { pageInfo { currentPage hasNextPage } media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${ANIME_FIELDS} } } }`, { page });
  return normalizePage(data.Page);
}

export async function getPopular(page = 1): Promise<AnimeConnection> {
  const data = await query<{ Page?: AniListPage }>(`query ($page: Int) { Page(page: $page, perPage: 24) { pageInfo { currentPage hasNextPage } media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${ANIME_FIELDS} } } }`, { page });
  return normalizePage(data.Page);
}

export async function searchAnime(search: string, page = 1): Promise<AnimeConnection> {
  const data = await query<{ Page?: AniListPage }>(`query ($search: String, $page: Int) { Page(page: $page, perPage: 24) { pageInfo { currentPage hasNextPage } media(type: ANIME, search: $search, sort: SEARCH_MATCH, isAdult: false) { ${ANIME_FIELDS} } } }`, { search, page });
  return normalizePage(data.Page);
}

export async function getAnimeById(id: number): Promise<Anime> {
  const data = await query<{ Media: Anime }>(`query ($id: Int) { Media(id: $id, type: ANIME) { ${ANIME_FIELDS} } }`, { id });
  return data.Media;
}


export async function getTopRated(page = 1): Promise<AnimeConnection> {
  const queryText = 'query ($page: Int) { Page(page: $page, perPage: 24) { pageInfo { currentPage hasNextPage } media(type: ANIME, sort: SCORE_DESC, isAdult: false) { ' + ANIME_FIELDS + ' } } }';
  const data = await query<{ Page?: AniListPage }>(queryText, { page });
  return normalizePage(data.Page);
}

export async function getRecentlyAdded(page = 1): Promise<AnimeConnection> {
  const queryText = 'query ($page: Int) { Page(page: $page, perPage: 24) { pageInfo { currentPage hasNextPage } media(type: ANIME, sort: START_DATE_DESC, isAdult: false) { ' + ANIME_FIELDS + ' } } }';
  const data = await query<{ Page?: AniListPage }>(queryText, { page });
  return normalizePage(data.Page);
}

export async function getSeasonal(season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL', seasonYear: number, page = 1): Promise<AnimeConnection> {
  const queryText = 'query ($page: Int, $season: MediaSeason, $seasonYear: Int) { Page(page: $page, perPage: 24) { pageInfo { currentPage hasNextPage } media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, isAdult: false) { ' + ANIME_FIELDS + ' } } }';
  const data = await query<{ Page?: AniListPage }>(queryText, { page, season, seasonYear });
  return normalizePage(data.Page);
}
