import Foundation

/// Pochette, album et durée d'un morceau : Spotify via le relais, sinon iTunes Search.
/// Un résultat n'est retenu que si l'artiste et le titre correspondent.
enum Artwork {
    struct Info {
        var artwork: URL?
        var album: String?
        var duration: TimeInterval?
    }

    private static var cache: [String: Info?] = [:]

    static func simplify(_ s: String) -> String {
        var t = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        t = t.replacingOccurrences(of: #"\s*[\(\[].*?[\)\]]\s*"#, with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: #"\b(feat|ft|featuring|avec|with)\b.*$"#, with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: #"[^\p{L}\p{N}]+"#, with: " ", options: .regularExpression)
        return t.replacingOccurrences(of: #"\bthe\b"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }

    static func close(_ a: String, _ b: String) -> Bool {
        let x = simplify(a), y = simplify(b)
        return !x.isEmpty && !y.isEmpty && (x == y || x.contains(y) || y.contains(x))
    }

    static func artistMatches(_ candidates: [String], _ wanted: String) -> Bool {
        let parts = wanted.components(separatedBy: CharacterSet(charactersIn: "&,")).map { $0.trimmingCharacters(in: .whitespaces) }
        return candidates.contains { c in close(c, wanted) || parts.contains { close(c, $0) } }
    }

    static func same(_ a1: String?, _ t1: String, _ a2: String?, _ t2: String) -> Bool {
        guard close(t1, t2) else { return false }
        guard let a1, let a2 else { return true }
        return artistMatches([a1], a2) || artistMatches([a2], a1)
    }

    static func find(artist: String?, title: String) async -> Info? {
        guard let artist, !title.isEmpty else { return nil }
        let key = simplify(artist) + "|" + simplify(title)
        if let hit = cache[key] { return hit }
        var info: Info?
        if let relay = AppConfig.relayURL { info = await spotify(relay, artist, title) }
        if info == nil { info = await itunes(artist, title) }
        cache[key] = info
        return info
    }

    private static func spotify(_ relay: URL, _ artist: String, _ title: String) async -> Info? {
        var c = URLComponents(url: relay.appendingPathComponent("cover"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "artist", value: artist), URLQueryItem(name: "title", value: title)]
        guard let url = c.url, let (data, res) = try? await URLSession.shared.data(from: url),
              (res as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = json["results"] as? [[String: Any]] else { return nil }
        let hit = results.first { r in
            artistMatches(r["artists"] as? [String] ?? [], artist) && close(r["title"] as? String ?? "", title)
        }
        guard let hit else { return nil }
        return Info(artwork: (hit["image"] as? String).flatMap(URL.init(string:)), album: hit["album"] as? String,
                    duration: (hit["duration_ms"] as? Double).map { $0 / 1000 })
    }

    private static func itunes(_ artist: String, _ title: String) async -> Info? {
        var c = URLComponents(string: "https://itunes.apple.com/search")!
        c.queryItems = [URLQueryItem(name: "term", value: "\(simplify(artist)) \(simplify(title))"),
                        URLQueryItem(name: "media", value: "music"), URLQueryItem(name: "entity", value: "song"),
                        URLQueryItem(name: "limit", value: "10")]
        guard let url = c.url, let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = json["results"] as? [[String: Any]] else { return nil }
        let hit = results.first { r in
            artistMatches([r["artistName"] as? String ?? ""], artist) && close(r["trackName"] as? String ?? "", title)
        }
        guard let hit else { return nil }
        let art = (hit["artworkUrl100"] as? String)?.replacingOccurrences(of: "100x100bb", with: "1000x1000bb")
        return Info(artwork: art.flatMap(URL.init(string:)), album: hit["collectionName"] as? String,
                    duration: (hit["trackTimeMillis"] as? Double).map { $0 / 1000 })
    }
}
