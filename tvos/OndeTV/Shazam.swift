import AVFoundation
import Foundation

/// Reconnaissance Shazam (non officielle) : ~12 s du flux, empreinte calculée sur
/// l'Apple TV (algorithme publié par SongRec), requête via le relais personnel.
enum Shazam {
    struct Result {
        var title: String
        var artist: String?
        var album: String?
        var artwork: URL?
        var offset: TimeInterval?
        var capturedAt: Date
    }

    enum Failure: Error { case capture, decode, noMatch }

    static func identify(stream: URL, relay: URL) async throws -> Result {
        let capturedAt = Date().addingTimeInterval(-2)
        var bytes: Data
        do { bytes = try await capture(stream) } catch {
            // Flux refusé ou en HTTPS invalide : lecture via le relais
            var c = URLComponents(url: relay.appendingPathComponent("stream"), resolvingAgainstBaseURL: false)!
            c.queryItems = [URLQueryItem(name: "url", value: stream.absoluteString)]
            bytes = try await capture(c.url!)
        }
        let (aligned, ext) = Frames.align(bytes)
        let pcm = try decode(aligned, ext: ext)
        // Double vérification : deux fenêtres de 12 s (minimum exigé par Shazam) décalées ;
        // le résultat n'est retenu que si elles désignent le même morceau.
        let win = min(pcm.count, 16000 * 12)
        async let first = query(Array(pcm[0..<win]), relay)
        async let second = query(Array(pcm[(pcm.count - win)..<pcm.count]), relay)
        let (a, b) = try await (first, second)
        guard let json = a, let other = b,
              let track = json["track"] as? [String: Any], let otherTrack = other["track"] as? [String: Any],
              (track["key"] as? String) == (otherTrack["key"] as? String),
              let matches = json["matches"] as? [[String: Any]], !matches.isEmpty,
              let title = track["title"] as? String else { throw Failure.noMatch }
        let images = track["images"] as? [String: Any]
        let album = (track["sections"] as? [[String: Any]])?
            .flatMap { $0["metadata"] as? [[String: Any]] ?? [] }
            .first { ($0["title"] as? String)?.lowercased().contains("album") == true }?["text"] as? String
        return Result(title: title, artist: track["subtitle"] as? String, album: album,
                      artwork: ((images?["coverarthq"] ?? images?["coverart"]) as? String).flatMap(URL.init(string:)),
                      offset: matches[0]["offset"] as? Double, capturedAt: capturedAt)
    }

    /// Une requête Shazam ; nil si aucune correspondance fiable (décalages anormaux).
    private static func query(_ pcm: [Int16], _ relay: URL) async throws -> [String: Any]? {
        let sig = Signature.compute(pcm)
        var req = URLRequest(url: relay.appendingPathComponent("shazam"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "uri": Signature.uri(sig), "samplems": sig.numberSamples / 16, "timezone": TimeZone.current.identifier,
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let m = (json["matches"] as? [[String: Any]])?.first, json["track"] != nil else { return nil }
        let ts = abs(m["timeskew"] as? Double ?? 0), fs = abs(m["frequencyskew"] as? Double ?? 0)
        return ts > 0.03 || fs > 0.03 ? nil : json
    }

    /// Lit ~18 s de flux (au plus 600 Ko) sans toucher à la lecture en cours.
    private static func capture(_ url: URL) async throws -> Data {
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        let (stream, response) = try await URLSession.shared.bytes(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure.capture }
        var data = Data()
        data.reserveCapacity(600_000)
        let start = Date()
        for try await b in stream {
            data.append(b)
            guard data.count % 16_384 == 0 else { continue }
            // Arrêt dès que ~14 s d'audio sont reçues (Shazam exige 12 s par extrait)
            if data.count >= 600_000 || Date().timeIntervalSince(start) > 19 || Frames.duration(data) >= 14.3 { break }
        }
        stream.task.cancel()
        guard data.count > 16_000 else { throw Failure.capture }
        return data
    }

    /// Décodage natif (AudioToolbox) puis conversion en PCM 16 kHz mono 16 bits.
    private static func decode(_ data: Data, ext: String) throws -> [Int16] {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("extrait.\(ext)")
        try data.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let audio = try AVAudioFile(forReading: file)
        let inFormat = audio.processingFormat
        guard let inBuf = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(audio.length)) else { throw Failure.decode }
        try audio.read(into: inBuf)
        let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
        guard let conv = AVAudioConverter(from: inFormat, to: outFormat),
              let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(16000 * 20)) else { throw Failure.decode }
        var fed = false
        var err: NSError?
        conv.convert(to: outBuf, error: &err) { _, status in
            if fed { status.pointee = .endOfStream; return nil }
            fed = true
            status.pointee = .haveData
            return inBuf
        }
        guard err == nil, let ch = outBuf.int16ChannelData else { throw Failure.decode }
        let n = Int(outBuf.frameLength)
        // On saute la première seconde (souvent tronquée) et on garde 13 s.
        let skip = min(16000, max(0, n - 16000 * 13))
        let count = min(n - skip, 16000 * 13)
        guard count >= 16000 * 4 else { throw Failure.decode }
        return Array(UnsafeBufferPointer(start: ch[0] + skip, count: count))
    }
}

