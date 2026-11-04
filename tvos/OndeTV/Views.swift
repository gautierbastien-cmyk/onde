import SwiftUI

@main
struct OndeTVApp: App {
    @StateObject private var library = Library()
    @StateObject private var player = Player()
    @StateObject private var history = History()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(player)
                .environmentObject(history)
                .task {
                    player.library = library
                    player.history = history
                    history.library = library
                    await library.load()
                }
                .preferredColorScheme(.dark)
        }
    }
}

// MARK: - Palette

enum Theme {
    static let accent = Color(red: 1, green: 0.42, blue: 0.29)
    static let gradient = LinearGradient(colors: [Color(red: 1, green: 0.54, blue: 0.3), Color(red: 1, green: 0.24, blue: 0.43)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing)
    static func tint(for name: String) -> Color {
        let h = Double(name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) % 360 }) / 360
        return Color(hue: h, saturation: 0.55, brightness: 0.42)
    }
}

// MARK: - Racine

struct RootView: View {
    @EnvironmentObject var library: Library
    @EnvironmentObject var player: Player
    @State private var showPlayer = false

    var body: some View {
        TabView {
            HomeView(showPlayer: $showPlayer).tabItem { Text("Accueil") }
            FavoritesView(showPlayer: $showPlayer).tabItem { Text("Favoris") }
            HistoryView().tabItem { Text("Historique") }
            SearchView(showPlayer: $showPlayer).tabItem { Image(systemName: "magnifyingglass") }
        }
        .fullScreenCover(isPresented: $showPlayer) { NowPlayingView() }
        .overlay {
            if library.loading {
                ProgressView("Chargement de vos radios…").font(.title3)
            } else if let e = library.error {
                Text(e).font(.title3).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Visuels

struct LogoTile: View {
    let url: URL?
    let name: String
    var size: CGFloat = 260

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(white: 0.16), Color(white: 0.08)], startPoint: .top, endPoint: .bottom)
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img): img.resizable().scaledToFit().padding(size * 0.13)
                default: monogram
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.08, style: .continuous))
    }

    private var monogram: some View {
        ZStack {
            Theme.tint(for: name)
            Text(initials).font(.system(size: size * 0.26, weight: .bold, design: .rounded)).foregroundStyle(.white.opacity(0.9))
        }
    }

    private var initials: String {
        let words = name.split(separator: " ").filter { !["radio", "la", "le", "the", "fm"].contains($0.lowercased()) }
        let w = words.isEmpty ? name.split(separator: " ") : words
        return String((w.first?.prefix(1) ?? "") + (w.dropFirst().first?.prefix(1) ?? "")).uppercased()
    }
}

struct StationCard: View {
    @EnvironmentObject var library: Library
    @EnvironmentObject var player: Player
    let station: Station
    @Binding var showPlayer: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                player.play(station)
                showPlayer = true
            } label: {
                LogoTile(url: station.logo, name: station.name)
                    .overlay(alignment: .topTrailing) {
                        if library.isFavorite(station) {
                            Image(systemName: "heart.fill").font(.system(size: 22)).foregroundStyle(Theme.accent)
                                .padding(12).background(.ultraThinMaterial, in: Circle()).padding(10)
                        }
                    }
                    .overlay(alignment: .bottomTrailing) {
                        if player.station?.id == station.id && player.isPlaying {
                            Image(systemName: "waveform").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.accent)
                                .symbolEffect(.variableColor.iterative).padding(12).background(.ultraThinMaterial, in: Circle()).padding(10)
                        }
                    }
            }
            .buttonStyle(.card)
            .contextMenu {
                Button(library.isFavorite(station) ? "Retirer des favoris" : "Ajouter aux favoris") { library.toggleFavorite(station) }
                if library.recents.contains(station.id) {
                    Button("Retirer des récemment écoutées", role: .destructive) { library.removeRecent(station) }
                }
            }
            Text(station.name).font(.callout.weight(.medium)).lineLimit(1).frame(width: 260, alignment: .leading)
        }
    }
}

