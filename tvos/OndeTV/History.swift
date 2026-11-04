import SwiftUI

/// Un titre de l'historique musical, au même format que l'app web et le relais.
struct HistTrack: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var artist: String?
    var album: String?
    var artworkUrl: String?
    var stationName: String?
    var stationUrl: String?
    var source: String?
    var identifiedAt: Double // ms
    var timeZone: String?
    var spotifyUrl: String?
    var deleted: Bool?

    var date: Date { Date(timeIntervalSince1970: identifiedAt / 1000) }
}

/// Historique partagé entre l'Apple TV, l'iPhone et l'iPad via le relais personnel.
@MainActor
final class History: ObservableObject {
    @Published private(set) var tracks: [HistTrack] = []
    private var pending = Set<String>(UserDefaults.standard.stringArray(forKey: "historyPending") ?? [])
    private var deleted = Set<String>(UserDefaults.standard.stringArray(forKey: "historyDeleted") ?? [])
    private var since = UserDefaults.standard.double(forKey: "historySince")
    private var file: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("historique.json") }

    init() {
        if let data = try? Data(contentsOf: file), let list = try? JSONDecoder().decode([HistTrack].self, from: data) { tracks = list }
        Task {
            while true {
                await sync()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    func record(_ t: NowTrack, station: Station) {
        // Même morceau, même radio, peu avant : déjà enregistré
        if let last = tracks.first, last.stationUrl == station.url.absoluteString,
           Artwork.same(last.artist, last.title, t.artist, t.title), Date().timeIntervalSince(last.date) < 15 * 60 { return }
        let now = Date().timeIntervalSince1970 * 1000
        let h = HistTrack(id: "tv_\(Int(now))_\(abs(t.title.hashValue % 100_000))", title: t.title, artist: t.artist, album: t.album,
                          artworkUrl: t.artwork?.absoluteString, stationName: station.name, stationUrl: station.url.absoluteString,
                          source: t.source == "Shazam" ? "recognition:shazam" : t.source == "Radio France" ? "broadcaster" : "icy",
                          identifiedAt: now, timeZone: TimeZone.current.identifier)
        tracks.insert(h, at: 0)
        pending.insert(h.id)
        save()
        Task { await sync() }
    }

    func delete(_ t: HistTrack) {
        tracks.removeAll { $0.id == t.id }
        pending.remove(t.id)
        deleted.insert(t.id)
        save()
        Task { await sync() }
    }

    func sync() async {
        guard let relay = AppConfig.relayURL else { return }
        let url = relay.appendingPathComponent("history")
        // 1. Envoi
        let toSend = tracks.filter { pending.contains($0.id) }
        if !toSend.isEmpty || !deleted.isEmpty {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: [
                "tracks": (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(toSend))) ?? [],
                "deleted": Array(deleted),
            ])
            if let (_, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200 {
                toSend.forEach { pending.remove($0.id) }
                deleted.removeAll()
            }
        }
        // 2. Réception
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "since", value: String(Int(since)))]
        struct Pull: Decodable { let tracks: [HistTrack]; let now: Double }
        guard let (data, _) = try? await URLSession.shared.data(from: c.url!),
              let pull = try? JSONDecoder().decode(Pull.self, from: data) else { save(); return }
        for r in pull.tracks {
            if r.deleted == true { tracks.removeAll { $0.id == r.id }; continue }
            if tracks.contains(where: { $0.id == r.id }) { continue }
            let dup = tracks.contains { $0.stationName == r.stationName && abs($0.identifiedAt - r.identifiedAt) < 15 * 60_000 && Artwork.same($0.artist, $0.title, r.artist, r.title) }
            if !dup { tracks.append(r) }
        }
        tracks.sort { $0.identifiedAt > $1.identifiedAt }
        since = pull.now - 5000
        save()
    }

    private func save() {
        try? JSONEncoder().encode(Array(tracks.prefix(3000))).write(to: file)
        UserDefaults.standard.set(Array(pending), forKey: "historyPending")
        UserDefaults.standard.set(Array(deleted), forKey: "historyDeleted")
        UserDefaults.standard.set(since, forKey: "historySince")
    }
}

// MARK: - Écran

struct HistoryView: View {
    @EnvironmentObject var history: History

    private var days: [(String, [HistTrack])] {
        let f = DateFormatter()
        f.locale = Locale(identifier: "fr_FR")
        f.dateFormat = "EEEE d MMMM"
        var out: [(String, [HistTrack])] = []
        for t in history.tracks {
            let label = Calendar.current.isDateInToday(t.date) ? "Aujourd'hui" : Calendar.current.isDateInYesterday(t.date) ? "Hier" : f.string(from: t.date).capitalized
            if out.last?.0 == label { out[out.count - 1].1.append(t) } else { out.append((label, [t])) }
        }
        return out
    }

    var body: some View {
        ScrollView {
            if history.tracks.isEmpty {
                VStack(spacing: 20) {
                    Image(systemName: "music.note.list").font(.system(size: 80)).foregroundStyle(.secondary)
                    Text("Aucun titre pour l'instant").font(.title2.weight(.bold))
                    Text("Les morceaux identifiés sur l'Apple TV, l'iPhone et l'iPad apparaissent ici.").foregroundStyle(.secondary)
                }
                .padding(.top, 200)
            } else {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(days, id: \.0) { day in
                        Text(day.0).font(.headline).foregroundStyle(.secondary).padding(.top, 30)
                        ForEach(day.1) { t in HistoryRow(track: t) }
                    }
                }
                .padding(.horizontal, 120)
                .padding(.vertical, 40)
            }
        }
        .task { await history.sync() }
    }
}

struct HistoryRow: View {
    @EnvironmentObject var history: History
    let track: HistTrack

    var body: some View {
        Button {} label: {
            HStack(spacing: 30) {
                AsyncImage(url: track.artworkUrl.flatMap(URL.init(string:))) { img in img.resizable().scaledToFill() } placeholder: {
                    ZStack { Theme.tint(for: track.artist ?? track.title); Image(systemName: "music.note").font(.title2) }
                }
                .frame(width: 110, height: 110)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 6) {
                    Text(track.title).font(.title3.weight(.semibold)).lineLimit(1)
                    Text([track.artist, track.stationName].compactMap { $0 }.joined(separator: "  ·  ")).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text(track.date, style: .time).foregroundStyle(.secondary).monospacedDigit()
            }
            .padding(16)
        }
        .buttonStyle(.card)
        .contextMenu { Button("Supprimer de l'historique", role: .destructive) { history.delete(track) } }
    }
}