// MARK: - Recalage sur des trames complètes (le décodeur Apple refuse un début de trame tronqué)

enum Frames {
    private static let mp3v1: [Int] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    private static let mp3v2: [Int] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
    private static let rates: [Int: [Int]] = [3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]]

    static func adts(_ b: [UInt8], _ i: Int) -> Int {
        guard i + 7 <= b.count, b[i] == 0xFF, b[i + 1] & 0xF6 == 0xF0 else { return 0 }
        let len = (Int(b[i + 3] & 0x03) << 11) | (Int(b[i + 4]) << 3) | (Int(b[i + 5]) >> 5)
        return len >= 7 ? len : 0
    }

    static func mp3(_ b: [UInt8], _ i: Int) -> Int {
        guard i + 4 <= b.count, b[i] == 0xFF, b[i + 1] & 0xE0 == 0xE0 else { return 0 }
        let version = Int(b[i + 1] >> 3) & 3, layer = Int(b[i + 1] >> 1) & 3
        guard version != 1, layer == 1 else { return 0 }
        let bitrate = (version == 3 ? mp3v1 : mp3v2)[Int(b[i + 2] >> 4)]
        guard bitrate > 0, let rate = rates[version]?[safe: Int(b[i + 2] >> 2) & 3] else { return 0 }
        let padding = Int(b[i + 2] >> 1) & 1
        return (version == 3 ? 144 : 72) * bitrate * 1000 / rate + padding
    }

    /// Durée audio (s) des trames complètes reçues.
    static func duration(_ data: Data) -> Double {
        let (aligned, _) = align(data)
        let b = [UInt8](aligned)
        let adtsRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
        var i = 0, seconds = 0.0
        while i < b.count {
            let a = adts(b, i)
            if a > 0 {
                let idx = Int(b[i + 2] >> 2) & 0x0F
                if idx < adtsRates.count { seconds += 1024 / Double(adtsRates[idx]) }
                i += a
                continue
            }
            let m = mp3(b, i)
            guard m > 0 else { break }
            let version = Int(b[i + 1] >> 3) & 3
            if let rate = rates[version]?[safe: Int(b[i + 2] >> 2) & 3] { seconds += Double(version == 3 ? 1152 : 576) / Double(rate) }
            i += m
        }
        return seconds
    }

    static func align(_ data: Data) -> (Data, String) {
        let b = [UInt8](data)
        for (frame, ext) in [(adts, "aac"), (mp3, "mp3")] as [(([UInt8], Int) -> Int, String)] {
            for start in 0..<min(b.count, 65536) {
                let f1 = frame(b, start)
                guard f1 > 0 else { continue }
                let f2 = frame(b, start + f1)
                guard f2 > 0, frame(b, start + f1 + f2) > 0 else { continue }
                var end = start
                while true {
                    let len = frame(b, end)
                    if len == 0 || end + len > b.count { break }
                    end += len
                }
                return (data.subdata(in: start..<end), ext)
            }
        }
        return (data, "mp3")
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

// MARK: - Empreinte au format Shazam (portage de onde/src/services/recognition/shazam/signature.ts)

enum Signature {
    struct Peak { let pass: Int; let magnitude: Int; let bin: Int }
    struct Sig { let numberSamples: Int; let bands: [Int: [Peak]] }

    private static let n = 2048, bins = 1025, ring = 256
    private static let hanning: [Double] = (0..<2048).map { 0.5 - 0.5 * cos(2 * .pi * Double($0 + 1) / 2049) }
    private static let rev: [Int] = (0..<2048).map { i in (0..<11).reduce(0) { $0 | (((i >> $1) & 1) << (10 - $1)) } }
    private static let cosT: [Double] = (0..<1024).map { cos(2 * .pi * Double($0) / 2048) }
    private static let sinT: [Double] = (0..<1024).map { -sin(2 * .pi * Double($0) / 2048) }

    private static func power(_ input: [Double]) -> [Double] {
        var re = [Double](repeating: 0, count: n), im = [Double](repeating: 0, count: n)
        for i in 0..<n { re[rev[i]] = input[i] }
        var size = 2
        while size <= n {
            let half = size / 2, step = n / size
            var start = 0
            while start < n {
                for k in 0..<half {
                    let c = cosT[k * step], s = sinT[k * step], a = start + k, b = a + half
                    let tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c
                    re[b] = re[a] - tr; im[b] = im[a] - ti
                    re[a] += tr; im[a] += ti
                }
                start += size
            }
            size <<= 1
        }
        return (0..<bins).map { max((re[$0] * re[$0] + im[$0] * im[$0]) / Double(1 << 17), 1e-10) }
    }

    private static func mod(_ a: Int, _ m: Int) -> Int { ((a % m) + m) % m }

    static func compute(_ samples: [Int16]) -> Sig {
        var ringSamples = [Double](repeating: 0, count: n)
        var ringPos = 0
        var ffts = [[Double]](repeating: [Double](repeating: 0, count: bins), count: ring)
        var fftPos = 0
        var spread = [[Double]](repeating: [Double](repeating: 0, count: bins), count: ring)
        var spreadPos = 0, spreadWritten = 0
        var bands: [Int: [Peak]] = [:]
        let neighbors = [-10, -7, -4, -3, 1, 2, 5, 8]
        let others = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249]
        func mag(_ x: Double) -> Double { log(max(1.0 / 64, x)) * 1477.3 + 6144 }

        var chunk = 0
        while chunk + 128 <= samples.count {
            for i in 0..<128 { ringSamples[(ringPos + i) % n] = Double(samples[chunk + i]) }
            ringPos = (ringPos + 128) % n
            let excerpt = (0..<n).map { ringSamples[(ringPos + $0) % n] * hanning[$0] }
            let last = power(excerpt)
            ffts[fftPos] = last
            fftPos = (fftPos + 1) % ring

            var spreadLast = last
            for p in 0..<bins {
                if p < bins - 2 { spreadLast[p] = max(spreadLast[p], spreadLast[p + 1], spreadLast[p + 2]) }
                var m = spreadLast[p]
                for former in [-1, -3, -6] {
                    let idx = mod(spreadPos + former, ring)
                    m = max(spread[idx][p], m)
                    spread[idx][p] = m
                }
            }
            spread[spreadPos] = spreadLast
            spreadPos = (spreadPos + 1) % ring
            spreadWritten += 1
            chunk += 128

            guard spreadWritten >= 46 else { continue }
            let f46 = ffts[mod(fftPos - 46, ring)]
            let s49 = spread[mod(spreadPos - 49, ring)]
            for bin in 10..<1015 {
                let v = f46[bin]
                guard v >= 1.0 / 64, v >= s49[bin - 1] else { continue }
                var maxN = 0.0
                for o in neighbors { maxN = max(s49[bin + o], maxN) }
                guard v > maxN else { continue }
                var maxO = maxN
                for o in others { maxO = max(spread[mod(spreadPos + o, ring)][bin - 1], maxO) }
                guard v > maxO else { continue }
                let pm = mag(v), before = mag(f46[bin - 1]), after = mag(f46[bin + 1])
                let v1 = pm * 2 - before - after
                guard v1 > 0 else { continue }
                let corrected = Double(bin * 64) + (after - before) * 32 / v1
                let hz = corrected * (16000.0 / 2 / 1024 / 64)
                let band: Int
                if hz > 250 && hz < 520 { band = 0 } else if hz > 520 && hz < 1450 { band = 1 } else if hz > 1450 && hz < 3500 { band = 2 } else if hz > 3500 && hz <= 5500 { band = 3 } else { continue }
                bands[band, default: []].append(Peak(pass: spreadWritten - 46, magnitude: Int(pm), bin: Int(corrected)))
            }
        }
        return Sig(numberSamples: samples.count / 128 * 128, bands: bands)
    }

    private static func crc32(_ bytes: [UInt8]) -> UInt32 {
        var table = [UInt32](repeating: 0, count: 256)
        for i in 0..<256 {
            var c = UInt32(i)
            for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
            table[i] = c
        }
        var c: UInt32 = 0xFFFFFFFF
        for b in bytes { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFFFFFF
    }

    static func encode(_ sig: Sig) -> [UInt8] {
        func u32(_ v: UInt32, _ out: inout [UInt8]) { out += [UInt8(v & 0xFF), UInt8(v >> 8 & 0xFF), UInt8(v >> 16 & 0xFF), UInt8(v >> 24 & 0xFF)] }
        func u16(_ v: Int, _ out: inout [UInt8]) { out += [UInt8(v & 0xFF), UInt8(v >> 8 & 0xFF)] }
        var body: [UInt8] = []
        for band in sig.bands.keys.sorted() {
            var peaks: [UInt8] = []
            var pass = 0
            for p in sig.bands[band]! {
                if p.pass - pass >= 255 {
                    peaks.append(0xFF)
                    u32(UInt32(p.pass), &peaks)
                    pass = p.pass
                }
                peaks.append(UInt8(p.pass - pass))
                u16(p.magnitude, &peaks)
                u16(p.bin, &peaks)
                pass = p.pass
            }
            u32(UInt32(0x60030040 + band), &body)
            u32(UInt32(peaks.count), &body)
            body += peaks
            body += [UInt8](repeating: 0, count: (4 - peaks.count % 4) % 4)
        }
        var out: [UInt8] = []
        u32(0xCAFE2580, &out)
        u32(0, &out)
        u32(UInt32(body.count + 8), &out)
        u32(0x94119C00, &out)
        for _ in 0..<3 { u32(0, &out) }
        u32(3 << 27, &out)
        for _ in 0..<2 { u32(0, &out) }
        u32(UInt32(sig.numberSamples + Int(16000 * 0.24)), &out)
        u32((15 << 19) + 0x40000, &out)
        u32(0x40000000, &out)
        u32(UInt32(body.count + 8), &out)
        out += body
        let crc = crc32(Array(out[8...]))
        out[4] = UInt8(crc & 0xFF); out[5] = UInt8(crc >> 8 & 0xFF); out[6] = UInt8(crc >> 16 & 0xFF); out[7] = UInt8(crc >> 24 & 0xFF)
        return out
    }

    static func uri(_ sig: Sig) -> String {
        "data:audio/vnd.shazam.sig;base64," + Data(encode(sig)).base64EncodedString()
    }
}
