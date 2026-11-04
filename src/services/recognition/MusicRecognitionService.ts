/**
 * MusicRecognitionService — point d'entrée unique de l'identification musicale.
 *
 * Toute méthode d'identification est un « moteur » (RecognitionEngine) qui
 * publie des RecognitionResult. Le service :
 *   1. dédoublonne (un même morceau annoncé plusieurs fois = une entrée),
 *   2. complète pochette/album via l'API iTunes si l'option est active,
 *   3. enregistre dans l'historique (même format pour tous les moteurs),
 *   4. informe l'interface du morceau en cours.
 *
 * Le lecteur radio ne connaît pas ce service. Ajouter un moteur de
 * reconnaissance audio (empreinte acoustique, ShazamKit via une app native
 * compagnon…) revient à appeler `registerEngine` : rien d'autre ne change.
 */
import type { Station, Track, TrackSource } from '../../core/types';
import { findArtwork, sameSong } from '../artwork/ArtworkService';
import { hash } from '../m3u/normalize';

export interface RecognitionResult {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  source: TrackSource;
  raw?: string;
  /** Confiance 0–1 pour les moteurs acoustiques ; 1 pour les métadonnées du flux. */
  confidence: number;
  /** Moteurs acoustiques : position de l'extrait dans le morceau, et heure de sa capture. */
  offsetMs?: number;
  capturedAt?: number;
  /** Durée exacte du morceau, quand le moteur la connaît. */
  durationMs?: number;
}

export interface RecognitionContext {
  station: Station;
  /** URL réellement lue, utile à un moteur qui analyserait le flux. */
  streamUrl: string;
  audio: HTMLAudioElement;
  publish: (r: RecognitionResult) => void;
  signal: AbortSignal;
}

export interface RecognitionEngine {
  id: string;
  label: string;
  /** 'passive' : écoute en continu (métadonnées). 'on-demand' : lancé par l'utilisateur. */
  mode: 'passive' | 'on-demand';
  isAvailable(): boolean;
  /** Moteurs passifs : démarrage à chaque station. */
  attach?(ctx: RecognitionContext): void;
  /** Moteurs à la demande : une tentative d'identification. */
  identify?(ctx: RecognitionContext): Promise<RecognitionResult | null>;
}

export interface HistoryStore {
  add(track: Track): Promise<void>;
  last(): Track | undefined;
}

type CurrentListener = (t: Track | null) => void;

const REPEAT_WINDOW = 20 * 60_000;
const MIN_CONFIDENCE = 0.6;

export class MusicRecognitionService {
  private engines = new Map<string, RecognitionEngine>();
  private ctrl: AbortController | null = null;
  private current: Track | null = null;
  private listeners = new Set<CurrentListener>();
  private context: Omit<RecognitionContext, 'publish' | 'signal'> | null = null;

  constructor(
    private history: HistoryStore,
    private options: { artworkLookup: () => boolean; relayUrl: () => string },
  ) {}

  registerEngine(engine: RecognitionEngine) {
    this.engines.set(engine.id, engine);
  }

  listEngines(): RecognitionEngine[] {
    return [...this.engines.values()].filter((e) => e.isAvailable());
  }

  /** Moteurs « à la demande » disponibles : l'interface n'affiche un bouton que s'il y en a un. */
  get onDemandEngines(): RecognitionEngine[] {
    return this.listEngines().filter((e) => e.mode === 'on-demand');
  }

