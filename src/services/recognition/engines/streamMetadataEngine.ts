/**
 * Moteur « métadonnées du flux » : version 1 de l'identification.
 * Il relaie vers MusicRecognitionService ce que la radio annonce elle-même.
 */
import type { MetadataService } from '../../metadata/MetadataService';
import type { RecognitionEngine } from '../MusicRecognitionService';

export function streamMetadataEngine(metadata: MetadataService, relayUrl: () => string): RecognitionEngine {
  return {
    id: 'stream-metadata',
    label: 'Métadonnées de la radio',
    mode: 'passive',
    isAvailable: () => true,
    attach({ station, streamUrl, publish, signal }) {
      const off = metadata.onMetadata((m, s) => {
        if (s.id !== station.id || signal.aborted) return;
        publish({ title: m.title, artist: m.artist, album: m.album, artworkUrl: m.artworkUrl, source: m.source, raw: m.raw, confidence: 1 });
      });
      signal.addEventListener('abort', () => (off(), metadata.stop()), { once: true });
      metadata.start(station, streamUrl, relayUrl());
    },
  };
}
