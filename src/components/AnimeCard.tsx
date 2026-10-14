import { BookmarkPlus, CheckCircle2, CirclePlay, Heart, Play, Star } from 'lucide-react';
import type { Anime } from '../types/anime';

interface Props { anime: Anime; saved: boolean; favorite: boolean; progress?: string; onDetails: () => void; onWatch: () => void; onSave: () => void; onFavorite: () => void }
const titleOf = (anime: Anime) => anime.title?.english || anime.title?.romaji || anime.title?.native || 'Untitled anime';
export default function AnimeCard({ anime, saved, favorite, progress, onDetails, onWatch, onSave, onFavorite }: Props) {
  return <article className='anime-card'>
    <button className='poster-button' onClick={onDetails} aria-label={'Details for ' + titleOf(anime)}>
      <img className='poster' src={anime.coverImage?.large || anime.coverImage?.extraLarge || '/anime-fallback.svg'} alt={titleOf(anime)} loading='lazy' decoding='async' onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/anime-fallback.svg'; }} />
      <span className='poster-overlay'><CirclePlay size={30}/><span>Quick details</span></span>
      {anime.status && <span className='poster-status'>{anime.status.replaceAll('_', ' ')}</span>}
      {progress && <span className='poster-progress'>{progress}</span>}
    </button>
    <div className='card-meta'><div className='card-title' title={titleOf(anime)}>{titleOf(anime)}</div>
      <div className='muted-line'>{anime.seasonYear || 'Year unknown'} <span>·</span> {anime.format || 'Anime'} {anime.episodes ? '· ' + anime.episodes + ' eps' : ''}</div>
      <div className='card-bottom'><span className='score'><Star size={13} fill='currentColor'/>{anime.averageScore ? (anime.averageScore / 10).toFixed(1) : '—'}</span>
        <div className='card-actions'><button className='watch-card-button' onClick={onWatch} title='Watch anime'><Play size={13}/> Watch</button><button className={'save-button favorite-button' + (favorite ? ' saved' : '')} onClick={onFavorite} title={favorite ? 'Remove favorite' : 'Add to favorites'} aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}><Heart size={15} fill={favorite ? 'currentColor' : 'none'}/></button><button className={'save-button' + (saved ? ' saved' : '')} onClick={onSave} title={saved ? 'Remove from library' : 'Add to library'} aria-label={saved ? 'Remove from library' : 'Add to library'}>{saved ? <CheckCircle2 size={15}/> : <BookmarkPlus size={15}/>}</button></div>
      </div>
    </div>
  </article>;
}
