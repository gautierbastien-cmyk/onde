/**
 * Métadonnées ID3 « timed metadata » des flux HLS.
 *
 * Safari les expose nativement via une piste textTracks de type « metadata »
 * (DataCue : value.key = TIT2 / TPE1 / TALB / APIC…). Aucun CORS requis :
 * c'est le lecteur lui-même qui les lit.
 */
import { isMeaningful, splitStreamTitle } from '../streamTitle';
import type { MetadataProvider } from '../types';

interface Id3Frame {
  key?: string;
  data?: unknown;
  info?: string;
}

export const hlsId3Provider: MetadataProvider = {
  id: 'hls-id3',
  label: 'Métadonnées ID3 du flux HLS',
  accepts: (s) => s.isHls,
  async start({ station, audio, signal, emit }) {
    const tracks = audio.textTracks;
    if (!tracks) return 'unsupported';
    let last = '';

    const onCue = (ev: Event) => {
      const track = ev.target as TextTrack;
      const cues = track.activeCues;
      if (!cues?.length) return;
      const frames: Record<string, string> = {};
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i] as TextTrackCue & { value?: Id3Frame; text?: string };
        const v = cue.value;
        if (v?.key && typeof v.data === 'string') frames[v.key.toUpperCase()] = v.data;
        else if (v?.key === 'TXXX' && v.info) frames['TXXX:' + v.info] = String(v.data ?? '');
        else if (cue.text) frames['TEXT'] = cue.text;
      }
      let title: string | undefined = frames.TIT2;
      let artist: string | undefined = frames.TPE1;
      const album = frames.TALB;
      const raw = [artist, title].filter(Boolean).join(' - ') || frames.TEXT || '';
      if (!title && frames.TEXT) ({ title, artist } = splitStreamTitle(frames.TEXT.replace(/^.*StreamTitle='|';.*$/g, '')));
      if (title && !artist && / - /.test(title)) ({ title, artist } = splitStreamTitle(title));
      if (!isMeaningful(title, station.name)) return;
      const key = `${artist}|${title}`;
      if (key === last) return;
      last = key;
      emit({ title: title!, artist: isMeaningful(artist) ? artist : undefined, album: isMeaningful(album) ? album : undefined, raw, source: 'hls-id3' });
    };

    const watch = (t: TextTrack) => {
      if (t.kind !== 'metadata') return;
      t.mode = 'hidden';
      t.addEventListener('cuechange', onCue);
      signal.addEventListener('abort', () => t.removeEventListener('cuechange', onCue), { once: true });
    };
    for (let i = 0; i < tracks.length; i++) watch(tracks[i]);
    const onAdd = (e: TrackEvent) => e.track && watch(e.track as TextTrack);
    tracks.addEventListener('addtrack', onAdd as EventListener);
    signal.addEventListener('abort', () => tracks.removeEventListener('addtrack', onAdd as EventListener), { once: true });
    return 'active';
  },
};
