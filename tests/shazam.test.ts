import { describe, expect, it } from 'vitest';
import { computeSignature, crc32, encodeSignature, SAMPLE_RATE, signatureUri } from '../src/services/recognition/shazam/signature';
import { parseShazamResponse } from '../src/services/recognition/engines/shazamEngine';

/** 8 s de notes successives, avec un peu de bruit, en PCM 16 kHz. */
function synth(): Int16Array {
  const n = SAMPLE_RATE * 8;
  const pcm = new Int16Array(n);
  const notes = [440, 660, 880, 1320, 2200, 3300, 523, 784];
  let seed = 1;
  for (let i = 0; i < n; i++) {
    const f = notes[Math.floor(i / (SAMPLE_RATE / 2)) % notes.length];
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pcm[i] = Math.round(9000 * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE) + ((seed / 0x7fffffff) - 0.5) * 300);
  }
  return pcm;
}

describe('empreinte Shazam', () => {
  const sig = computeSignature(synth());

  it('détecte des pics dans les bandes attendues', () => {
    const total = [...sig.bands.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBeGreaterThan(20);
    for (const [band, peaks] of sig.bands) {
      expect(band).toBeGreaterThanOrEqual(0);
      expect(band).toBeLessThanOrEqual(3);
      for (let i = 1; i < peaks.length; i++) expect(peaks[i].fftPassNumber).toBeGreaterThanOrEqual(peaks[i - 1].fftPassNumber);
    }
  });

  it('sérialise un en-tête valide avec CRC32', () => {
    const bin = encodeSignature(sig);
    const dv = new DataView(bin.buffer);
    expect(dv.getUint32(0, true)).toBe(0xcafe2580);
    expect(dv.getUint32(12, true)).toBe(0x94119c00);
    expect(dv.getUint32(28, true)).toBe(3 << 27);
    expect(dv.getUint32(8, true)).toBe(bin.length - 48);
    expect(dv.getUint32(4, true)).toBe(crc32(bin.subarray(8)));
    expect(bin.length % 4).toBe(0);
    expect(signatureUri(sig)).toMatch(/^data:audio\/vnd\.shazam\.sig;base64,[A-Za-z0-9+/=]+$/);
  });

  it('CRC32 de référence', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('réponse Shazam', () => {
  it('extrait titre, artiste, album et pochette', () => {
    const r = parseShazamResponse({
      matches: [{}],
      track: { title: 'Spirit Walks', subtitle: 'Nerina Pallot', images: { coverarthq: 'https://x/hq.jpg' }, sections: [{ type: 'SONG', metadata: [{ title: 'Album', text: 'The Sound and The Fury' }] }] },
    });
    expect(r).toMatchObject({ title: 'Spirit Walks', artist: 'Nerina Pallot', album: 'The Sound and The Fury', artworkUrl: 'https://x/hq.jpg', source: 'recognition:shazam' });
  });
  it('rejette une correspondance aux décalages anormaux', () => {
    expect(parseShazamResponse({ matches: [{ offset: 10, timeskew: 0.2, frequencyskew: 0 }], track: { title: 'X', subtitle: 'Y' } })).toBeNull();
  });
  it('aucun résultat : rien n’est inventé', () => {
    expect(parseShazamResponse({ matches: [] })).toBeNull();
  });
});
