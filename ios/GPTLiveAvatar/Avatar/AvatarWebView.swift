import SwiftUI
import WebKit
import Compression

/// The same three.js renderer as the Mac app, hosted in a WKWebView and fed by
/// a custom URL scheme. UIKit owns gestures; WebKit receives presentation and
/// expression values once per frame through `window.updateAvatar(frame)`.
@MainActor
struct AvatarWebView: UIViewRepresentable {
    let pose: AvatarPose
    let orbit: AvatarOrbit
    let visibleRect: CGRect
    var isActive = true
    @ObservedObject private var store = AvatarStore.shared

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(context.coordinator.assets, forURLScheme: "gla-avatar")
        config.userContentController.add(context.coordinator, name: "avatarStatus")
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isUserInteractionEnabled = false
        view.navigationDelegate = context.coordinator
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.view = view
        store.renderer = coordinator
        if !coordinator.started || coordinator.textureLimit != store.textureLimit {
            coordinator.textureLimit = store.textureLimit
            coordinator.start(view)
        }
        coordinator.latest = [
            "frame": ["width": AvatarStore.frame.width, "height": AvatarStore.frame.height],
            "crop": ["x": visibleRect.minX, "y": visibleRect.minY, "w": visibleRect.width, "h": visibleRect.height],
            "orbit": ["yaw": orbit.yaw, "pitch": orbit.pitch],
            "state": pose.webState,
            "performance": ["active": isActive, "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled, "thermal": ProcessInfo.processInfo.thermalState.rawValue],
            "conversation": store.conversation,
            "options": store.selection,
            "pointer": NSNull(),
        ]
        coordinator.needsFlush = true
        coordinator.flush(view)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.evaluateJavaScript("window.disposeAvatar?.()", completionHandler: nil)
        view.configuration.userContentController.removeScriptMessageHandler(forName: "avatarStatus")
        coordinator.timeout?.cancel(); coordinator.startup?.cancel(); coordinator.assets.cancelAll()
        view.navigationDelegate = nil; view.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let assets = AvatarAssets()
        weak var view: WKWebView?
        var started = false
        var textureLimit = 2048
        var pageReady = false, updating = false, needsFlush = false, hasFailed = false
        var latest: [String: Any]?
        private var lastFrame: NSDictionary?
        var generation = 0, recoveryCount = 0
        var timeout: Task<Void, Never>?, startup: Task<Void, Never>?
        var preparing = false
        static let recoveryDelays: [Duration] = [.seconds(2), .seconds(5)]

        func command(_ value: String, isText: Bool) async throws -> String? {
            guard pageReady, !hasFailed, let view else { return nil }
            return try await view.callAsyncJavaScript("return await window.avatarCommand(value, isText)",
                arguments: ["value": value, "isText": isText], in: nil, contentWorld: .page) as? String
        }

        func start(_ view: WKWebView, delay: Duration = .zero) {
            started = true
            generation += 1; hasFailed = false; pageReady = false; updating = false; lastFrame = nil; needsFlush = true
            let current = generation
            startup?.cancel(); timeout?.cancel(); assets.cancelAll(); view.stopLoading()
            preparing = true
            assets.maximumTextureSize = recoveryCount == 0 ? textureLimit : recoveryCount == 1 ? min(textureLimit, 1024) : 512
            AvatarStore.shared.loadState = .loading
            armTimeout(view, generation: current, seconds: 180)
            startup = Task { @MainActor [weak self, weak view] in
                do {
                    try await Task.sleep(for: delay)
                    guard let self, let view, self.generation == current else { return }
                    try await self.assets.prepare()
                    try Task.checkCancellation()
                    guard self.generation == current, !self.hasFailed else { return }
                    self.preparing = false
                    self.armTimeout(view, generation: current, seconds: 90)
                    view.load(URLRequest(url: URL(string: "gla-avatar://local/index.html?generation=\(current)")!))
                } catch is CancellationError {
                } catch {
                    guard let self, let view, self.generation == current else { return }
                    self.fail(error.localizedDescription, view: view)
                }
            }
        }

        private func armTimeout(_ view: WKWebView, generation current: Int, seconds: Int) {
            timeout?.cancel()
            timeout = Task { @MainActor [weak self, weak view] in
                try? await Task.sleep(for: .seconds(seconds))
                guard !Task.isCancelled, let self, let view, self.generation == current, !self.pageReadyRendered else { return }
                self.fail("The 3D avatar took too long to load. Reopen the app to try again.", view: view)
            }
        }
        private var pageReadyRendered = false

        func fail(_ message: String, view: WKWebView) {
            hasFailed = true; startup?.cancel(); preparing = false; timeout?.cancel(); pageReady = false
            assets.cancelAll(); view.stopLoading()
            AvatarStore.shared.loadState = .failed(message)
        }

        func flush(_ view: WKWebView) {
            guard pageReady, !updating, needsFlush, let latest else { return }
            needsFlush = false
            let frame = latest as NSDictionary
            guard lastFrame?.isEqual(to: latest) != true else { return }
            lastFrame = frame
            let current = generation
            updating = true
            view.callAsyncJavaScript("window.updateAvatar(frame)", arguments: ["frame": latest], in: nil, in: .page) { [weak self, weak view] result in
                guard let self, self.generation == current else { return }
                self.updating = false
                if case .failure(let error) = result, let view {
                    if (error as NSError).domain == WKError.errorDomain, (error as NSError).code == WKError.webContentProcessTerminated.rawValue { self.webViewWebContentProcessDidTerminate(view) }
                    else { self.fail(error.localizedDescription, view: view) }
                    return
                }
                if let view { self.flush(view) }
            }
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any], body["generation"] as? Int == generation, !hasFailed else { return }
            switch body["event"] as? String {
            case "page-ready": pageReady = true; if let view = message.webView { flush(view) }
            case "rendered": pageReadyRendered = true; timeout?.cancel(); AvatarStore.shared.loadState = .ready
            case "renderer-lost": if let view = message.webView { webViewWebContentProcessDidTerminate(view) }
            case "motion-status": AvatarStore.shared.motionStatus = String((body["text"] as? String ?? "").prefix(160))
            case "preference":
                if let key = body["key"] as? String, let value = body["value"] as? Bool { AvatarStore.shared.setEnabled(value, key: key) }
            case "pose": if let id = body["id"] as? String { AvatarStore.shared.selection["body"] = id.isEmpty ? nil : id; AvatarStore.shared.selection["playTransitions"] = "false" }
            case "catalogue": AvatarStore.shared.receive(body["catalogue"])
            default: break
            }
            if let error = body["error"] as? String, let view = message.webView { fail(error, view: view) }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = action.request.url
            decisionHandler(url?.scheme == "gla-avatar" && url?.host == "local" ? .allow : .cancel)
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            guard !preparing, !hasFailed else { return }
            if recoveryCount < Self.recoveryDelays.count {
                let delay = Self.recoveryDelays[recoveryCount]; recoveryCount += 1
                start(webView, delay: delay)
            } else { fail("iOS stopped the 3D renderer. Lower the rendering quality in Settings and reopen the app.", view: webView) }
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard !preparing, !hasFailed, (error as NSError).code != NSURLErrorCancelled else { return }
            fail(error.localizedDescription, view: webView)
        }
    }
}

