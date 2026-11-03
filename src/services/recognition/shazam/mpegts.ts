/**
 * Extraction de la piste audio d'un flux MPEG-TS (segments HLS « .ts »).
 *
 * Le navigateur ne sait pas décoder un conteneur TS avec decodeAudioData :
 * on lit la table des programmes (PAT/PMT), on repère la piste AAC (ADTS) ou
 * MP3, puis on recolle ses paquets PES en un flux audio brut décodable.
 * La vidéo éventuelle est ignorée.
 */

const PACKET = 188;
const AUDIO_TYPES = new Set([0x0f, 0x03, 0x04]); // AAC ADTS, MPEG-1/2 audio

export function isMpegTs(b: Uint8Array): boolean {
  for (let i = 0; i < Math.min(PACKET, b.length); i++) {
    if (b[i] === 0x47 && b[i + PACKET] === 0x47 && b[i + 2 * PACKET] === 0x47) return true;
  }
  return false;
}

function payloadStart(b: Uint8Array, i: number): number {
  const afc = (b[i + 3] >> 4) & 3;
  if (afc === 2) return -1; // pas de charge utile
  return afc === 3 ? i + 5 + b[i + 4] : i + 4;
}

export function extractTsAudio(b: Uint8Array): Uint8Array | null {
  let first = -1;
  for (let i = 0; i < Math.min(PACKET, b.length); i++) {
    if (b[i] === 0x47 && b[i + PACKET] === 0x47) {
      first = i;
      break;
    }
  }
  if (first < 0) return null;

  let pmtPid = -1;
  let audioPid = -1;
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (let i = first; i + PACKET <= b.length; i += PACKET) {
    if (b[i] !== 0x47) continue;
    const pusi = (b[i + 1] & 0x40) !== 0;
    const pid = ((b[i + 1] & 0x1f) << 8) | b[i + 2];
    let p = payloadStart(b, i);
    if (p < 0 || p >= i + PACKET) continue;

    if (pid === 0 && pusi && pmtPid < 0) {
      p += 1 + b[p]; // pointer_field
      // PAT : premières entrées programme → PID de la PMT
      const sectionLength = ((b[p + 1] & 0x0f) << 8) | b[p + 2];
      for (let e = p + 8; e < p + 3 + sectionLength - 4; e += 4) {
        const program = (b[e] << 8) | b[e + 1];
        if (program !== 0) {
          pmtPid = ((b[e + 2] & 0x1f) << 8) | b[e + 3];
          break;
        }
      }
    } else if (pid === pmtPid && pusi && audioPid < 0) {
      p += 1 + b[p];
      const sectionLength = ((b[p + 1] & 0x0f) << 8) | b[p + 2];
      const infoLength = ((b[p + 10] & 0x0f) << 8) | b[p + 11];
      const end = p + 3 + sectionLength - 4;
      for (let e = p + 12 + infoLength; e + 5 <= end; ) {
        const type = b[e];
        const esPid = ((b[e + 1] & 0x1f) << 8) | b[e + 2];
        const esInfo = ((b[e + 3] & 0x0f) << 8) | b[e + 4];
        if (AUDIO_TYPES.has(type)) {
          audioPid = esPid;
          break;
        }
        e += 5 + esInfo;
      }
    } else if (pid === audioPid) {
      if (pusi) {
        // En-tête PES : 00 00 01, id, longueur, 2 octets de drapeaux, longueur d'en-tête
        if (b[p] !== 0 || b[p + 1] !== 0 || b[p + 2] !== 1) continue;
        p += 9 + b[p + 8];
      }
      const end = i + PACKET;
      if (p < end) {
        chunks.push(b.subarray(p, end));
        size += end - p;
      }
    }
  }
  if (!size) return null;
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) out.set(c, o), (o += c.length);
  return out;
}
