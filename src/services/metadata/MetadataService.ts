/**
 * Orchestration des sources de métadonnées pour la station en cours.
 * Les sources sont essayées dans l'ordre ; la première qui fonctionne reste
 * active jusqu'au changement de station ou à la pause.
 */
import type { Station } from '../../core/types';
import { hlsId3Provider } from './providers/hlsId3';
import { icyInBandProvider } from './providers/icyInBand';
import { icecastStatusProvider } from './providers/icecastStatus';
import { radioFranceProvider } from './providers/radioFrance';
import { relayProvider } from './providers/relay';
import type { MetadataProvider, StreamMetadata } from './types';

export type MetadataStatus =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'active'; via: string; waiting: boolean }
  | { state: 'unavailable'; reason: string };

export class MetadataService {
  private providers: MetadataProvider[] = [radioFranceProvider, hlsId3Provider, icyInBandProvider, icecastStatusProvider, relayProvider];
  private ctrl: AbortController | null = null;
  private lastKey = '';
  private status: MetadataStatus = { state: 'idle' };
  private statusListeners = new Set<(s: MetadataStatus) => void>();
  private dataListeners = new Set<(m: StreamMetadata, station: Station) => void>();
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private audio: HTMLAudioElement) {}

  /** Ajoute une source (ex. une API de diffuseur) sans toucher au reste. */
  register(provider: MetadataProvider, priority = this.providers.length) {
    this.providers.splice(priority, 0, provider);
  }

  onStatus(fn: (s: MetadataStatus) => void) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onMetadata(fn: (m: StreamMetadata, station: Station) => void) {
    this.dataListeners.add(fn);
    return () => this.dataListeners.delete(fn);
  }

  private setStatus(s: MetadataStatus) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  getStatus() {
    return this.status;
  }

  async start(station: Station, url: string, relayUrl: string) {
    this.stop();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.lastKey = '';
    this.setStatus({ state: 'searching' });

    const emit = (m: StreamMetadata) => {
      if (ctrl.signal.aborted) return;
      const key = `${m.artist ?? ''}|${m.title}`.toLowerCase();
      clearTimeout(this.silenceTimer);
      if (this.status.state === 'active' && this.status.waiting) this.setStatus({ ...this.status, waiting: false });
      if (key === this.lastKey) return;
      this.lastKey = key;
      for (const l of this.dataListeners) l(m, station);
    };

    for (const p of this.providers) {
      if (ctrl.signal.aborted) return;
      if (!p.accepts(station, { relayUrl })) continue;
      const outcome = await p.start({ station, url, audio: this.audio, relayUrl, signal: ctrl.signal, emit }).catch(() => 'unsupported' as const);
      if (ctrl.signal.aborted) return;
      if (outcome === 'active') {
        if (this.status.state !== 'active') this.setStatus({ state: 'active', via: p.label, waiting: !this.lastKey });
        // Une source peut fonctionner sans jamais annoncer de titre (HLS sans ID3).
        if (!this.lastKey)
          this.silenceTimer = setTimeout(() => {
            if (!this.lastKey && !ctrl.signal.aborted) this.setStatus({ state: 'unavailable', reason: 'Cette station n’annonce pas les titres diffusés.' });
          }, 60_000);
        return;
      }
    }
    this.setStatus({
      state: 'unavailable',
      reason: relayUrl
        ? 'Aucune information musicale fournie par ce flux.'
        : 'Ce serveur ne partage pas ses métadonnées avec les navigateurs (CORS). Un relais gratuit peut les récupérer : voir Réglages.',
    });
  }

  stop() {
    this.ctrl?.abort();
    this.ctrl = null;
    clearTimeout(this.silenceTimer);
    if (this.status.state !== 'idle') this.setStatus({ state: 'idle' });
  }
}
