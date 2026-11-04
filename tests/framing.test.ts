import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { alignFrames, audioDuration } from '../src/services/recognition/shazam/framing';

const load = (f: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));

describe('alignFrames', () => {
  it('recale un extrait AAC+ (Rinse FM) capturé en milieu de trame', () => {
    const raw = load('rinse-extrait.aac');
    expect(raw[0]).not.toBe(0xff);
    const out = alignFrames(raw);
    expect(out[0]).toBe(0xff);
    expect(out[1] & 0xf6).toBe(0xf0);
    expect(out.length).toBeGreaterThan(raw.length * 0.9);
    expect(out.length).toBeLessThan(raw.length);
  });
  it('recale un extrait MP3 coupé n’importe où', () => {
    const out = alignFrames(load('mp3-extrait.mp3'));
    expect(out[0]).toBe(0xff);
    expect(out[1] & 0xe0).toBe(0xe0);
    expect(out.length).toBeGreaterThan(50_000);
  });
  it('laisse intact un format inconnu', () => {
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(alignFrames(b)).toBe(b);
  });
  it('mesure la durée reçue (MP3 et AAC+)', () => {
    // 60 000 octets de MP3 à 128 kb/s ≈ 3,7 s
    expect(audioDuration(load('mp3-extrait.mp3'))).toBeGreaterThan(3.2);
    expect(audioDuration(load('mp3-extrait.mp3'))).toBeLessThan(4.2);
    expect(audioDuration(load('rinse-extrait.aac'))).toBeGreaterThan(1);
    expect(audioDuration(new Uint8Array(100))).toBe(0);
  });
});