struct StationRow: View {
    let title: String
    let stations: [Station]
    @Binding var showPlayer: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(title).font(.title3.weight(.bold)).padding(.horizontal, 80)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 44) {
                    ForEach(stations) { StationCard(station: $0, showPlayer: $showPlayer) }
                }
                .padding(.horizontal, 80)
                .padding(.vertical, 30)
            }
            .scrollClipDisabled()
        }
    }
}

// MARK: - Accueil : en cours, favoris, récentes, puis catégories dans l'ordre de la playlist

struct HomeView: View {
    @EnvironmentObject var library: Library
    @EnvironmentObject var player: Player
    @Binding var showPlayer: Bool

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 50) {
                if let s = player.station {
                    NowPlayingBanner(station: s, showPlayer: $showPlayer).padding(.horizontal, 80)
                }
                if !library.favoriteStations.isEmpty {
                    StationRow(title: "Favoris", stations: library.favoriteStations, showPlayer: $showPlayer)
                }
                if !library.recentStations.isEmpty {
                    StationRow(title: "Récemment écoutées", stations: Array(library.recentStations.prefix(20)), showPlayer: $showPlayer)
                }
                ForEach(library.categories) { c in
                    StationRow(title: "\(c.name)  ·  \(c.stations.count)", stations: c.stations, showPlayer: $showPlayer)
                }
            }
            .padding(.vertical, 40)
        }
    }
}

struct NowPlayingBanner: View {
    @EnvironmentObject var player: Player
    let station: Station
    @Binding var showPlayer: Bool

    var body: some View {
        Button { showPlayer = true } label: {
            HStack(spacing: 40) {
                LogoTile(url: player.track?.artwork ?? station.logo, name: station.name, size: 200)
                VStack(alignment: .leading, spacing: 10) {
                    Text("EN COURS").font(.caption.weight(.heavy)).foregroundStyle(Theme.accent)
                    Text(player.track?.title ?? station.name).font(.title2.weight(.bold)).lineLimit(1)
                    Text(player.track?.artist ?? station.name).font(.title3).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Image(systemName: player.isPlaying ? "waveform" : "play.fill").font(.system(size: 50)).foregroundStyle(Theme.accent)
                    .symbolEffect(.variableColor.iterative, isActive: player.isPlaying)
            }
            .padding(30)
            .frame(maxWidth: .infinity)
            .background(LinearGradient(colors: [Theme.tint(for: station.name).opacity(0.9), Color(white: 0.1)], startPoint: .leading, endPoint: .trailing))
        }
        .buttonStyle(.card)
    }
}

// MARK: - Favoris et recherche

struct Grid: View {
    let stations: [Station]
    @Binding var showPlayer: Bool
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(260), spacing: 44), count: 6), spacing: 50) {
            ForEach(stations) { StationCard(station: $0, showPlayer: $showPlayer) }
        }
        .padding(60)
    }
}

struct FavoritesView: View {
    @EnvironmentObject var library: Library
    @Binding var showPlayer: Bool
    var body: some View {
        ScrollView {
            if library.favoriteStations.isEmpty {
                VStack(spacing: 20) {
                    Image(systemName: "heart").font(.system(size: 80)).foregroundStyle(.secondary)
                    Text("Aucun favori").font(.title2.weight(.bold))
                    Text("Maintenez le bouton central sur une station pour l'ajouter aux favoris.").foregroundStyle(.secondary)
                }
                .padding(.top, 200)
            } else {
                Grid(stations: library.favoriteStations, showPlayer: $showPlayer)
            }
        }
    }
}

struct SearchView: View {
    @EnvironmentObject var library: Library
    @Binding var showPlayer: Bool
    @State private var query = ""
    var body: some View {
        ScrollView { Grid(stations: Array(library.search(query).prefix(120)), showPlayer: $showPlayer) }
            .searchable(text: $query, prompt: "Stations, catégories")
    }
}

