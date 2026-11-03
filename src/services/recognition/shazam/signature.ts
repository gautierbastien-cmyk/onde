/**
 * Empreinte audio au format Shazam, en TypeScript pur.
 *
 * Portage de l'algorithme publié par les projets libres SongRec / shazamio
 * (rétro-ingénierie du format « vnd.shazam.sig ») : spectrogramme 16 kHz,
 * détection de pics par bandes de fréquence, sérialisation binaire + CRC32.
 * Aucune dépendance, aucun appel réseau ici.
 */

export const SAMPLE_RATE = 16000;
const FFT_SIZE = 2048;
const BINS = FFT_SIZE / 2 + 1; // 1025
const RING = 256;

export interface Peak {
  fftPassNumber: number;
  magnitude: number;
  correctedBin: number;
}

export interface Signature {
  numberSamples: number;
  bands: Map<number, Peak[]>; // 0: 250–520 Hz, 1: 520–1450, 2: 1450–3500, 3: 3500–5500
}

// Fenêtre de Hann : np.hanning(2050)[1:-1]
const HANNING = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) HANNING[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / 2049);

// FFT complexe itérative (radix 2), tables précalculées
const LOG2 = Math.log2(FFT_SIZE);
const REV = new Uint32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  let r = 0;
  for (let b = 0; b < LOG2; b++) r |= ((i >> b) & 1) << (LOG2 - 1 - b);
  REV[i] = r;
}
const COS = new Float64Array(FFT_SIZE / 2);
const SIN = new Float64Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  COS[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE);
  SIN[i] = -Math.sin((2 * Math.PI * i) / FFT_SIZE);
}

function powerSpectrum(input: Float64Array, out: Float64Array) {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) re[REV[i]] = input[i];
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step];
        const s = SIN[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  for (let i = 0; i < BINS; i++) out[i] = Math.max((re[i] * re[i] + im[i] * im[i]) / (1 << 17), 1e-10);
}

const NEIGHBORS = [-10, -7, -4, -3, 1, 2, 5, 8];
const OTHER_OFFSETS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Calcule l'empreinte d'un extrait PCM mono 16 kHz (entiers 16 bits signés). */
export function computeSignature(samples: Int16Array): Signature {
  const ring = new Float64Array(FFT_SIZE);
  let ringPos = 0;
  const fftOutputs = Array.from({ length: RING }, () => new Float64Array(BINS));
  let fftPos = 0;
  const spread = Array.from({ length: RING }, () => new Float64Array(BINS));
  let spreadPos = 0;
  let spreadWritten = 0;
  const bands = new Map<number, Peak[]>();
  const excerpt = new Float64Array(FFT_SIZE);

  for (let chunk = 0; chunk + 128 <= samples.length; chunk += 128) {
    // 1. FFT sur les 2048 derniers échantillons
    for (let i = 0; i < 128; i++) ring[(ringPos + i) % FFT_SIZE] = samples[chunk + i];
    ringPos = (ringPos + 128) % FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) excerpt[i] = ring[(ringPos + i) % FFT_SIZE] * HANNING[i];
    powerSpectrum(excerpt, fftOutputs[fftPos]);
    const lastFft = fftOutputs[fftPos];
    fftPos = (fftPos + 1) % RING;

    // 2. Étalement des pics (fréquence puis temps)
    const spreadLast = Float64Array.from(lastFft);
    for (let p = 0; p < BINS; p++) {
      if (p < BINS - 2) spreadLast[p] = Math.max(spreadLast[p], spreadLast[p + 1], spreadLast[p + 2]);
      let max = spreadLast[p];
      for (const former of [-1, -3, -6]) {
        const f = spread[mod(spreadPos + former, RING)];
        f[p] = max = Math.max(f[p], max);
      }
    }
    spread[spreadPos] = spreadLast;
    spreadPos = (spreadPos + 1) % RING;
    spreadWritten++;

    // 3. Reconnaissance des pics (décalée de 46 trames)
    if (spreadWritten < 46) continue;
    const fft46 = fftOutputs[mod(fftPos - 46, RING)];
    const spread49 = spread[mod(spreadPos - 49, RING)];
    for (let bin = 10; bin < 1015; bin++) {
      const v = fft46[bin];
      if (v < 1 / 64 || v < spread49[bin - 1]) continue;
      let maxNeighbor = 0;
      for (const o of NEIGHBORS) maxNeighbor = Math.max(spread49[bin + o], maxNeighbor);
      if (v <= maxNeighbor) continue;
      let maxOther = maxNeighbor;
      for (const o of OTHER_OFFSETS) maxOther = Math.max(spread[mod(spreadPos + o, RING)][bin - 1], maxOther);
      if (v <= maxOther) continue;

      const fftNumber = spreadWritten - 46;
      const mag = (x: number) => Math.log(Math.max(1 / 64, x)) * 1477.3 + 6144;
      const peakMag = mag(v);
      const before = mag(fft46[bin - 1]);
      const after = mag(fft46[bin + 1]);
      const variation1 = peakMag * 2 - before - after;
      if (variation1 <= 0) continue;
      const variation2 = ((after - before) * 32) / variation1;
      const correctedBin = bin * 64 + variation2;
      const hz = correctedBin * (SAMPLE_RATE / 2 / 1024 / 64);
      let band: number;
      if (hz > 250 && hz < 520) band = 0;
      else if (hz > 520 && hz < 1450) band = 1;
      else if (hz > 1450 && hz < 3500) band = 2;
      else if (hz > 3500 && hz <= 5500) band = 3;
      else continue;
      let list = bands.get(band);
      if (!list) bands.set(band, (list = []));
      list.push({ fftPassNumber: fftNumber, magnitude: Math.trunc(peakMag), correctedBin: Math.trunc(correctedBin) });
    }
  }
  return { numberSamples: Math.floor(samples.length / 128) * 128, bands };
}

