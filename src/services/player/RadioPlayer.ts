/**
 * Moteur de lecture radio, construit sur un unique HTMLAudioElement.
 *
 * Pourquoi un seul élément : sur iOS, un élément « débloqué » par un toucher
 * peut ensuite changer de source, se reconnecter et reprendre en arrière-plan
 * sans nouveau geste. On ne passe pas par la Web Audio API : un flux sans CORS
 * branché sur un AudioContext devient muet, et iOS suspend l'AudioContext
 * écran verrouillé.
 *
 * Le moteur ne connaît ni l'interface ni les métadonnées : il publie des états.
 */

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'reconnecting'
  | 'error';

export type PlayerErrorKind = 'unsupported' | 'network' | 'offline' | 'mixed-content' | 'unavailable' | 'autoplay';

export interface PlayerState {
  status: PlayerStatus;
  stationId: string | null;
  error?: { kind: PlayerErrorKind; message: string };
  attempt: number;
  /** Début de la lecture en cours (ms), pour la durée d'écoute. */
  since?: number;
}

export interface PlayableStation {
  id: string;
  url: string;
}

type Listener = (s: PlayerState) => void;

const MAX_ATTEMPTS = 6;
const STALL_TIMEOUT = 12_000;

export class RadioPlayer {
  readonly audio: HTMLAudioElement;
  private state: PlayerState = { status: 'idle', stationId: null, attempt: 0 };
  private listeners = new Set<Listener>();
  private current: PlayableStation | null = null;
  private resolveUrl: (s: PlayableStation) => string = (s) => s.url;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastTime = 0;
  private lastProgress = 0;
  private wantsPlay = false;

  constructor() {
    const a = document.createElement('audio');
    a.preload = 'none';
    a.setAttribute('playsinline', '');
    a.setAttribute('x-webkit-airplay', 'allow');
    // Indispensable sur iOS pour certaines anciennes versions : élément présent dans le DOM.
    a.style.display = 'none';
    document.body.appendChild(a);
    this.audio = a;

    a.addEventListener('playing', () => this.onPlaying());
    a.addEventListener('waiting', () => this.wantsPlay && this.set({ status: this.state.status === 'loading' ? 'loading' : 'buffering' }));
    a.addEventListener('stalled', () => this.wantsPlay && this.state.status === 'playing' && this.set({ status: 'buffering' }));
    a.addEventListener('pause', () => {
      // Pause imposée par le système (appel, autre app, AirPods retirés…)
      // (un changement de source peut aussi émettre « pause » : on l'ignore pendant le chargement)
      if (this.wantsPlay && !a.ended && this.state.status !== 'reconnecting' && this.state.status !== 'loading') {
        this.wantsPlay = false;
        this.set({ status: 'paused' });
      }
    });
    a.addEventListener('play', () => {
      // Lecture relancée depuis l'écran verrouillé ou le centre de contrôle
      if (!this.wantsPlay && this.current) {
        this.wantsPlay = true;
        this.set({ status: 'loading' });
      }
    });
    a.addEventListener('error', () => this.onError());
    a.addEventListener('ended', () => this.wantsPlay && this.scheduleReconnect('network'));
    a.addEventListener('timeupdate', () => {
      if (a.currentTime !== this.lastTime) {
        this.lastTime = a.currentTime;
        this.lastProgress = Date.now();
        // Certains lecteurs (HLS) n'émettent pas « playing » après une attente.
        if (this.wantsPlay && (this.state.status === 'buffering' || this.state.status === 'loading') && !a.paused) this.onPlaying();
      }
    });

    window.addEventListener('online', () => {
      if (this.wantsPlay && (this.state.status === 'reconnecting' || this.state.status === 'error')) this.reconnect();
    });
    window.addEventListener('offline', () => {
      if (this.wantsPlay) this.set({ status: 'reconnecting', error: { kind: 'offline', message: 'Connexion Internet perdue' } });
    });
  }

  /** Permet de router certains flux (HTTP, sans CORS) via le relais personnel facultatif. */
  setUrlResolver(fn: (s: PlayableStation) => string) {
    this.resolveUrl = fn;
  }

