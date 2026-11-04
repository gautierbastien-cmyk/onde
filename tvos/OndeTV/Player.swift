import AVFoundation
import MediaPlayer
import SwiftUI

struct NowTrack: Equatable {
    var title: String
    var artist: String?
    var album: String?
    var artwork: URL?
    var source: String // "station", "Radio France", "Shazam"
    var startedAt: Date?
    var endsAt: Date?
    var identifiedAt = Date()

    static func == (a: NowTrack, b: NowTrack) -> Bool {
        a.title == b.title && a.artist == b.artist && a.artwork == b.artwork && a.endsAt == b.endsAt && a.album == b.album
    }
}

enum PlayState: Equatable { case idle, loading, playing, paused, failed(String) }

@MainActor
final class Player: NSObject, ObservableObject {
    @Published private(set) var station: Station?
    @Published private(set) var state: PlayState = .idle
    @Published private(set) var track: NowTrack?
    @Published private(set) var recognizing = false

    weak var library: Library?
    weak var history: History?
    private let player = AVPlayer()
    private var itemObservers: [NSKeyValueObservation] = []
    private var metadataOutput: AVPlayerItemMetadataOutput?
    private var retries = 0
    private var tasks: [Task<Void, Never>] = []
    private var lastShazam = Date.distantPast
    private var shazamMisses = 0

