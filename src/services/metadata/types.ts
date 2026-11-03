import type { Station, TrackSource } from '../../core/types';

/** Ce qu'un flux annonce. Rien n'est déduit ni inventé à ce stade. */
export interface StreamMetadata {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  raw: string;
  source: TrackSource;
}

export type ProviderOutcome =
  /** La source fonctionne pour ce flux (même si aucun titre n'est encore annoncé). */
  | 'active'
  /** Inutilisable pour ce flux (CORS, format, serveur) : essayer la source suivante. */
  | 'unsupported';

export interface ProviderContext {
  station: Station;
  /** URL effectivement lue (éventuellement via relais). */
  url: string;
  audio: HTMLAudioElement;
  relayUrl: string;
  signal: AbortSignal;
  emit: (m: StreamMetadata) => void;
}

/**
 * Une source de métadonnées. `start` renvoie dès que la source sait si elle
 * peut fonctionner ; elle continue ensuite d'émettre jusqu'à l'annulation.
 */
export interface MetadataProvider {
  id: string;
  label: string;
  accepts(station: Station, ctx: { relayUrl: string }): boolean;
  start(ctx: ProviderContext): Promise<ProviderOutcome>;
}

export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
