export interface AnimeTitle {
  romaji: string | null;
  english: string | null;
  native: string | null;
}

export interface Anime {
  id: number;
  idMal: number | null;
  title: AnimeTitle;
  description: string | null;
  coverImage: { extraLarge: string | null; large: string | null; color: string | null };
  bannerImage: string | null;
  episodes: number | null;
  status: string | null;
  season: string | null;
  seasonYear: number | null;
  averageScore: number | null;
  genres: string[];
  format: string | null;
}

export interface AnimeConnection { nodes: Anime[]; pageInfo: { currentPage: number; hasNextPage: boolean } }