    override init() {
        super.init()
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        player.automaticallyWaitsToMinimizeStalling = true
        setupRemote()
        NotificationCenter.default.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reconnect() }
        }
        NotificationCenter.default.addObserver(forName: AVPlayerItem.playbackStalledNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reconnect(after: 4) }
        }
    }

    var isPlaying: Bool { state == .playing || state == .loading }

    // MARK: Lecture

    func play(_ s: Station) {
        if station?.id == s.id, isPlaying { return }
        station = s
        track = nil
        retries = 0
        shazamMisses = 0
        lastShazam = .distantPast
        library?.markPlayed(s)
        start()
    }

    func toggle() {
        guard let station else { return }
        if isPlaying { pause() } else { _ = station; start() }
    }

    func pause() {
        player.pause()
        state = .paused
        cancelTasks()
        updateNowPlaying()
    }

    func skip(_ delta: Int) {
        guard let lib = library else { return }
        let list = lib.favoriteStations.isEmpty ? lib.stations : lib.favoriteStations
        guard !list.isEmpty else { return }
        let i = station.flatMap { s in list.firstIndex(of: s) } ?? -1
        play(list[(i + delta + list.count) % list.count])
    }

    private func start() {
        guard let station else { return }
        cancelTasks()
        try? AVAudioSession.sharedInstance().setActive(true)
        let item = AVPlayerItem(url: station.url)
        item.preferredForwardBufferDuration = 4
        let output = AVPlayerItemMetadataOutput(identifiers: nil)
        output.setDelegate(self, queue: .main)
        item.add(output)
        metadataOutput = output
        itemObservers = [
            item.observe(\.status) { [weak self] item, _ in
                Task { @MainActor in
                    if item.status == .failed { self?.reconnect() }
                }
            },
        ]
        player.replaceCurrentItem(with: item)
        state = .loading
        player.play()
        observePlaying()
        startSideTasks(for: station)
        updateNowPlaying()
    }

    private func observePlaying() {
        tasks.append(Task { [weak self] in
            for _ in 0..<60 {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self, !Task.isCancelled else { return }
                if self.player.timeControlStatus == .playing {
                    self.state = .playing
                    self.retries = 0
                    self.updateNowPlaying()
                    return
                }
            }
        })
    }

    private func reconnect(after seconds: Double = 1) {
        guard station != nil, state != .paused else { return }
        retries += 1
        if retries > 5 {
            state = .failed("Radio indisponible pour le moment")
            player.pause()
            return
        }
        state = .loading
        Task {
            try? await Task.sleep(for: .seconds(seconds * Double(retries)))
            if state == .loading { start() }
        }
    }

    private func cancelTasks() {
        tasks.forEach { $0.cancel() }
        tasks = []
    }

    // MARK: Titres, émission, Shazam

    private func startSideTasks(for s: Station) {
        // Radio France publie ses titres via une API publique
        if let rf = RadioFrance.id(for: s.url) {
            tasks.append(Task { [weak self] in
                while !Task.isCancelled {
                    if let t = await RadioFrance.current(rf) { self?.setTrack(t, for: s) }
                    try? await Task.sleep(for: .seconds(30))
                }
            })
        }
        // Shazam automatique : au démarrage puis à chaque fin de morceau
        guard AppConfig.relayURL != nil else { return }
        tasks.append(Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            while !Task.isCancelled {
                guard let self else { return }
                if self.shazamDue() { await self.identify() }
                try? await Task.sleep(for: .seconds(1))
            }
        })
    }

    private func shazamDue() -> Bool {
        guard state == .playing, !recognizing else { return false }
        let now = Date()
        if let t = track {
            // Fin du morceau + 3 s, puis toutes les 12 s jusqu'à reconnaître le suivant
            if let end = t.endsAt, now < end.addingTimeInterval(180) {
                return now > end.addingTimeInterval(3) && now.timeIntervalSince(lastShazam) >= 12
            }
            if t.source == "station" || t.source == "Radio France" {
                // Titre annoncé : une confirmation Shazam par morceau, pour le minutage
                return now.timeIntervalSince(t.identifiedAt) > 20 && lastShazam < t.identifiedAt
            }
        }
        let delay = shazamMisses == 0 ? 0 : min(180, 25 * pow(2, Double(shazamMisses - 1)))
        return now.timeIntervalSince(lastShazam) >= max(delay, track == nil ? 0 : 45)
    }

    func identify() async {
        guard let s = station, let relay = AppConfig.relayURL, !recognizing else { return }
        recognizing = true
        lastShazam = Date()
        defer { recognizing = false }
        guard let r = try? await Shazam.identify(stream: s.url, relay: relay) else {
            shazamMisses += 1
            return
        }
        shazamMisses = 0
        var t = NowTrack(title: r.title, artist: r.artist, album: r.album, artwork: r.artwork, source: "Shazam")
        let info = await Artwork.find(artist: r.artist, title: r.title)
        if let info {
            t.artwork = info.artwork ?? t.artwork
            t.album = t.album ?? info.album
        }
        // Fin du morceau : position Shazam + durée exacte (sinon celle du catalogue)
        if let d = r.duration ?? info?.duration, let offset = r.offset {
            t.startedAt = r.capturedAt.addingTimeInterval(-offset)
            t.endsAt = t.startedAt!.addingTimeInterval(d)
        }
        guard station?.id == s.id else { return }
        // Même morceau que celui annoncé : on garde le titre et on ajoute le minutage
        if var cur = track, Artwork.same(cur.artist, cur.title, t.artist, t.title) {
            cur.startedAt = t.startedAt ?? cur.startedAt
            cur.endsAt = t.endsAt ?? cur.endsAt
            cur.artwork = cur.artwork ?? t.artwork
            cur.album = cur.album ?? t.album
            track = cur
        } else {
            track = t
            history?.record(t, station: s)
        }
        updateNowPlaying()
    }

    fileprivate func setTrack(_ t: NowTrack, for s: Station) {
        guard station?.id == s.id else { return }
        if let cur = track, Artwork.same(cur.artist, cur.title, t.artist, t.title) { return }
        track = t
        history?.record(t, station: s)
        updateNowPlaying()
        Task {
            guard let info = await Artwork.find(artist: t.artist, title: t.title), station?.id == s.id, var cur = track, cur.title == t.title else { return }
            cur.artwork = info.artwork ?? cur.artwork
            cur.album = cur.album ?? info.album
            track = cur
            updateNowPlaying()
        }
    }

    // MARK: Écran « À l'écoute », télécommande Siri

    private func setupRemote() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in Task { @MainActor in self?.toggle() }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in Task { @MainActor in self?.pause() }; return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in Task { @MainActor in self?.toggle() }; return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.skip(1) }; return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.skip(-1) }; return .success }
    }

    private var artworkCache: (URL, MPMediaItemArtwork)?

    private func updateNowPlaying() {
        guard let s = station else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track?.title ?? s.name,
            MPMediaItemPropertyArtist: track?.artist ?? s.name,
            MPMediaItemPropertyAlbumTitle: track?.album ?? s.name,
            MPNowPlayingInfoPropertyIsLiveStream: true,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        if let url = track?.artwork ?? s.logo {
            if let (u, art) = artworkCache, u == url {
                info[MPMediaItemPropertyArtwork] = art
            } else {
                Task {
                    guard let (data, _) = try? await URLSession.shared.data(from: url), let img = UIImage(data: data) else { return }
                    let art = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
                    artworkCache = (url, art)
                    updateNowPlaying()
                }
            }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
    }
}