  getState(): PlayerState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    if (patch.status && patch.status !== 'error' && patch.status !== 'reconnecting' && !('error' in patch)) this.state.error = undefined;
    for (const l of this.listeners) l(this.state);
  }

  /** Doit être appelé directement dans le gestionnaire d'un toucher (restriction iOS). */
  play(station: PlayableStation) {
    clearTimeout(this.retryTimer);
    this.current = station;
    this.wantsPlay = true;
    this.set({ stationId: station.id, status: 'loading', attempt: 0, error: undefined, since: undefined });
    this.load();
  }

  /** Reprise : on recharge le flux pour revenir au direct plutôt qu'au tampon périmé. */
  resume() {
    if (!this.current) return;
    this.play(this.current);
  }

  pause() {
    this.wantsPlay = false;
    clearTimeout(this.retryTimer);
    this.stopWatchdog();
    this.audio.pause();
    this.set({ status: 'paused', since: undefined });
  }

  toggle(station?: PlayableStation) {
    if (station && station.id !== this.current?.id) return this.play(station);
    if (this.wantsPlay) this.pause();
    else this.resume();
  }

  stop() {
    this.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.set({ status: 'idle' });
  }

  /** Sélecteur AirPlay natif (Safari uniquement). */
  get airPlayAvailable(): boolean {
    return typeof (this.audio as any).webkitShowPlaybackTargetPicker === 'function';
  }

  showAirPlay() {
    (this.audio as any).webkitShowPlaybackTargetPicker?.();
  }

  private load() {
    if (!this.current) return;
    const url = this.resolveUrl(this.current);
    // Flux HTTP lu en HTTPS (conversion automatique) : s'il échoue, c'est qu'il n'existe qu'en HTTP.
    this.mixedContent = location.protocol === 'https:' && this.current.url.startsWith('http:') && (url.startsWith('http:') || url === 'https:' + this.current.url.slice(5));
    this.audio.src = url;
    this.lastProgress = Date.now();
    const p = this.audio.play();
    p?.catch((e: DOMException) => {
      if (e.name === 'NotAllowedError') {
        this.wantsPlay = false;
        this.set({ status: 'error', error: { kind: 'autoplay', message: 'Touchez lecture pour démarrer (restriction iOS)' } });
      } else if (e.name === 'NotSupportedError') {
        this.onError();
      }
      // AbortError : un nouveau src a été chargé entre-temps, rien à faire.
    });
  }

  private mixedContent = false;

  private onPlaying() {
    if (!this.wantsPlay) return;
    clearTimeout(this.retryTimer);
    this.set({ status: 'playing', attempt: 0, since: this.state.since ?? Date.now() });
    this.startWatchdog();
  }

  private onError() {
    if (!this.wantsPlay || !this.current) return;
    const code = this.audio.error?.code;
    if (!navigator.onLine) return this.scheduleReconnect('offline');
    if (this.mixedContent && this.state.attempt >= 1) {
      return this.fail('mixed-content', 'Ce flux n’existe qu’en HTTP, que Safari bloque. Le relais (Réglages) permet de le lire.');
    }
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && this.state.attempt >= 1) {
      return this.fail('unsupported', 'Format non pris en charge par Safari, ou station hors ligne');
    }
    this.scheduleReconnect(code === MediaError.MEDIA_ERR_DECODE ? 'unsupported' : 'network');
  }

  private scheduleReconnect(kind: PlayerErrorKind) {
    clearTimeout(this.retryTimer);
    this.stopWatchdog();
    const attempt = this.state.attempt + 1;
    if (attempt > MAX_ATTEMPTS) {
      return this.fail(kind === 'offline' ? 'offline' : 'unavailable', kind === 'offline' ? 'Pas de connexion Internet' : 'Radio indisponible pour le moment');
    }
    const delay = Math.min(1000 * 2 ** (attempt - 1), 15_000);
    this.set({
      status: 'reconnecting',
      attempt,
      error: { kind, message: kind === 'offline' ? 'En attente du réseau…' : `Reconnexion (${attempt}/${MAX_ATTEMPTS})…` },
    });
    this.retryTimer = setTimeout(() => this.reconnect(), delay);
  }

  private reconnect() {
    if (!this.wantsPlay || !this.current) return;
    this.load();
  }

  private fail(kind: PlayerErrorKind, message: string) {
    this.wantsPlay = false;
    this.stopWatchdog();
    clearTimeout(this.retryTimer);
    this.audio.pause();
    this.set({ status: 'error', error: { kind, message } });
  }

  /** Détecte un flux figé (aucune progression) et relance la connexion. */
  private startWatchdog() {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      if (!this.wantsPlay) return;
      if (Date.now() - this.lastProgress > STALL_TIMEOUT) {
        this.lastProgress = Date.now();
        this.scheduleReconnect(navigator.onLine ? 'network' : 'offline');
      }
    }, 3000);
  }

  private stopWatchdog() {
    clearInterval(this.watchdog);
  }
}