// MARK: - Lecteur plein écran

struct NowPlayingView: View {
    @EnvironmentObject var player: Player
    @EnvironmentObject var library: Library

    var body: some View {
        let s = player.station
        let art = player.track?.artwork ?? s?.logo
        ZStack {
            Color.black
            AsyncImage(url: art) { img in img.resizable().scaledToFill() } placeholder: { Theme.tint(for: s?.name ?? "") }
                .blur(radius: 80).opacity(0.55).ignoresSafeArea()
            LinearGradient(colors: [.black.opacity(0.2), .black.opacity(0.75)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()

            HStack(spacing: 80) {
                Group {
                    if let artwork = player.track?.artwork {
                        AsyncImage(url: artwork) { img in img.resizable().scaledToFill() } placeholder: { Color(white: 0.15) }
                            .frame(width: 620, height: 620)
                            .clipShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
                    } else {
                        LogoTile(url: s?.logo, name: s?.name ?? "", size: 620)
                    }
                }
                .shadow(color: .black.opacity(0.5), radius: 40, y: 20)
                .scaleEffect(player.isPlaying ? 1 : 0.9)
                .animation(.spring(duration: 0.6), value: player.isPlaying)

                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        Circle().fill(player.isPlaying ? .red : .gray).frame(width: 12, height: 12)
                        Text("EN DIRECT  ·  \(s?.name ?? "")").font(.callout.weight(.heavy)).foregroundStyle(.white.opacity(0.75))
                    }
                    Text(player.track?.title ?? s?.name ?? "").font(.system(size: 64, weight: .bold)).lineLimit(2)
                    if let artist = player.track?.artist { Text(artist).font(.title2).foregroundStyle(.white.opacity(0.75)) }
                    if let album = player.track?.album { Text(album).font(.title3).foregroundStyle(.white.opacity(0.5)) }

                    progress.padding(.top, 20)

                    HStack(spacing: 40) {
                        control("backward.fill") { player.skip(-1) }
                        control(player.isPlaying ? "pause.fill" : "play.fill", big: true) { player.toggle() }
                        control("forward.fill") { player.skip(1) }
                        if let s {
                            control(library.isFavorite(s) ? "heart.fill" : "heart") { library.toggleFavorite(s) }
                        }
                        if AppConfig.relayURL != nil {
                            Button { Task { await player.identify() } } label: {
                                Label(player.recognizing ? "Écoute…" : "Shazam", systemImage: "waveform")
                            }
                            .disabled(player.recognizing || !player.isPlaying)
                        }
                    }
                    .padding(.top, 30)

                    Text(status).font(.callout).foregroundStyle(.white.opacity(0.55)).padding(.top, 10)
                }
                .frame(maxWidth: 900, alignment: .leading)
            }
            .padding(100)
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.5), value: player.track)
    }

    private var status: String {
        switch player.state {
        case .loading: return "Connexion…"
        case .failed(let m): return m
        case .paused: return "En pause"
        default:
            if player.recognizing { return "Identification Shazam en cours…" }
            if let t = player.track { return t.source == "Shazam" ? "Identifié par Shazam" : "Titre annoncé par la station" }
            return "En lecture"
        }
    }

    @ViewBuilder private var progress: some View {
        if let start = player.track?.startedAt, let end = player.track?.endsAt {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let total = end.timeIntervalSince(start), done = min(total, max(0, ctx.date.timeIntervalSince(start)))
                VStack(alignment: .leading, spacing: 8) {
                    ProgressView(value: done, total: max(total, 1)).tint(.white)
                    Text("\(clock(done)) / \(clock(total))").font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.6))
                }
                .frame(width: 700)
            }
        }
    }

    private func clock(_ t: TimeInterval) -> String { String(format: "%d:%02d", Int(t) / 60, Int(t) % 60) }

    private func control(_ icon: String, big: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).font(.system(size: big ? 44 : 30)).frame(width: big ? 90 : 60, height: big ? 90 : 60) }
    }
}
