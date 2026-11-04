import Foundation
import SwiftUI

/// Adresse de la playlist et du relais personnel.
/// Le relais est lu dans Secrets.plist (non versionné : l'adresse est secrète).
enum AppConfig {
    static let playlistURL = URL(string: "https://raw.githubusercontent.com/gautierbastien-cmyk/radios-fr/main/radios-fr-full.m3u")!

    static let relayURL: URL? = {
        guard let url = Bundle.main.url(forResource: "Secrets", withExtension: "plist"),
              let dict = NSDictionary(contentsOf: url) as? [String: Any],
              let s = dict["relayURL"] as? String, !s.isEmpty else { return nil }
        return URL(string: s.hasSuffix("/") ? String(s.dropLast()) : s)
    }()
}

struct Station: Identifiable, Hashable {
    let id: String
    let name: String
    let url: URL
    let logo: URL?
    let group: String
    let country: String?
}

struct Category: Identifiable {
    var id: String { name }
    let name: String
    var stations: [Station]
}

// MARK: - Lecture M3U

enum M3U {
    /// Attributs « clé="valeur" » (guillemets droits ou typographiques) puis titre après la virgule.
    static func parseExtinf(_ line: String) -> (attrs: [String: String], name: String) {
        var attrs: [String: String] = [:]
        let body = line.drop(while: { $0 != " " && $0 != "," })
        var rest = Substring(body)
        let pattern = try! NSRegularExpression(pattern: #"([\w-]+)=["“]([^"”]*)["”]"#)
        var lastEnd = rest.startIndex
        let ns = String(rest)
        for m in pattern.matches(in: ns, range: NSRange(ns.startIndex..., in: ns)) {
            if let k = Range(m.range(at: 1), in: ns), let v = Range(m.range(at: 2), in: ns) {
                attrs[ns[k].lowercased()] = String(ns[v])
                if let all = Range(m.range, in: ns) { lastEnd = all.upperBound }
            }
        }
        rest = Substring(ns[lastEnd...])
        let name = rest.firstIndex(of: ",").map { String(rest[rest.index(after: $0)...]) } ?? ""
        return (attrs, name.trimmingCharacters(in: .whitespaces))
    }

    static func parse(_ text: String) -> [Station] {
        var stations: [Station] = []
        var seen = Set<String>()
        var pending: (attrs: [String: String], name: String)?
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("#EXTINF") { pending = parseExtinf(line); continue }
            if line.hasPrefix("#") { continue }
            guard let p = pending, let url = URL(string: line), url.scheme?.hasPrefix("http") == true else { pending = nil; continue }
            pending = nil
            guard seen.insert(line).inserted else { continue }
            let name = p.name.isEmpty ? (p.attrs["tvg-name"] ?? url.host ?? line) : p.name
            stations.append(Station(
                id: line,
                name: name.trimmingCharacters(in: CharacterSet(charactersIn: " .-_*~|")),
                url: url,
                logo: p.attrs["tvg-logo"].flatMap { $0.isEmpty ? nil : URL(string: $0) },
                group: cleanGroup(p.attrs["group-title"] ?? ""),
                country: p.attrs["tvg-country"]
            ))
        }
        return stations
    }

    /// « 🎷 Jazz, Soul & Funk » → « Jazz, Soul & Funk »
    static func cleanGroup(_ g: String) -> String {
        let skip: (Unicode.Scalar) -> Bool = { s in
            (s.properties.isEmoji && s.value > 0x7F) || s == "\u{FE0F}" || s == "\u{200D}" || s.properties.isWhitespace
        }
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: g.unicodeScalars.drop(while: skip))
        let cleaned = String(scalars).trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? "Autres" : cleaned
    }
}

// MARK: - Bibliothèque

@MainActor
final class Library: ObservableObject {
    @Published private(set) var stations: [Station] = []
    @Published private(set) var categories: [Category] = []
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published var favorites: [String] = UserDefaults.standard.stringArray(forKey: "favorites") ?? [] {
        didSet { UserDefaults.standard.set(favorites, forKey: "favorites") }
    }
    @Published var recents: [String] = UserDefaults.standard.stringArray(forKey: "recents") ?? [] {
        didSet { UserDefaults.standard.set(Array(recents.prefix(30)), forKey: "recents") }
    }

