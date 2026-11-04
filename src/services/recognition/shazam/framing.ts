/**
 * Recalage d'un extrait de flux sur des trames audio complètes.
 *
 * Un flux radio capturé « en cours de route » commence au milieu d'une trame
 * et se termine sur une trame tronquée. Le décodeur de Safari refuse alors
 * tout l'extrait : on garde uniquement une suite de trames ADTS (AAC/AAC+)
 * ou MPEG (MP3) qui s'enchaînent correctement.
 */

const MP3_BITRATES: Record<string, number[]> = {
  // [version MPEG-1][Layer III], puis MPEG-2/2.5 Layer III (kb/s)
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Longueur d'une trame ADTS commençant en i, ou 0. */
function adtsLength(b: Uint8Array, i: number): number {
  if (i + 7 > b.length || b[i] !== 0xff || (b[i + 1] & 0xf6) !== 0xf0) return 0;
  const len = ((b[i + 3] & 0x03) << 11) | (b[i + 4] << 3) | (b[i + 5] >> 5);
  return len >= 7 ? len : 0;
}

/** Longueur d'une trame MP3 (Layer III) commençant en i, ou 0. */
function mp3Length(b: Uint8Array, i: number): number {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[i + 1] >> 3) & 3; // 3 : MPEG-1, 2 : MPEG-2, 0 : MPEG-2.5
  const layer = (b[i + 1] >> 1) & 3; // 1 : Layer III
  if (version === 1 || layer !== 1) return 0;
  const bitrate = (version === 3 ? MP3_BITRATES.v1 : MP3_BITRATES.v2)[b[i + 2] >> 4];
  const rate = MP3_RATES[version]?.[(b[i + 2] >> 2) & 3];
  if (!bitrate || !rate) return 0;
  const padding = (b[i + 2] >> 1) & 1;
  return Math.floor(((version === 3 ? 144 : 72) * bitrate * 1000) / rate) + padding;
}

/** Plus longue chaîne de trames valides à partir de la première synchronisation fiable. */
export function alignFrames(bytes: Uint8Array): Uint8Array {
  for (const frameLength of [adtsLength, mp3Length]) {
    for (let start = 0; start < Math.min(bytes.length, 64 * 1024); start++) {
      const first = frameLength(bytes, start);
      // Une synchronisation n'est retenue que si trois trames s'enchaînent.
      if (!first) continue;
      const second = frameLength(bytes, start + first);
      if (!second || !frameLength(bytes, start + first + second)) continue;
      let end = start;
      while (true) {
        const len = frameLength(bytes, end);
        if (!len || end + len > bytes.length) break;
        end += len;
      }
      return bytes.subarray(start, end);
    }
  }
  return bytes; // format non reconnu (Ogg, MP4…) : on laisse le décodeur se débrouiller
}

const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Durée audio (s) contenue dans les trames complètes d'un extrait MP3 ou AAC (ADTS). */
export function audioDuration(bytes: Uint8Array): number {
  const aligned = alignFrames(bytes);
  if (aligned === bytes && adtsLength(bytes, 0) === 0 && mp3Length(bytes, 0) === 0) return 0; // format inconnu
  let seconds = 0;
  for (let i = 0; i < aligned.length; ) {
    const adts = adtsLength(aligned, i);
    if (adts) {
      const rate = ADTS_RATES[(aligned[i + 2] >> 2) & 0x0f];
      if (rate) seconds += 1024 / rate;
      i += adts;
      continue;
    }
    const mp3 = mp3Length(aligned, i);
    if (!mp3) break;
    const version = (aligned[i + 1] >> 3) & 3;
    const rate = MP3_RATES[version]?.[(aligned[i + 2] >> 2) & 3];
    if (rate) seconds += (version === 3 ? 1152 : 576) / rate;
    i += mp3;
  }
  return seconds;
}
