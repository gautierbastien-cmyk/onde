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
});
