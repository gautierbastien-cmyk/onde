import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicRecognitionService, type RecognitionEngine } from '../src/services/recognition/MusicRecognitionService';
import type { Track } from '../src/core/types';

const station = { id: 's1', name: 'Nostalgie', url: 'https://x/stream', genres: [], playlistIds: [], attrs: {}, verification: 'probable', isHls: false, addedAt: 0 } as any;

describe('MusicRecognitionService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calcule la fin du morceau à partir de la position Shazam et de la durée', async () => {
    // iTunes renvoie la durée (291 s) pour le morceau reconnu
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [{ artistName: 'George Thorogood & The Destroyers', trackName: 'Bad To The Bone', artworkUrl100: 'https://a/100x100bb.jpg', trackTimeMillis: 291_747 }] }))));
    const history: Track[] = [];
    const svc = new MusicRecognitionService({ add: async (t) => void history.unshift(t), last: () => history[0] }, { artworkLookup: () => true, relayUrl: () => '' });
    const capturedAt = Date.now() - 1000;
    const engine: RecognitionEngine = {
      id: 'shazam', label: 'Shazam', mode: 'on-demand', isAvailable: () => true,
      identify: async () => ({ title: 'Bad To The Bone', artist: 'George Thorogood & The Destroyers', artworkUrl: 'https://shazam/cover.jpg', album: 'The Original', source: 'recognition:shazam', confidence: 1, offsetMs: 83_681, capturedAt }),
    };
    svc.registerEngine(engine);
    svc.attach({ station, streamUrl: station.url, audio: {} as any });
    const track = await svc.identify('shazam');
    expect(track?.startedAt).toBe(capturedAt - 83_681);
    expect(track?.endsAt).toBe(capturedAt - 83_681 + 291_747);
    expect(track?.artworkUrl).toBe('https://shazam/cover.jpg'); // la pochette Shazam est gardée sans Spotify
    expect(history).toHaveLength(1);
  });

  it('fusionne le titre annoncé par la station et le même morceau reconnu par Shazam', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [{ artistName: 'George Thorogood & The Destroyers', trackName: 'Bad To The Bone', artworkUrl100: 'https://a/100x100bb.jpg', trackTimeMillis: 291_747 }] }))));
    const history: Track[] = [];
    const svc = new MusicRecognitionService({ add: async (t) => void history.unshift(t), last: () => history[0] }, { artworkLookup: () => true, relayUrl: () => '' });
    let next: any = { title: 'Bad to the Bone', artist: 'George Thorogood', source: 'icy', confidence: 1 };
    svc.registerEngine({ id: 'e', label: 'e', mode: 'on-demand', isAvailable: () => true, identify: async () => next });
    svc.attach({ station, streamUrl: station.url, audio: {} as any });
    await svc.identify('e'); // annonce de la station
    next = { title: 'Bad To The Bone', artist: 'George Thorogood & The Destroyers', source: 'recognition:shazam', confidence: 1, offsetMs: 60_000, capturedAt: 1_000_000 };
    const merged = await svc.identify('e'); // Shazam sur le même morceau
    expect(history).toHaveLength(1);
    expect(merged?.title).toBe('Bad to the Bone'); // le titre de la station est conservé
    expect(merged?.endsAt).toBe(1_000_000 - 60_000 + 291_747);
    expect(merged?.confirmedAt).toBeDefined();
  });
});

import { mergeRemote } from '../src/services/history/HistorySync';
describe('historique partagé', () => {
  const local = [{ id: 'a', title: 'Rogue Wave', artist: 'Maxye', stationId: 's', stationName: 'NTS 1', source: 'recognition:shazam', identifiedAt: 1_000_000, timeZone: 'Europe/Paris' }] as any;
  const toLocal = (r: any) => ({ ...r, stationId: 's', source: 'recognition:shazam', timeZone: 'Europe/Paris' });
  it('ajoute un titre venu d’un autre appareil, ignore le même morceau déjà présent, applique les suppressions', () => {
    const { add, remove } = mergeRemote(local, [
      { id: 'b', title: 'ROGUE WAVE', artist: 'Maxye', stationName: 'NTS 1', identifiedAt: 1_030_000 },
      { id: 'c', title: 'Help!', artist: 'The Beatles', stationName: 'Nostalgie', identifiedAt: 2_000_000 },
      { id: 'a', title: 'Rogue Wave', identifiedAt: 1_000_000, deleted: true },
    ], toLocal);
    expect(add.map((t) => t.id)).toEqual(['c']);
    expect(remove).toEqual(['a']);
  });
});
