import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Maximize, Pause, Play, RotateCcw, RotateCw, Subtitles, Volume2, VolumeX } from 'lucide-react';
import type Hls from 'hls.js';
import type { StreamSource } from '../lib/streaming';

interface Props { source: StreamSource | null; onError: (message: string) => void; startTime?: number; defaultSpeed?: number; onProgress?: (current: number, duration: number) => void; onEnded?: () => void; subtitleLanguage?: string }
const clock = (seconds: number) => { const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };

export default function VideoPlayer({ source, onError, startTime = 0, defaultSpeed = 1, onProgress, onEnded, subtitleLanguage = 'off' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null); const stageRef = useRef<HTMLDivElement>(null); const lastSavedRef = useRef(0); const lastUiUpdateRef = useRef(0); const resumedRef = useRef(false);
  const [loading, setLoading] = useState(false); const [playing, setPlaying] = useState(false); const [currentTime, setCurrentTime] = useState(0); const [duration, setDuration] = useState(0); const [muted, setMuted] = useState(false); const [volume, setVolume] = useState(1); const [speed, setSpeed] = useState(1); const [captionTrack, setCaptionTrack] = useState(-1); const [fullscreen, setFullscreen] = useState(false);
  const insecureEmbed = Boolean(source?.type?.toLowerCase() === 'embed' && typeof window !== 'undefined' && !window.isSecureContext);

  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    const updateTime = () => { const now = video.currentTime || 0; const total = Number.isFinite(video.duration) ? video.duration : 0; if (now - lastUiUpdateRef.current >= 0.25) { lastUiUpdateRef.current = now; setCurrentTime(now); } if (onProgress && now - lastSavedRef.current >= 8) { lastSavedRef.current = now; onProgress(now, total); } }; const updateDuration = () => { const total = Number.isFinite(video.duration) ? video.duration : 0; setDuration(total); video.playbackRate = defaultSpeed; if (!resumedRef.current && startTime > 5 && startTime < total - 10) { video.currentTime = startTime; resumedRef.current = true; } }; const saveOnPause = () => { if (video.currentTime > 0) { lastSavedRef.current = video.currentTime; onProgress?.(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0); } }; const updateEnded = () => { onProgress?.(video.duration || video.currentTime || 0, video.duration || 0); onEnded?.(); }; const updatePlaying = () => setPlaying(!video.paused); const updateVolume = () => { setMuted(video.muted); setVolume(video.volume); };
    video.addEventListener('timeupdate', updateTime); video.addEventListener('pause', saveOnPause); video.addEventListener('ended', updateEnded); video.addEventListener('loadedmetadata', updateDuration); video.addEventListener('durationchange', updateDuration); video.addEventListener('play', updatePlaying); video.addEventListener('pause', updatePlaying); video.addEventListener('volumechange', updateVolume);
    return () => { saveOnPause(); video.removeEventListener('timeupdate', updateTime); video.removeEventListener('pause', saveOnPause); video.removeEventListener('ended', updateEnded); video.removeEventListener('loadedmetadata', updateDuration); video.removeEventListener('durationchange', updateDuration); video.removeEventListener('play', updatePlaying); video.removeEventListener('pause', updatePlaying); video.removeEventListener('volumechange', updateVolume); };
  }, [onProgress, onEnded, startTime, defaultSpeed]);
  useEffect(() => { const video=videoRef.current; if (video) { video.playbackRate=defaultSpeed; setSpeed(defaultSpeed); } }, [defaultSpeed]);
  useEffect(() => { const update = () => setFullscreen(document.fullscreenElement === stageRef.current); document.addEventListener('fullscreenchange', update); return () => document.removeEventListener('fullscreenchange', update); }, []);
  useEffect(() => {
    const video = videoRef.current; if (!video || !source?.url) return;
    if (source.type?.toLowerCase() === 'embed') { setLoading(false); onError(''); return; }
    let hls: Hls | null = null; let cancelled = false; const isHls = source.type?.toLowerCase().includes('hls') || source.url.toLowerCase().includes('.m3u8');
    setLoading(true); setCurrentTime(0); setDuration(0); setCaptionTrack(-1); resumedRef.current = false; onError('');
    const canPlay = () => { if (!cancelled) setLoading(false); }; const videoError = () => { if (!cancelled) { setLoading(false); onError('The browser could not play this source. Try another server or episode.'); } };
    video.addEventListener('canplay', canPlay); video.addEventListener('error', videoError);
    if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) { video.src = source.url; video.load(); }
    else if (isHls) { void import('hls.js').then(({ default: HlsModule }) => { if (cancelled) return; if (!HlsModule.isSupported()) { setLoading(false); onError('This browser does not support HLS playback. Try a modern browser or a compatible stream source.'); return; } hls = new HlsModule({ enableWorker: true, maxBufferLength: 30 }); hls.loadSource(source.url); hls.attachMedia(video); hls.on(HlsModule.Events.MANIFEST_PARSED, () => { if (!cancelled) setLoading(false); }); hls.on(HlsModule.Events.ERROR, (_event, data) => { if (data.fatal && !cancelled) { setLoading(false); onError(data.type === HlsModule.ErrorTypes.NETWORK_ERROR ? 'Stream network error. The source may be offline or block this browser.' : 'This HLS stream could not be decoded. Try another source.'); } }); }).catch(() => { if (!cancelled) { setLoading(false); onError('HLS playback support could not be loaded.'); } }); }
    else if (!isHls) { video.src = source.url; video.load(); }
    return () => { cancelled = true; video.removeEventListener('canplay', canPlay); video.removeEventListener('error', videoError); hls?.destroy(); video.pause(); video.removeAttribute('src'); video.load(); };
  }, [source?.url, source?.type, onError]);
  async function togglePlayback() { const video = videoRef.current; if (!video) return; if (video.paused) { try { await video.play(); } catch { onError('Playback could not start. Try the play button again or choose another source.'); } } else video.pause(); }
  function seekBy(amount: number) { const video = videoRef.current; if (video) video.currentTime = Math.min(video.duration || 0, Math.max(0, video.currentTime + amount)); }
  function setCaptions(index: number) { const tracks = videoRef.current?.textTracks; if (tracks) Array.from(tracks).forEach((track, i) => { track.mode = i === index ? 'showing' : 'disabled'; }); setCaptionTrack(index); }
  async function toggleFullscreen() { const stage = stageRef.current; if (!stage) return; try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); } catch { onError('Fullscreen is unavailable in this browser.'); } }
  return <div className='video-stage' ref={stageRef}>
    {source?.type?.toLowerCase() === 'embed' ? <><iframe className='embed-player' src={source.url} title='Anime episode stream' allow='autoplay; encrypted-media; picture-in-picture; fullscreen' allowFullScreen referrerPolicy='origin' onLoad={() => { onError(''); onProgress?.(startTime, 0); }} />{insecureEmbed && <div className='secure-playback-notice' role='note'><strong>Secure connection needed</strong><span>This phone opened AniTAG over HTTP. Some encrypted video players cannot decrypt streams inside an insecure page. Open AniTAG through HTTPS, then reload this episode.</span></div>}</> : <>
      <video ref={videoRef} playsInline preload='metadata' crossOrigin='anonymous' aria-label='Anime episode player' onClick={() => void togglePlayback()}>{source?.subtitles?.map((sub, i) => <track key={sub.url + i} kind='subtitles' src={sub.url} srcLang={sub.srclang || sub.language || 'en'} label={sub.label || sub.language || ('Subtitle ' + (i + 1))} default={Boolean(sub.default || (subtitleLanguage !== 'off' && ((sub.srclang || sub.language || '').toLowerCase().startsWith(subtitleLanguage))))} />)}</video>
      {loading && <div className='player-overlay'><span className='spinner'/> Loading stream…</div>}
      <div className='glass-controls' aria-label='Video controls'>
        <input className='glass-progress' aria-label='Seek video' type='range' min='0' max={duration || 100} step='0.1' value={Math.min(currentTime, duration || 100)} style={{ '--played': (duration ? currentTime / duration * 100 : 0) + '%' } as CSSProperties & { '--played': string }} onChange={e => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value); }} />
        <div className='glass-control-row'><div className='glass-control-group'>
          <button className='glass-icon skip-control' onClick={() => seekBy(-10)} aria-label='Back 10 seconds' title='Back 10 seconds'><RotateCcw size={16}/><span>10</span></button>
          <button className='glass-icon glass-play' onClick={() => void togglePlayback()} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={17} fill='currentColor'/> : <Play size={17} fill='currentColor'/>}</button>
          <button className='glass-icon skip-control' onClick={() => seekBy(10)} aria-label='Forward 10 seconds' title='Forward 10 seconds'><RotateCw size={16}/><span>10</span></button>
          <button className='glass-icon volume-toggle' onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>{muted || volume === 0 ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>
          <input className='glass-volume' aria-label='Volume' type='range' min='0' max='1' step='0.05' value={muted ? 0 : volume} onChange={e => { if (videoRef.current) { videoRef.current.volume = Number(e.target.value); videoRef.current.muted = false; } }} />
          <span className='glass-time'>{clock(currentTime)} <span>/</span> {clock(duration)}</span>
        </div><div className='glass-control-group glass-right-controls'>
          <label className='glass-select' title='Playback speed'><span className='sr-only'>Playback speed</span><select aria-label='Playback speed' value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); if (videoRef.current) videoRef.current.playbackRate = value; }}><option value='0.75'>0.75×</option><option value='1'>1×</option><option value='1.25'>1.25×</option><option value='1.5'>1.5×</option><option value='2'>2×</option></select></label>
          {Boolean(source?.subtitles?.length) && <label className='glass-select caption-select' title='Subtitles'><Subtitles size={16}/><span className='sr-only'>Subtitles</span><select aria-label='Subtitles' value={captionTrack} onChange={e => setCaptions(Number(e.target.value))}><option value={-1}>CC off</option>{source?.subtitles?.map((sub, i) => <option key={sub.url + i} value={i}>{sub.label || sub.language || sub.srclang || ('Subtitle ' + (i + 1))}</option>)}</select></label>}
          <button className='glass-icon' onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}><Maximize size={18}/></button>
        </div></div>
      </div>
    </>}
  </div>;
}
