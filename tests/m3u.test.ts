import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePlaylist, parseAttributes, parseM3U } from '../src/services/m3u/parser';
import { classify } from '../src/services/m3u/classifier';
import { detectCountry, detectGenres, displayName, normalizeUrl, stationId, validateUrl } from '../src/services/m3u/normalize';
import { importPlaylist } from '../src/services/m3u/importer';
import { analyzeHls } from '../src/services/m3u/probe';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

describe('parseAttributes', () => {
  it('gère guillemets droits, simples et typographiques', () => {
    const { attrs, rest } = parseAttributes(` tvg-logo=“https://x/logo.png” group-title='Jazz' tvg-id=abc,Jazz Radio`);
    expect(attrs).toEqual({ 'tvg-logo': 'https://x/logo.png', 'group-title': 'Jazz', 'tvg-id': 'abc' });
    expect(rest).toBe('Jazz Radio');
  });
  it('conserve les virgules du titre', () => {
    expect(parseAttributes(` group-title="Classique", Radio Classique, l'élégance`).rest.trim()).toBe("Radio Classique, l'élégance");
  });
  it('accepte une virgule dans une valeur entre guillemets', () => {
    expect(parseAttributes(` group-title="Jazz, Blues",Nom`)).toEqual({ attrs: { 'group-title': 'Jazz, Blues' }, rest: 'Nom' });
  });
});

describe('parseM3U', () => {
  const r = parseM3U(fixture('radios.m3u'));
  it('lit en-tête, entrées et orphelins', () => {
    expect(r.header['url-tvg']).toBe('https://example.com/epg.xml');
    expect(r.entries).toHaveLength(9);
    expect(r.orphans).toEqual([{ line: 14, name: 'Sans URL' }]);
    expect(r.entries[0]).toMatchObject({ name: 'Jazz Radio', attrs: { 'group-title': 'Jazz' } });
  });
  it('applique #EXTGRP', () => {
    expect(r.entries.find((e) => e.url.includes('somafm'))?.group).toBe('Lounge');
  });
  it('reconnaît un flux HLS déguisé en playlist', () => {
    expect(parseM3U('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.aac\n').isHlsMediaPlaylist).toBe(true);
  });
  it('lit une liste nue et les fins de ligne Windows', () => {
    const p = parseM3U('https://a.example/stream\r\nhttps://b.example/live.mp3\r\n');
    expect(p.entries.map((e) => e.url)).toEqual(['https://a.example/stream', 'https://b.example/live.mp3']);
  });
  it('décode UTF-8 avec BOM et Windows-1252', () => {
    const latin = new Uint8Array([0x23, 0x45, 0x58, 0x54, 0x49, 0x4e, 0x46, 0x3a, 0x2d, 0x31, 0x2c, 0x45, 0x74, 0xe9]); // "#EXTINF:-1,Eté"
    expect(decodePlaylist(latin)).toBe('#EXTINF:-1,Eté');
    const utf8 = new TextEncoder().encode('﻿#EXTM3U\n#EXTINF:-1,日本\nhttps://x.jp/s');
    expect(parseM3U(decodePlaylist(utf8)).entries[0].name).toBe('日本');
  });
});

describe('normalisation', () => {
  it('valide les URL', () => {
    expect(validateUrl('rtmp://x/y').ok).toBe(false);
    expect(validateUrl('https://x/a.pls').ok).toBe(false);
    expect(validateUrl('pas une url').ok).toBe(false);
    expect(validateUrl('http://x:8000/;').ok).toBe(true);
  });
  it('détecte les doublons malgré la casse et le port par défaut', () => {
    expect(normalizeUrl('https://EXAMPLE.com:443/live/')).toBe(normalizeUrl('https://example.com/live'));
    expect(stationId('https://EXAMPLE.com:443/live/')).toBe(stationId('https://example.com/live'));
  });
  it('détecte le pays', () => {
    const [jazz, fip, paradise, , , , , chill] = parseM3U(fixture('radios.m3u')).entries;
    expect(detectCountry(fip)).toBe('FR');
    expect(detectCountry(paradise)).toBe('US');
    expect(detectCountry(chill)).toBe('BE');
    expect(detectCountry(jazz)).toBeUndefined();
    expect(detectCountry({ ...jazz, attrs: { 'group-title': 'Radios Belgique' } })).toBe('BE');
    // « .fr » commun à toute la playlist (générateur) : ignoré ; le format iptv-org (@) reste fiable
    expect(detectCountry({ ...jazz, attrs: { 'tvg-id': 'thelotradio.fr' } }, 'fr')).toBeUndefined();
    expect(detectCountry({ ...jazz, attrs: { 'tvg-id': 'TVAlsace.fr@HD' } }, 'fr')).toBe('FR');
    expect(detectCountry({ ...jazz, attrs: { 'tvg-id': 'thelotradio.fr', 'tvg-country': 'US' } }, 'fr')).toBe('US');
  });
  it('extrait les genres sans garder les pays ni « Radios »', () => {
    const fip = parseM3U(fixture('radios.m3u')).entries[1];
    expect(detectGenres(fip, 'FR')).toEqual(['Éclectique']);
  });
  it('nettoie le nom', () => {
    const chill = parseM3U(fixture('radios.m3u')).entries[7];
    expect(displayName(chill, chill.url)).toBe('Chillout Ñandú Ràdio 日本');
  });
});