/// Serves the renderer, the model split into buffers and screen-sized
/// textures, and the compressed motion clips from the app bundle.
@MainActor
final class AvatarAssets: NSObject, WKURLSchemeHandler {
    static let resources: [String: String] = [
        "/index.html": "avatar-ios.html", "/avatar-ios.js": "avatar-ios.js",
        "/avatar3d.js": "avatar3d.js", "/avatar3d-options.js": "avatar3d-options.js",
        "/avatar3d-motion.js": "avatar3d-motion.js", "/avatar3d-companion.js": "avatar3d-companion.js",
        "/vendor/three/three.module.js": "three.module.js", "/vendor/three/three.core.js": "three.core.js",
        "/vendor/three/GLTFLoader.js": "GLTFLoader.js", "/vendor/three/RoomEnvironment.js": "RoomEnvironment.js",
        "/vendor/three/BufferGeometryUtils.js": "BufferGeometryUtils.js", "/vendor/three/SkeletonUtils.js": "SkeletonUtils.js",
    ]
    var maximumTextureSize = 2048
    private var requests: [ObjectIdentifier: UUID] = [:]
    private let worker = ModelWorker()
    private var preparation: UUID?

    func cancelAll() { requests.removeAll(); preparation = nil }

    func prepare() async throws {
        let token = UUID(), maximum = maximumTextureSize
        preparation = token
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            worker.queue.async { [worker, weak self] in
                let cancelled = { DispatchQueue.main.sync { self?.preparation != token } }
                let result = Result<Void, Error> {
                    if cancelled() { throw CancellationError() }
                    let model = try worker.model(maximum: maximum)
                    DispatchQueue.main.sync { guard let self, self.preparation == token else { return }; AvatarStore.shared.receive(worker.catalogue(model)) }
                    try model.prepareImages(isCancelled: cancelled)
                }
                DispatchQueue.main.async { if self?.preparation == token { self?.preparation = nil }; continuation.resume(with: result) }
            }
        }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let request = task.request.url, request.host == "local" else { task.didFailWithError(URLError(.unsupportedURL)); return }
        let key = ObjectIdentifier(task), token = UUID()
        requests[key] = token
        let maximum = maximumTextureSize
        let bundled = Self.resources[request.path].flatMap { Bundle.main.url(forResource: $0, withExtension: nil) }
        worker.queue.async { [worker, weak self] in
            guard DispatchQueue.main.sync(execute: { self?.requests[key] == token }) else { return }
            let result: Result<(Data, String), Error> = Result {
                try autoreleasepool {
                    if let bundled { return (try Data(contentsOf: bundled), request.path.hasSuffix(".js") ? "text/javascript" : "text/html") }
                    if request.path.hasPrefix("/motions/") { return (try MotionResources.resource(path: request.path), "application/json") }
                    let model = try worker.model(maximum: maximum)
                    if request.path == "/model.gltf" { return (model.document, "model/gltf+json") }
                    let parts = request.path.split(separator: "/")
                    guard parts.count == 2, let digits = parts[1].split(separator: ".").first, let index = Int(digits), index >= 0 else { throw URLError(.fileDoesNotExist) }
                    if request.path == "/buffers/\(index).bin" { return (try model.buffer(at: index), "application/octet-stream") }
                    if request.path == "/images/\(index).png" { return (try model.image(at: index), "image/png") }
                    throw URLError(.fileDoesNotExist)
                }
            }
            DispatchQueue.main.sync {
                guard let self, self.requests[key] == token else { return }
                self.requests[key] = nil
                switch result {
                case let .success((data, type)):
                    let response = HTTPURLResponse(url: request, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"])!
                    task.didReceive(response); task.didReceive(data); task.didFinish()
                case let .failure(error): task.didFailWithError(error)
                }
            }
        }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { requests[ObjectIdentifier(task)] = nil }
}

private final class ModelWorker: @unchecked Sendable {
    let queue = DispatchQueue(label: "gla.avatar-resources", qos: .userInitiated)
    private var key = ""
    private var source: ModelResources?
    func catalogue(_ model: ModelResources) -> [String: Any] {
        var value = model.catalogue
        value["motions"] = MotionResources.choices()
        return value
    }
    func model(maximum: Int) throws -> ModelResources {
        let next = "\(maximum)"
        if next == key, let source { return source }
        guard let url = Bundle.main.url(forResource: "model", withExtension: "glb") else { throw URLError(.fileDoesNotExist) }
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("GPTLiveAvatar/3DTextures", isDirectory: true)
        let model = try ModelResources(url: url, maximumTextureSize: maximum, cacheRoot: cache)
        source = model; key = next
        return model
    }
}

/// Motion clips ship raw-deflate compressed; the library index is plain JSON.
enum MotionResources {
    static func libraryURL() -> URL? { Bundle.main.url(forResource: "library", withExtension: "json", subdirectory: "motions") }
    static func choices() -> [[String: Any]] {
        guard let url = libraryURL(), let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let clips = json["clips"] as? [[String: Any]] else { return [] }
        return clips.compactMap { clip in
            guard let id = clip["id"] as? String else { return nil }
            return ["id": id, "label": clip["label"] as? String ?? id, "category": clip["category"] as? String ?? ""]
        }
    }
    static func resource(path: String) throws -> Data {
        let name = String(path.dropFirst("/motions/".count))
        guard name.range(of: "^[a-z0-9_-]{1,40}\\.json$", options: .regularExpression) != nil else { throw URLError(.fileDoesNotExist) }
        if name == "library.json" { guard let url = libraryURL() else { throw URLError(.fileDoesNotExist) }; return try Data(contentsOf: url) }
        guard let url = Bundle.main.url(forResource: name, withExtension: "deflate", subdirectory: "motions") else { throw URLError(.fileDoesNotExist) }
        let compressed = try Data(contentsOf: url, options: .mappedIfSafe)
        return try (compressed as NSData).decompressed(using: .zlib) as Data
    }
}

enum AvatarLoadState: Equatable { case loading, ready, failed(String) }

/// Renderer-facing state shared with SwiftUI: load state, motion catalogue,
/// selection options (quality, transitions), and the conversation turn the
/// JS companion reacts to.
@MainActor
final class AvatarStore: ObservableObject {
    static let shared = AvatarStore()
    static let frame = CGSize(width: 1024, height: 1536)
    @Published var loadState: AvatarLoadState = .loading
    @Published var motionStatus = ""
    @Published var motions: [[String: String]] = []
    @Published var selection: [String: String] = ["performance": "balanced"]
    @Published var conversation: [String: String] = [:]
    @Published var textureLimit = 2048
    weak var renderer: AvatarWebView.Coordinator?

