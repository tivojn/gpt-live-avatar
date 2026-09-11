import CryptoKit
import Foundation

/// Avatar models by texture tier. The app bundles Tia at 1K; 2K and 4K
/// models, and every other avatar, are downloaded on demand from the GitHub
/// release with progress, verified, and kept in Application Support.
@MainActor
final class AssetStore: ObservableObject {
    static let shared = AssetStore()
    static let releaseBase = URL(string: "https://github.com/tivojn/gpt-live-avatar-assets/releases/download/assets-v1/")!
    static let tiers = ["1k", "2k", "4k"]
    static let tierLabels = ["1k": "1K textures (resource friendly)", "2k": "2K textures (balanced)", "4k": "4K textures (best quality)"]

    struct Remote: Codable { let file: String; let bytes: Int; let sha256: String? }
    struct Entry: Codable { let name: String; let bundledIOS: Bool?; let ios: [String: Remote]? }
    struct Index: Codable { var version: Int; var avatars: [String: Entry] }
    struct Progress: Equatable { let slug: String; let tier: String; var fraction: Double; var phase: String; var error: String }
    struct AvatarChoice: Identifiable, Equatable { let slug: String; let name: String; let bundled: Bool; let installed: Bool; var id: String { slug } }

    @Published private(set) var index: Index
    @Published private(set) var progress: Progress?
    @Published private(set) var revision = 0
    @Published private(set) var indexStatus = ""
    /// Called after a download or removal changes which models are available.
    var onChange: (() -> Void)?

    private let downloader = Downloader()
    private let root: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("GPTLiveAvatar/avatars", isDirectory: true)
    }()

    private init() {
        var loaded: Index?
        for url in [root.appendingPathComponent("index.json"), Bundle.main.url(forResource: "assets-index", withExtension: "json")].compactMap({ $0 }) {
            if let data = try? Data(contentsOf: url), let parsed = try? JSONDecoder().decode(Index.self, from: data) { loaded = parsed; break }
        }
        index = loaded ?? Index(version: 1, avatars: ["tia": Entry(name: "Tia", bundledIOS: true, ios: nil)])
        if index.avatars["tia"] == nil { index.avatars["tia"] = Entry(name: "Tia", bundledIOS: true, ios: nil) }
    }

    // MARK: - what is available

    var avatars: [AvatarChoice] {
        index.avatars.map { slug, entry in
            AvatarChoice(slug: slug, name: entry.name, bundled: entry.bundledIOS == true, installed: Self.tiers.contains { isPresent(slug: slug, tier: $0) })
        }.sorted { ($0.bundled ? 0 : 1, $0.name) < ($1.bundled ? 0 : 1, $1.name) }
    }
    func bundledURL(slug: String, tier: String) -> URL? {
        guard slug == "tia", tier == "1k" else { return nil }
        return Bundle.main.url(forResource: "model", withExtension: "glb")
    }
    func downloadedURL(slug: String, tier: String) -> URL? {
        let url = root.appendingPathComponent(slug, isDirectory: true).appendingPathComponent("\(slug)-\(tier).glb")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    func isPresent(slug: String, tier: String) -> Bool { bundledURL(slug: slug, tier: tier) != nil || downloadedURL(slug: slug, tier: tier) != nil }
    func isBundled(slug: String, tier: String) -> Bool { bundledURL(slug: slug, tier: tier) != nil }
    func remote(slug: String, tier: String) -> Remote? { index.avatars[slug]?.ios?[tier] }

    /// The model to load for a quality: the wanted tier, or the largest
    /// installed tier below it.
    func modelURL(slug: String, quality: String) -> URL? {
        let wanted = quality == "friendly" ? 0 : quality == "best" ? 2 : 1
        for i in stride(from: wanted, through: 0, by: -1) {
            let tier = Self.tiers[i]
            if let url = downloadedURL(slug: slug, tier: tier) ?? bundledURL(slug: slug, tier: tier) { return url }
        }
        for tier in Self.tiers.reversed() { if let url = downloadedURL(slug: slug, tier: tier) ?? bundledURL(slug: slug, tier: tier) { return url } }
        return nil
    }

    // MARK: - catalogue

    func refreshIndex() async {
        indexStatus = "Checking the cloud catalogue…"
        do {
            let (data, response) = try await URLSession.shared.data(from: Self.releaseBase.appendingPathComponent("index.json"))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let parsed = try JSONDecoder().decode(Index.self, from: data)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try data.write(to: root.appendingPathComponent("index.json"))
            index = parsed
            if index.avatars["tia"] == nil { index.avatars["tia"] = Entry(name: "Tia", bundledIOS: true, ios: nil) }
            indexStatus = "Catalogue updated."
        } catch { indexStatus = "Could not reach the catalogue: \(error.localizedDescription)" }
    }

    // MARK: - downloads

    func download(slug: String, tier: String) async {
        guard progress == nil, let remote = remote(slug: slug, tier: tier) else { return }
        progress = Progress(slug: slug, tier: tier, fraction: 0, phase: "download", error: "")
        let dir = root.appendingPathComponent(slug, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let temp = try await downloader.download(Self.releaseBase.appendingPathComponent(remote.file), expected: Int64(remote.bytes)) { [weak self] fraction in
                Task { @MainActor in self?.progress?.fraction = fraction }
            }
            progress?.phase = "verify"
            if let expected = remote.sha256, !expected.isEmpty {
                let digest = try Self.sha256(of: temp)
                guard digest == expected else { throw NSError(domain: "gla", code: 2, userInfo: [NSLocalizedDescriptionKey: "The download was corrupted; please try again."]) }
            }
            let dest = dir.appendingPathComponent("\(slug)-\(tier).glb")
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: temp, to: dest)
            progress?.phase = "done"; progress?.fraction = 1
            revision += 1
            onChange?()
        } catch {
            progress?.phase = "error"; progress?.error = (error as? URLError)?.code == .cancelled ? "Cancelled." : error.localizedDescription
        }
        let finished = progress
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        if progress == finished { progress = nil }
    }
    func cancel() { downloader.cancel() }
    func remove(slug: String, tier: String) {
        guard let url = downloadedURL(slug: slug, tier: tier) else { return }
        try? FileManager.default.removeItem(at: url)
        revision += 1
        onChange?()
    }

    nonisolated static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var hash = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hash.update(data: chunk) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

/// URLSession download with byte progress and cancellation.
final class Downloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<URL, Error>?
    private var onProgress: ((Double) -> Void)?
    private var expected: Int64 = 0
    private var task: URLSessionDownloadTask?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    private let lock = NSLock()

    func download(_ url: URL, expected: Int64, onProgress: @escaping (Double) -> Void) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            self.continuation = continuation; self.onProgress = onProgress; self.expected = expected
            let task = session.downloadTask(with: url)
            self.task = task
            lock.unlock()
            task.resume()
        }
    }
    func cancel() { lock.lock(); task?.cancel(); lock.unlock() }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : expected
        onProgress?(total > 0 ? min(0.99, Double(totalBytesWritten) / Double(total)) : 0)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // The file at `location` is deleted when this returns: move it first.
        let stable = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".glb")
        lock.lock(); let continuation = self.continuation; self.continuation = nil; lock.unlock()
        do {
            if let status = (downloadTask.response as? HTTPURLResponse)?.statusCode, status != 200 { throw URLError(.badServerResponse) }
            try FileManager.default.moveItem(at: location, to: stable)
            continuation?.resume(returning: stable)
        } catch { continuation?.resume(throwing: error) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        lock.lock(); let continuation = self.continuation; self.continuation = nil; lock.unlock()
        continuation?.resume(throwing: error)
    }
}