describe('classement audio / vidéo', () => {
  it('reconnaît les radios de la playlist d’exemple', () => {
    const entries = parseM3U(fixture('radios.m3u')).entries;
    expect(classify(entries[0]).kind).toBe('audio');
    expect(classify(entries[1]).kind).toBe('audio');
    expect(classify(entries[2]).kind).toBe('audio');
    expect(classify(entries[5]).kind).toBe('video'); // France 2 (1080p)
  });
  it('rejette la quasi-totalité d’une vraie playlist TV (iptv-org)', () => {
    const entries = parseM3U(fixture('tv-iptv-org.m3u')).entries;
    const audio = entries.filter((e) => classify(e).kind === 'audio');
    expect(entries.length).toBeGreaterThan(150);
    expect(audio.length).toBe(0);
  });
});

describe('analyzeHls', () => {
  it('master audio seul (Radio France)', () => {
    const t = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=107000,CODECS="mp4a.40.2"\nlo.m3u8\n';
    expect(analyzeHls(t).kind).toBe('audio');
  });
  it('master vidéo', () => {
    const t = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"\nhd.m3u8\n';
    expect(analyzeHls(t).kind).toBe('video');
  });
  it('sans codecs : suit la première variante', () => {
    expect(analyzeHls('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv1.m3u8\n')).toMatchObject({ kind: 'unknown', nextVariant: 'v1.m3u8' });
  });
  it('segments AAC', () => {
    expect(analyzeHls('#EXTM3U\n#EXTINF:6,\n1.aac\n#EXTINF:6,\n2.aac\n').kind).toBe('audio');
  });
});

describe('importPlaylist', () => {
  it('produit stations et rapport', async () => {
    const res = await importPlaylist({
      name: 'Test',
      source: { type: 'file', ref: 'radios.m3u' },
      raw: fixture('radios.m3u'),
      existing: new Map(),
      probe: async (url) => (url.includes('france2') ? { kind: 'video', via: 'hls' } : { kind: 'audio', via: 'headers' }),
    });
    expect(res.report.totalEntries).toBe(10);
    expect(res.report.duplicates).toBe(1);
    expect(res.report.invalid.map((i) => i.reason)).toEqual([
      'EXTINF sans URL',
      'Protocole rtmp non pris en charge par Safari',
      'Liste de lecture imbriquée (.pls/.asx) : utiliser l’URL directe du flux',
    ]);
    expect(res.report.excluded).toHaveLength(1);
    expect(res.stations.map((s) => s.name)).toEqual([
      'Jazz Radio',
      'FIP',
      'Radio Paradise – Main Mix',
      "Radio Classique, l'élégance",
      'Chillout Ñandú Ràdio 日本',
    ]);
    expect(res.report.kept).toBe(5);
  });
  it('fusionne une station présente dans deux playlists', async () => {
    const raw = '#EXTM3U\n#EXTINF:-1 group-title="Jazz",Jazz Radio\nhttps://jazzradio.ice.infomaniak.ch/jazzradio-high.mp3\n';
    const a = await importPlaylist({ name: 'A', source: { type: 'file', ref: 'a' }, raw, existing: new Map() });
    const existing = new Map(a.stations.map((s) => [s.id, s]));
    const b = await importPlaylist({ name: 'B', source: { type: 'file', ref: 'b' }, raw, existing });
    expect(b.report.updated).toBe(1);
    expect(b.stations[0].playlistIds).toEqual([a.playlist.id, b.playlist.id]);
  });
});

describe('playlist à dominante radio', () => {
  it('garde les entrées incertaines mais écarte la vidéo confirmée', async () => {
    const radios = Array.from({ length: 9 }, (_, i) => `#EXTINF:-1 group-title="Radio",Radio ${i}\nhttps://ice${i}.infomaniak.ch/r${i}.mp3`).join('\n');
    const raw = `#EXTM3U\n${radios}\n#EXTINF:-1 group-title="Divers",Bide et Musique\nhttps://relay.example.net/bm\n#EXTINF:-1,Mezzo live\nhttps://cdn.example.net/mezzo/index.m3u8\n`;
    const res = await importPlaylist({
      name: 'R',
      source: { type: 'file', ref: 'r' },
      raw,
      existing: new Map(),
      probe: async (url) => (url.includes('mezzo') ? { kind: 'video', via: 'hls' } : { kind: 'unknown', via: 'media' }),
    });
    expect(res.stations.map((s) => s.name)).toContain('Bide et Musique');
    expect(res.stations.map((s) => s.name)).not.toContain('Mezzo live');
  });
});

describe('radio déclarée', () => {
  it('garde une radio filmée déclarée radio="true", même avec une piste vidéo', async () => {
    const raw = '#EXTM3U\n#EXTINF:-1 radio="true" tvg-country="US" group-title="Radios indé",The Lot Radio\nhttps://livepeercdn.studio/hls/x/index.m3u8\n';
    const res = await importPlaylist({ name: 'R', source: { type: 'file', ref: 'r' }, raw, existing: new Map(), probe: async () => ({ kind: 'video', via: 'hls' }) });
    expect(res.stations.map((s) => [s.name, s.country])).toEqual([['The Lot Radio', 'US']]);
  });
});