    var motionLabels: [String] { motions.compactMap { $0["label"] } }

    func receive(_ value: Any?) {
        guard let dict = value as? [String: Any], let motions = dict["motions"] as? [[String: Any]] else { return }
        self.motions = motions.compactMap { m in
            guard let id = m["id"] as? String else { return nil }
            return ["id": id, "label": (m["label"] as? String ?? id).replacingOccurrences(of: "[^\\p{L}\\p{N} -]", with: "", options: .regularExpression), "category": m["category"] as? String ?? ""]
        }
    }
    func setEnabled(_ enabled: Bool, key: String) {
        guard ["playTransitions", "followCursor", "dynamicMotions"].contains(key) else { return }
        selection[key] = enabled ? nil : "false"
    }
    func applyQuality(_ quality: String) {
        switch quality {
        case "friendly": selection["performance"] = "eco"; textureLimit = 1024
        case "best": selection["performance"] = "quality"; textureLimit = 4096
        default: selection["performance"] = "balanced"; textureLimit = 2048
        }
    }
    /// Hand a finished assistant reply to the companion controller in the page.
    func conversation(user: String, reply: String, turnID: String) {
        conversation = ["id": UUID().uuidString, "turnID": turnID, "user": String(user.prefix(6000)), "reply": String(reply.prefix(6000)), "suggestion": "", "created": String(Date().timeIntervalSince1970 * 1000)]
    }
    func command(_ value: String, isText: Bool = false) async -> String? {
        guard loadState == .ready else { return nil }
        return try? await renderer?.command(value, isText: isText)
    }
}