// MARK: - Métadonnées du flux (ICY, ID3 HLS)

extension Player: AVPlayerItemMetadataOutputPushDelegate {
    nonisolated func metadataOutput(_ output: AVPlayerItemMetadataOutput, didOutputTimedMetadataGroups groups: [AVTimedMetadataGroup], from track: AVPlayerItemTrack?) {
        let items = groups.flatMap(\.items)
        Task { @MainActor in
            guard let s = self.station else { return }
            var title: String?
            var artist: String?
            for item in items {
                guard let value = try? await item.load(.stringValue), !value.isEmpty else { continue }
                switch item.identifier {
                case AVMetadataIdentifier.icyMetadataStreamTitle?:
                    let parts = value.components(separatedBy: " - ")
                    if parts.count >= 2 {
                        artist = parts[0].trimmingCharacters(in: .whitespaces)
                        title = parts.dropFirst().joined(separator: " - ").trimmingCharacters(in: .whitespaces)
                    } else { title = value }
                case AVMetadataIdentifier.commonIdentifierTitle?, AVMetadataIdentifier.id3MetadataTitleDescription?:
                    title = value
                case AVMetadataIdentifier.commonIdentifierArtist?, AVMetadataIdentifier.id3MetadataLeadPerformer?:
                    artist = value
                default: break
                }
            }
            guard let title, Self.meaningful(title, station: s.name) else { return }
            self.setTrack(NowTrack(title: title, artist: artist, source: "station"), for: s)
        }
    }

    nonisolated static func meaningful(_ v: String, station: String) -> Bool {
        let t = v.trimmingCharacters(in: .whitespaces).lowercased()
        let junk = ["", "-", "unknown", "inconnu", "live", "en direct", "pub", "publicité", "jingle"]
        return !junk.contains(t) && t != station.lowercased() && !t.hasPrefix("http")
    }
}

// MARK: - Radio France (API publique livemeta)

enum RadioFrance {
    static let ids: [String: Int] = ["franceinter": 1, "francemusique": 4, "franceculture": 5, "mouv": 6, "fip": 7, "fiprock": 64, "fipjazz": 65,
                                     "fipgroove": 66, "fipworld": 69, "fipnouveautes": 70, "fipreggae": 71, "fipelectro": 74, "fipmetal": 77, "fippop": 78]

    static func id(for url: URL) -> Int? {
        guard let host = url.host, host.hasSuffix("radiofrance.fr") || host.hasSuffix("fipradio.fr") else { return nil }
        let first = url.pathComponents.dropFirst().first ?? ""
        let slug = first.replacingOccurrences(of: #"[-_.](hifi|midfi|lofi|aac|mp3|m3u8).*$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: "-", with: "").replacingOccurrences(of: "_", with: "").lowercased()
        return ids[slug]
    }

    static func current(_ id: Int) async -> NowTrack? {
        guard let url = URL(string: "https://api.radiofrance.fr/livemeta/pull/\(id)"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let steps = json["steps"] as? [String: [String: Any]] else { return nil }
        let now = Date().timeIntervalSince1970
        let song = steps.values
            .filter { ($0["start"] as? Double ?? 0) <= now && now <= ($0["end"] as? Double ?? 0) && ($0["embedType"] as? String) == "song" }
            .max { ($0["depth"] as? Int ?? 0) < ($1["depth"] as? Int ?? 0) }
        guard let song, let title = song["title"] as? String, !title.isEmpty else { return nil }
        let artist = (song["performers"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (song["authors"] as? String)
        return NowTrack(title: title.prefix(1).uppercased() + title.dropFirst(), artist: artist, album: song["titreAlbum"] as? String,
                        artwork: (song["visual"] as? String).flatMap(URL.init(string:)), source: "Radio France",
                        startedAt: (song["start"] as? Double).map(Date.init(timeIntervalSince1970:)),
                        endsAt: (song["end"] as? Double).map(Date.init(timeIntervalSince1970:)))
    }
}