// ——— Sérialisation binaire ———

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class Writer {
  private buf = new Uint8Array(4096);
  length = 0;
  private grow(n: number) {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf);
    this.buf = next;
  }
  u8(v: number) {
    this.grow(1);
    this.buf[this.length++] = v & 0xff;
  }
  u16(v: number) {
    this.u8(v);
    this.u8(v >>> 8);
  }
  u32(v: number) {
    this.u16(v & 0xffff);
    this.u16(v >>> 16);
  }
  bytes(b: Uint8Array) {
    this.grow(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  result() {
    return this.buf.slice(0, this.length);
  }
}

export function encodeSignature(sig: Signature): Uint8Array {
  const contents = new Writer();
  for (const band of [...sig.bands.keys()].sort((a, b) => a - b)) {
    const peaks = new Writer();
    let pass = 0;
    for (const p of sig.bands.get(band)!) {
      if (p.fftPassNumber - pass >= 255) {
        peaks.u8(0xff);
        peaks.u32(p.fftPassNumber);
        pass = p.fftPassNumber;
      }
      peaks.u8(p.fftPassNumber - pass);
      peaks.u16(p.magnitude);
      peaks.u16(p.correctedBin);
      pass = p.fftPassNumber;
    }
    const pb = peaks.result();
    contents.u32(0x60030040 + band);
    contents.u32(pb.length);
    contents.bytes(pb);
    for (let i = 0; i < mod(-pb.length, 4); i++) contents.u8(0);
  }
  const body = contents.result();

  const out = new Writer();
  // En-tête de 48 octets (CRC réécrit ensuite)
  out.u32(0xcafe2580); // magic1
  out.u32(0); // crc32
  out.u32(body.length + 8); // size_minus_header
  out.u32(0x94119c00); // magic2
  out.u32(0);
  out.u32(0);
  out.u32(0);
  out.u32(3 << 27); // 16 000 Hz
  out.u32(0);
  out.u32(0);
  out.u32(Math.trunc(sig.numberSamples + SAMPLE_RATE * 0.24));
  out.u32((15 << 19) + 0x40000);
  out.u32(0x40000000);
  out.u32(body.length + 8);
  out.bytes(body);
  const all = out.result();
  const crc = crc32(all.subarray(8));
  new DataView(all.buffer).setUint32(4, crc, true);
  return all;
}

export function signatureUri(sig: Signature): string {
  const bin = encodeSignature(sig);
  let s = '';
  for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000));
  return 'data:audio/vnd.shazam.sig;base64,' + btoa(s);
}
