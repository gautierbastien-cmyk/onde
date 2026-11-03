import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractTsAudio, isMpegTs } from '../src/services/recognition/shazam/mpegts';
import { alignFrames } from '../src/services/recognition/shazam/framing';

describe('MPEG-TS', () => {
  const ts = new Uint8Array(readFileSync(new URL('./fixtures/video-audio.ts', import.meta.url)));
  it('extrait la piste AAC d’un segment vidéo + audio', () => {
    expect(isMpegTs(ts)).toBe(true);
    const audio = extractTsAudio(ts)!;
    expect(audio[0]).toBe(0xff);
    expect(audio[1] & 0xf6).toBe(0xf0);
    // ~6 s à 64 kb/s ≈ 48 Ko : la vidéo n'est pas incluse
    expect(audio.length).toBeGreaterThan(35_000);
    expect(audio.length).toBeLessThan(70_000);
    expect(alignFrames(audio).length).toBeGreaterThan(audio.length * 0.95);
  });
  it('ignore ce qui n’est pas du TS', () => {
    expect(isMpegTs(new Uint8Array(400))).toBe(false);
  });
});