    private var cacheFile: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("playlist.m3u")
    }

    func station(_ id: String) -> Station? { stations.first { $0.id == id } }
    var favoriteStations: [Station] { favorites.compactMap(station) }
    var recentStations: [Station] { recents.compactMap(station) }

    func isFavorite(_ s: Station) -> Bool { favorites.contains(s.id) }
    func toggleFavorite(_ s: Station) {
        if let i = favorites.firstIndex(of: s.id) { favorites.remove(at: i) } else { favorites.append(s.id) }
    }
    func markPlayed(_ s: Station) {
        recents.removeAll { $0 == s.id }
        recents.insert(s.id, at: 0)
        playedAt[s.id] = Date().timeIntervalSince1970 * 1000
        pendingPlays[s.id] = s.name
        Task { await syncRecents() }
    }

    // MARK: Radios écoutées, identiques sur tous les appareils (la liste du relais fait foi)

    private var playedAt: [String: Double] = UserDefaults.standard.dictionary(forKey: "playedAt") as? [String: Double] ?? [:]
    private var pendingPlays: [String: String] = UserDefaults.standard.dictionary(forKey: "pendingPlays") as? [String: String] ?? [:]
    private var removedPlays: [String] = UserDefaults.standard.stringArray(forKey: "removedPlays") ?? []

    func removeRecent(_ s: Station) {
        recents.removeAll { $0 == s.id }
        pendingPlays[s.id] = nil
        removedPlays.append(s.id)
        Task { await syncRecents() }
    }

    func syncRecents() async {
        guard let relay = AppConfig.relayURL else { return }
        let url = relay.appendingPathComponent("recents")
        if !UserDefaults.standard.bool(forKey: "recentsUploaded") {
            // Première synchronisation : on envoie les écoutes déjà connues ici
            let now = Date().timeIntervalSince1970 * 1000
            for (i, id) in recents.enumerated() where pendingPlays[id] == nil {
                pendingPlays[id] = station(id)?.name ?? ""
                playedAt[id] = playedAt[id] ?? now - Double(i) * 60_000
            }
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let plays = pendingPlays.map { ["stationUrl": $0.key, "stationName": $0.value, "playedAt": playedAt[$0.key] ?? 0] as [String: Any] }
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["plays": plays, "removed": removedPlays])
        guard let (_, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200 else { return }
        pendingPlays = [:]
        removedPlays = []
        UserDefaults.standard.set(true, forKey: "recentsUploaded")
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let ids = Set(stations.map(\.id))
        var list: [String] = []
        for p in json["plays"] as? [[String: Any]] ?? [] {
            guard let u = p["stationUrl"] as? String, ids.contains(u) else { continue }
            playedAt[u] = p["playedAt"] as? Double
            list.append(u)
        }
        recents = list
        UserDefaults.standard.set(playedAt, forKey: "playedAt")
        UserDefaults.standard.set(pendingPlays, forKey: "pendingPlays")
        UserDefaults.standard.set(removedPlays, forKey: "removedPlays")
    }

    /// Cache local d'abord (démarrage instantané), puis actualisation depuis GitHub.
    func load() async {
        if let cached = try? String(contentsOf: cacheFile, encoding: .utf8) { apply(cached) }
        loading = stations.isEmpty
        defer { loading = false }
        do {
            let (data, _) = try await URLSession.shared.data(from: AppConfig.playlistURL)
            let text = String(decoding: data, as: UTF8.self)
            guard text.contains("#EXTINF") else { throw URLError(.cannotParseResponse) }
            try? data.write(to: cacheFile)
            apply(text)
            error = nil
        } catch {
            if stations.isEmpty { self.error = "Impossible de charger la playlist. Vérifiez la connexion." }
        }
    }

    private func apply(_ text: String) {
        let list = M3U.parse(text)
        stations = list
        var order: [String] = []
        var byGroup: [String: [Station]] = [:]
        for s in list {
            if byGroup[s.group] == nil { order.append(s.group) }
            byGroup[s.group, default: []].append(s)
        }
        categories = order.map { Category(name: $0, stations: byGroup[$0]!) }
    }

    func search(_ q: String) -> [Station] {
        let words = q.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current).split(separator: " ")
        guard !words.isEmpty else { return [] }
        return stations.filter { s in
            let hay = (s.name + " " + s.group).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            return words.allSatisfy { hay.contains($0) }
        }
    }
}

extension Locale {
    static let fr = Locale(identifier: "fr_FR")
    func countryName(_ code: String?) -> String? {
        guard let code else { return nil }
        return localizedString(forRegionCode: code)
    }
}