  onCurrent(fn: CurrentListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getCurrent() {
    return this.current;
  }

  private setCurrent(t: Track | null) {
    this.current = t;
    for (const l of this.listeners) l(t);
  }

  /** Appelé à chaque nouvelle station lue. */
  attach(ctx: Omit<RecognitionContext, 'publish' | 'signal'>) {
    this.detach();
    this.context = ctx;
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    for (const e of this.engines.values()) {
      if (e.mode === 'passive' && e.isAvailable()) e.attach?.({ ...ctx, signal: ctrl.signal, publish: (r) => this.accept(r, ctx.station, ctrl.signal) });
    }
  }

  detach() {
    this.ctrl?.abort();
    this.ctrl = null;
    this.context = null;
    this.setCurrent(null);
  }

  /** Lance un moteur à la demande sur la station en cours. */
  async identify(engineId: string): Promise<Track | null> {
    const e = this.engines.get(engineId);
    if (!e?.identify || !this.context || !this.ctrl) return null;
    const ctx = this.context;
    const signal = this.ctrl.signal;
    const r = await e.identify({ ...ctx, signal, publish: () => {} });
    return r ? this.accept(r, ctx.station, signal) : null;
  }

  private async accept(r: RecognitionResult, station: Station, signal: AbortSignal): Promise<Track | null> {
    if (signal.aborted || !r.title || r.confidence < MIN_CONFIDENCE) return null;
    const now = Date.now();

    // Le morceau en cours, confirmé par une autre source (station puis Shazam, ou
    // Shazam de nouveau) : on complète l'existant, sans nouvelle entrée d'historique.
    const cur = this.current;
    if (cur && cur.stationId === station.id && sameSong(cur, r)) {
      const merged: Track = { ...cur, album: cur.album ?? r.album, artworkUrl: cur.artworkUrl ?? r.artworkUrl };
      if (r.offsetMs !== undefined && r.capturedAt !== undefined) {
        const art = this.options.artworkLookup() ? await findArtwork(r.artist ?? cur.artist, r.title, { relayUrl: this.options.relayUrl() }) : null;
        const duration = r.durationMs ?? art?.durationMs;
        if (duration) {
          merged.startedAt = r.capturedAt - r.offsetMs;
          merged.endsAt = merged.startedAt + duration;
        }
      }
      merged.confirmedAt = now;
      if (!signal.aborted && this.current?.id === cur.id) this.setCurrent(merged);
      return merged;
    }

    const track: Track = {
      id: 't_' + hash(`${station.id}|${r.artist}|${r.title}|${now}`) + now.toString(36),
      title: r.title,
      artist: r.artist,
      album: r.album,
      artworkUrl: r.artworkUrl,
      stationId: station.id,
      stationName: station.name,
      stationUrl: station.url,
      source: r.source,
      identifiedAt: now,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      raw: r.raw,
    };
    this.setCurrent(track);

    // Avec le relais, Spotify fournit la pochette de tous les morceaux (y compris ceux
    // identifiés par Shazam) ; sans relais, iTunes ne complète que ce qui manque.
    // La durée sert aussi à savoir quand le morceau identifié se termine.
    const relayUrl = this.options.relayUrl();
    const needsTiming = r.offsetMs !== undefined && r.capturedAt !== undefined;
    if (this.options.artworkLookup() && (relayUrl || needsTiming || !track.artworkUrl || !track.album)) {
      const art = await findArtwork(track.artist, track.title, { relayUrl });
      const duration = r.durationMs ?? art?.durationMs;
      if (duration && needsTiming) {
        track.startedAt = r.capturedAt! - r.offsetMs!;
        track.endsAt = track.startedAt + duration;
      }
      if (art && (art.provider === 'spotify' || !track.artworkUrl || !track.album)) {
        if (art.provider === 'spotify') track.artworkUrl = art.artworkUrl;
        else track.artworkUrl ??= art.artworkUrl;
        track.album ??= art.album;
        track.enrichedBy = art.provider;
        if (art.provider === 'spotify') track.spotifyUrl = art.url;
      }
      if (art && !signal.aborted && this.current?.id === track.id) this.setCurrent({ ...track });
    }

    // Même morceau annoncé de nouveau peu après (reconnexion, changement de source) : pas de doublon.
    const last = this.history.last();
    const same = last && last.stationId === track.stationId && last.title.toLowerCase() === track.title.toLowerCase() && (last.artist ?? '').toLowerCase() === (track.artist ?? '').toLowerCase();
    if (!(same && now - last!.identifiedAt < REPEAT_WINDOW)) await this.history.add(track);
    return track;
  }
}
