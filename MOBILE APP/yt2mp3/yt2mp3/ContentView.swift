import SwiftUI
import UniformTypeIdentifiers

// MARK: - URL validation (unchanged)
fileprivate func isValidYouTubeURL(_ s: String) -> Bool {
    var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty else { return false }
    if t.hasPrefix("//") { t = "https:" + t }
    if t.lowercased().hasPrefix("www.") { t = "https://" + t }
    if !t.lowercased().hasPrefix("http") { t = "https://" + t }
    guard var comps = URLComponents(string: t), var host = comps.host?.lowercased() else { return false }
    if host.hasPrefix("m.") { host.removeFirst(2) }
    comps.host = host
    if host.hasSuffix("youtu.be") {
        let id = comps.path.split(separator: "/").first.map(String.init) ?? ""
        return id.count >= 6
    }
    guard host.contains("youtube.com") else { return false }
    if comps.path.hasPrefix("/shorts/") {
        let id = String(comps.path.dropFirst("/shorts/".count))
        return id.count >= 6
    }
    if let v = comps.queryItems?.first(where: { $0.name == "v" })?.value, v.count >= 6 { return true }
    return false
}

// MARK: - Safe filename for iOS filesystem
fileprivate func safeFilename(_ name: String) -> String {
    let illegal = CharacterSet(charactersIn: "/:\\?%*|\"<>")
    return name.components(separatedBy: illegal)
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

struct ContentView: View {
    // Auth/UI state
    @State private var user = ""
    @State private var pass = ""
    @State private var token: String?
    @State private var username: String = ""

    // Convert
    @State private var yt = ""
    @State private var lastFileId: String?
    @State private var lastFilename: String?

    // Downloads
    @State private var downloads: [VideoItem] = []
    @State private var loadingDownloads = false

    // Messages
    @State private var statusText = ""
    @State private var okText = ""

    // Optional Files picker
    @State private var showFileMover = false
    @State private var fileToMove: URL?

    // Admin alert
    @State private var showAdminAlert = false

    var body: some View {
        ZStack {
            AppBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {

                    // Header
                    Text("YouTube to MP3")
                        .font(.system(size: 36, weight: .heavy, design: .rounded))
                        .foregroundColor(.textPrimary)
                        .padding(.top, 8)

                    // Toolbar (whoami + logout)
                    if let token {
                        HStack {
                            Text("Logged in as \(username)")
                                .foregroundColor(.textMuted).font(.subheadline)
                            Spacer()
                            Button("Logout") {
                                tokenOut()
                            }
                            .buttonStyle(DangerButton())
                            .frame(maxWidth: 140)
                        }
                    }

                    // LOGIN CARD
                    if token == nil {
                        Card {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Username").font(.footnote).foregroundColor(.textMuted)
                                TextField("", text: $user)
                                    .darkField()
                                    .textInputAutocapitalization(.never)

                                Text("Password").font(.footnote).foregroundColor(.textMuted)
                                SecureField("", text: $pass)
                                    .darkField()

                                Button("Log In") {
                                    Task {
                                        do {
                                            let res = try await APIClient.shared.login(username: user, password: pass)

                                            if res.is_admin {
                                                // Block admins on mobile
                                                user = ""; pass = ""
                                                statusText = ""
                                                okText = ""
                                                showAdminAlert = true
                                                return
                                            }

                                            token = res.token
                                            username = res.user
                                            user = ""; pass = ""
                                            statusText = ""; okText = ""
                                            await refreshDownloads()
                                        } catch {
                                            pass = ""
                                            statusText = error.localizedDescription
                                        }
                                    }
                                }
                                .buttonStyle(PrimaryButton())
                            }
                        }
                        // show error on login card
                        if !statusText.isEmpty {
                            Text(statusText)
                                .foregroundColor(.red)
                                .font(.footnote)
                        }
                    }

                    // CONVERTER CARD
                    if token != nil {
                        Card {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("YouTube URL").font(.headline).foregroundColor(.textPrimary)
                                TextField("https://www.youtube.com/watch?v=...", text: $yt)
                                    .darkField()
                                    .keyboardType(.URL)

                                let canConvert = isValidYouTubeURL(yt)

                                Button("Convert to MP3") {
                                    Task {
                                        guard let token else { statusText = "Not logged in"; return }
                                        do {
                                            let res = try await APIClient.shared.startDownload(
                                                youtubeURL: yt.trimmingCharacters(in: .whitespacesAndNewlines),
                                                token: token
                                            )
                                            lastFileId = res.file_id
                                            lastFilename = res.filename
                                            yt = ""
                                            statusText = ""
                                            okText = "Link converted."
                                            await refreshDownloads()
                                        } catch {
                                            statusText = error.localizedDescription
                                        }
                                    }
                                }
                                .buttonStyle(PrimaryButton())
                                .disabled(!canConvert)
                                .opacity(canConvert ? 1 : 0.55)

                                HStack(spacing: 12) {
                                    Button("Check Status") {
                                        Task {
                                            guard let id = lastFileId, let token else { statusText = "No file ID"; return }
                                            do {
                                                let ready = try await APIClient.shared.checkStatus(fileId: id, token: token)
                                                okText = ready ? "The link is ready for the download." : "Still processing…"
                                                await refreshDownloads()
                                            } catch { statusText = error.localizedDescription }
                                        }
                                    }
                                    .buttonStyle(OutlineButton())
                                    .disabled(lastFileId == nil)
                                    .opacity(lastFileId == nil ? 0.55 : 1)

                                    Button("Download") {
                                        Task {
                                            guard let id = lastFileId, let token else { statusText = "Nothing to download yet."; return }
                                            do {
                                                let f = try await APIClient.shared.downloadFile(fileId: id, token: token)
                                                let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
                                                let clean = safeFilename(f.suggestedName)
                                                let dest = docs.appendingPathComponent(clean)
                                                try? FileManager.default.removeItem(at: dest)
                                                try FileManager.default.moveItem(at: f.localURL, to: dest)

                                                let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
                                                    ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
                                                    ?? "App"
                                                okText = "Saved to: On My iPhone ▸ \(appName) ▸ \(clean)"
                                            } catch { statusText = error.localizedDescription }
                                        }
                                    }
                                    .buttonStyle(PrimaryButton())
                                    .disabled(lastFileId == nil)
                                    .opacity(lastFileId == nil ? 0.55 : 1)

                                    Button("Delete") {
                                        Task {
                                            guard let id = lastFileId, let token else { return }
                                            do {
                                                try await APIClient.shared.delete(fileId: id, token: token)
                                                lastFileId = nil; lastFilename = nil
                                                okText = "Deleted."
                                                await refreshDownloads()
                                            } catch { statusText = error.localizedDescription }
                                        }
                                    }
                                    .buttonStyle(OutlineButton())
                                }

                                if !statusText.isEmpty {
                                    Text(statusText).foregroundColor(.red).font(.footnote).padding(.top, 4)
                                }
                                if !okText.isEmpty {
                                    Text(okText).foregroundColor(.green).font(.footnote).padding(.top, 2)
                                }
                            }
                        }
                    }

                    // MY DOWNLOADS
                    if token != nil {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("My Downloads")
                                    .foregroundColor(.textPrimary)
                                    .font(.headline)

                                Spacer()

                                // Small circular refresh button with arrow icon
                                Button {
                                    Task { await refreshDownloads() }
                                } label: {
                                    Image(systemName: loadingDownloads ? "arrow.clockwise.circle.fill" : "arrow.clockwise")
                                        .font(.system(size: 16, weight: .semibold))
                                        .padding(10)
                                        .accessibilityLabel("Refresh")
                                }
                                .buttonStyle(.plain)
                                .background(Color(white: 0.12))
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Color.stroke, lineWidth: 1))
                                .opacity(loadingDownloads ? 0.6 : 1.0)
                            }
                            .padding(.horizontal, 2)

                            if loadingDownloads { ProgressView().tint(.blueEnd) }

                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                                ForEach(downloads) { item in
                                    DownloadCard(
                                        item: item,
                                        isYou: (item.owner_username ?? username) == username,
                                        onStatus: { id in
                                            Task {
                                                guard let token else { return }
                                                do {
                                                    let r = try await APIClient.shared.checkStatus(fileId: id, token: token)
                                                    okText = r ? "Ready" : "Still processing…"
                                                    await refreshDownloads()
                                                } catch { statusText = error.localizedDescription }
                                            }
                                        },
                                        onDownload: { id in
                                            Task {
                                                guard let token else { return }
                                                do {
                                                    let f = try await APIClient.shared.downloadFile(fileId: id, token: token)
                                                    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
                                                    let clean = safeFilename(f.suggestedName)
                                                    let dest = docs.appendingPathComponent(clean)
                                                    try? FileManager.default.removeItem(at: dest)
                                                    try FileManager.default.moveItem(at: f.localURL, to: dest)

                                                    let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
                                                        ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
                                                        ?? "App"
                                                    okText = "Saved to: On My iPhone ▸ \(appName) ▸ \(clean)"
                                                } catch { statusText = error.localizedDescription }
                                            }
                                        },
                                        onDelete: { id in
                                            Task {
                                                guard let token else { return }
                                                do {
                                                    try await APIClient.shared.delete(fileId: id, token: token)
                                                    okText = "Deleted."
                                                    await refreshDownloads()
                                                } catch { statusText = error.localizedDescription }
                                            }
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .foregroundColor(.textPrimary)
            }
        }
        .onAppear {
            UINavigationBar.appearance().largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        }
        .alert("Admin must use the PC to log in", isPresented: $showAdminAlert) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Please use the web app on your PC to log in as admin.")
        }

        // Footer only when NOT logged in
        .safeAreaInset(edge: .bottom) {
            Group {
                if token == nil {
                    VStack(spacing: 4) {
                        Text("To create a user account please use the PC\n\n")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.textPrimary)
                        Text("App made by adm.ar")
                            .font(.footnote)
                            .foregroundColor(.textMuted.opacity(0.8))
                    }
                    .padding(.vertical, 10)
                    .padding(.horizontal, 16)
                    .background(Color.clear)   // no box
                } else {
                    EmptyView()                // no footer while logged in
                }
            }
        }
    }

    // MARK: - Data
    @MainActor
    private func refreshDownloads() async {
        guard let token else { return }
        loadingDownloads = true
        defer { loadingDownloads = false }
        do {
            downloads = try await APIClient.shared.myDownloads(token: token)
        } catch {
            statusText = error.localizedDescription
            print("my_downloads failed:", error)
        }
    }

    private func tokenOut() {
        token = nil
        username = ""
        downloads = []
        okText = ""
        statusText = ""
    }
}

// MARK: - Download Card
struct DownloadCard: View {
    let item: VideoItem
    let isYou: Bool
    let onStatus: (String) -> Void
    let onDownload: (String) -> Void
    let onDelete: (String) -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text(item.filename ?? "(processing)")
                    .font(.body.weight(.semibold))
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                let tsDate = item.timestamp.flatMap { ISO8601DateFormatter().date(from: $0) }
                Text("\(tsDate.map { DateFormatter.localizedString(from: $0, dateStyle: .short, timeStyle: .short) } ?? (item.timestamp ?? "")) • Status: \(item.status)\(ownerText)")
                    .font(.caption)
                    .foregroundColor(.textMuted)

                HStack(spacing: 8) {
                    Button("Status") { onStatus(item.id) }.buttonStyle(OutlineButton())

                    Button("Download") { onDownload(item.id) }
                        .buttonStyle(PrimaryButton())
                        .disabled(item.status != "ready")
                        .opacity(item.status == "ready" ? 1 : 0.55)

                    Button("Delete") { onDelete(item.id) }
                        .buttonStyle(OutlineButton())
                }
            }
        }
    }

    private var ownerText: String {
        if let o = item.owner_username, !o.isEmpty, !isYou { return " • by \(o)" }
        return ""
    }
}
