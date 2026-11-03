import { describe, expect, it, vi, afterEach } from 'vitest';
import { isMeaningful, parseIcyBlock, splitStreamTitle } from '../src/services/metadata/streamTitle';
import { icyInBandProvider } from '../src/services/metadata/providers/icyInBand';
import type { StreamMetadata } from '../src/services/metadata/types';

describe('ICY', () => {
  it('lit StreamTitle avec apostrophes et StreamUrl', () => {
    expect(parseIcyBlock("StreamTitle='Guns N' Roses - Don't Cry';StreamUrl='https://x/a.jpg';\0\0\0")).toEqual({
      streamTitle: "Guns N' Roses - Don't Cry",
      streamUrl: 'https://x/a.jpg',
    });
  });
  it('sépare artiste et titre sans rien inventer', () => {
    expect(splitStreamTitle('Miles Davis - So What')).toEqual({ artist: 'Miles Davis', title: 'So What' });
    expect(splitStreamTitle('Jingle station')).toEqual({ title: 'Jingle station' });
    expect(splitStreamTitle('A-ha - Take On Me')).toEqual({ artist: 'A-ha', title: 'Take On Me' });
  });
  it('rejette les valeurs vides ou génériques', () => {
    expect(isMeaningful('')).toBe(false);
    expect(isMeaningful('Unknown')).toBe(false);
    expect(isMeaningful('Jazz Radio', 'Jazz Radio')).toBe(false);
    expect(isMeaningful('https://pub.example')).toBe(false);
    expect(isMeaningful('So What')).toBe(true);
  });
});

/** Fabrique un flux ICY : metaint octets audio, puis un bloc de métadonnées, etc. */
function icyStream(metaint: number, titles: string[]): Uint8Array {
  const parts: number[] = [];
  for (const t of titles) {
    for (let i = 0; i < metaint; i++) parts.push(0xff);
    const text = t ? new TextEncoder().encode(`StreamTitle='${t}';`) : new Uint8Array(0);
    const len = Math.ceil(text.length / 16);
    parts.push(len);
    const block = new Uint8Array(len * 16);
    block.set(text);
    parts.push(...block);
  }
  return new Uint8Array(parts);
}

function mockFetch(bytes: Uint8Array, headers: Record<string, string>) {
  return vi.fn(async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent) return c.close();
        // Découpage arbitraire pour éprouver le réassemblage
        for (let i = 0; i < bytes.length; i += 700) c.enqueue(bytes.slice(i, i + 700));
        sent = true;
      },
    });
    return new Response(body, { status: 200, headers });
  });
}

describe('icyInBandProvider', () => {
  afterEach(() => vi.unstubAllGlobals());
  const station = { id: 's', name: 'Test FM', url: 'https://radio.example/stream', genres: [], playlistIds: [], attrs: {}, verification: 'probable', isHls: false, addedAt: 0 } as any;

  for (const exposed of [true, false]) {
    it(`émet le titre (icy-metaint ${exposed ? 'exposé' : 'déduit'})`, async () => {
      vi.stubGlobal('location', { protocol: 'https:' });
      vi.stubGlobal('fetch', mockFetch(icyStream(1000, ['Daft Punk - One More Time']), exposed ? { 'icy-metaint': '1000' } : {}));
      const got: StreamMetadata[] = [];
      const ctrl = new AbortController();
      const outcome = await icyInBandProvider.start({ station, url: station.url, audio: {} as any, relayUrl: '', signal: ctrl.signal, emit: (m) => got.push(m) });
      ctrl.abort();
      expect(outcome).toBe('active');
      expect(got[0]).toMatchObject({ artist: 'Daft Punk', title: 'One More Time', source: 'icy' });
    });
  }

  it('passe en continu quand le premier bloc est vide (Shoutcast)', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    vi.stubGlobal('fetch', mockFetch(icyStream(800, ['', 'The Beatles - Help!']), { 'icy-metaint': '800' }));
    const got: StreamMetadata[] = [];
    const ctrl = new AbortController();
    const outcome = await icyInBandProvider.start({ station, url: station.url, audio: {} as any, relayUrl: '', signal: ctrl.signal, emit: (m) => got.push(m) });
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    expect(outcome).toBe('active');
    expect(got.map((g) => g.title)).toEqual(['Help!']);
  });

  it('renonce si le CORS est refusé', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));
    const outcome = await icyInBandProvider.start({ station, url: station.url, audio: {} as any, relayUrl: '', signal: new AbortController().signal, emit: () => {} });
    expect(outcome).toBe('unsupported');
  });
});

import { radioFranceId } from '../src/services/metadata/providers/radioFrance';
describe('radioFranceId', () => {
  it('reconnaît les flux Radio France', () => {
    expect(radioFranceId('https://icecast.radiofrance.fr/fipjazz-hifi.aac')).toBe(65);
    expect(radioFranceId('https://stream.radiofrance.fr/fip/fip.m3u8?id=radiofrance')).toBe(7);
    expect(radioFranceId('https://icecast.radiofrance.fr/franceinter-midfi.mp3')).toBe(1);
    expect(radioFranceId('https://stream.radioparadise.com/aac-320')).toBeUndefined();
  });
});
