import AVFoundation
import Foundation

/// Native client for OpenAI GPT-Live over WebSocket.
///
/// Microphone audio is captured with AVAudioEngine, converted to mono PCM16 at
/// 24 kHz and streamed as `session.input_audio.append`. Generated speech
/// arrives as `session.output_audio.delta` PCM16 chunks and is scheduled on an
/// AVAudioPlayerNode. Transcript deltas are folded into segments the UI shows
/// and the motion controller reacts to.
@MainActor
final class LiveSession: ObservableObject {
    enum State: Equatable { case idle, connecting, connected }
    struct Transcript: Equatable { let role: String; let id: String; let text: String; let final: Bool }

    @Published private(set) var state: State = .idle
    @Published private(set) var sessionID = ""
    @Published private(set) var lastError = ""
    @Published private(set) var userLine = ""
    @Published private(set) var assistantLine = ""
    @Published private(set) var speaking = false
    @Published private(set) var outputLevel: Float = 0
    @Published private(set) var muted = false
    /// Latest finalized assistant sentence group and the user turn it answers.
    var onAssistantFinal: ((_ userText: String, _ reply: String, _ turnID: String) -> Void)?

    private let apiKeyProvider: () -> String
    private let configProvider: () -> [String: Any]
    private var socket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var converter: AVAudioConverter?
    private let wireFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24_000, channels: 1, interleaved: true)!
    private var pendingByte: UInt8?
    private var eventCounter = 0
    private var segments: [String: (id: String, text: String, endMs: Double, timer: Task<Void, Never>?)] = [:]
    private var latestUserFinal = ""
    private var assistantTurn = ""
    private var turnID = "live:greeting"
    private var levelDecay: Task<Void, Never>?

    init(apiKey: @escaping () -> String, sessionConfig: @escaping () -> [String: Any]) {
        apiKeyProvider = apiKey
        configProvider = sessionConfig
    }

    // MARK: - lifecycle

    func start() async {
        guard state == .idle else { return }
        let key = apiKeyProvider()
        guard !key.isEmpty else { lastError = "Add your OpenAI API key in Settings first."; return }
        lastError = ""; userLine = ""; assistantLine = ""; assistantTurn = ""; latestUserFinal = ""; turnID = "live:greeting"
        state = .connecting
        do {
            try configureAudioSession()
            try startAudioEngine()
        } catch {
            lastError = "Microphone unavailable: \(error.localizedDescription)"
            state = .idle
            return
        }
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/live/sessions")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let session = URLSession(configuration: .default)
        urlSession = session
        let task = session.webSocketTask(with: request)
        socket = task
        task.resume()
        send(["type": "session.start", "session": configProvider()])
        receiveLoop()
    }

    func stop(reason: String = "user") {
        guard state != .idle else { return }
        for role in ["user", "assistant"] { finishSegment(role) }
        send(["type": "session.close"])
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil; urlSession?.invalidateAndCancel(); urlSession = nil
        stopAudioEngine()
        state = .idle
        speaking = false; outputLevel = 0
    }

    func setMuted(_ value: Bool) {
        muted = value
        send(["type": value ? "session.input_audio.mute" : "session.input_audio.unmute"])
    }
    func appendInstructions(_ text: String) { send(["type": "session.instructions.append", "content": text, "delegation_id": NSNull()]) }
    func stopSpeaking() { appendInstructions("Stop speaking now and wait quietly for the user.") }

    // MARK: - websocket

    private func send(_ event: [String: Any]) {
        guard let socket else { return }
        var payload = event
        eventCounter += 1
        if payload["event_id"] == nil { payload["event_id"] = "evt_\(eventCounter)" }
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }

    private func receiveLoop() {
        socket?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .failure(let error):
                    if self.state != .idle { self.lastError = error.localizedDescription; self.stop(reason: "connection_lost") }
                case .success(let message):
                    if case .string(let text) = message, let data = text.data(using: .utf8),
                       let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { self.handle(event) }
                    self.receiveLoop()
                }
            }
        }
    }

    private func handle(_ event: [String: Any]) {
        switch event["type"] as? String ?? "" {
        case "session.started":
            sessionID = ((event["session"] as? [String: Any])?["id"] as? String) ?? ""
            state = .connected
            appendInstructions("Greet the user warmly in one short sentence right now, then pause and listen.")
        case "session.output_audio.delta":
            if let b64 = event["delta"] as? String, let data = Data(base64Encoded: b64) { play(data) }
        case "session.input_transcript.delta": transcript(role: "user", event)
        case "session.output_transcript.delta": transcript(role: "assistant", event)
        case "session.closed":
            stop(reason: event["reason"] as? String ?? "closed")
        case "error":
            let error = event["error"] as? [String: Any]
            lastError = (error?["message"] as? String) ?? (error?["code"] as? String) ?? "Live session error."
        default: break
        }
    }

    // MARK: - transcripts

    private func transcript(role: String, _ event: [String: Any]) {
        let delta = event["delta"] as? String ?? ""
        let startMs = event["start_ms"] as? Double ?? .nan
        let endMs = event["end_ms"] as? Double ?? .nan
        var segment = segments[role]
        if let current = segment, !startMs.isNaN, !current.endMs.isNaN, startMs - current.endMs > 800 { finishSegment(role); segment = nil }
        if segment == nil {
            let id = "\(role)-\(UUID().uuidString.prefix(8))"
            segment = (id: id, text: "", endMs: endMs, timer: nil)
            if role == "user" { turnID = id; assistantTurn = ""; assistantLine = "" }
        }
        segment!.text += delta
        if !endMs.isNaN { segment!.endMs = max(segment!.endMs.isNaN ? 0 : segment!.endMs, endMs) }
        segment!.timer?.cancel()
        segment!.timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.finishSegment(role) }
        }
        segments[role] = segment
        if role == "user" { userLine = segment!.text } else { assistantLine = segment!.text }
    }

    private func finishSegment(_ role: String) {
        guard let segment = segments[role] else { return }
        segment.timer?.cancel()
        segments[role] = nil
        let text = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if role == "user" {
            latestUserFinal = text
        } else {
            assistantTurn = assistantTurn.isEmpty ? text : assistantTurn + " " + text
            onAssistantFinal?(latestUserFinal, assistantTurn, turnID)
        }
    }

    // MARK: - audio

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setPreferredSampleRate(48_000)
        try session.setActive(true)
    }

    private func startAudioEngine() throws {
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        converter = AVAudioConverter(from: inputFormat, to: wireFormat)
        if !engine.attachedNodes.contains(player) { engine.attach(player) }
        engine.connect(player, to: engine.mainMixerNode, format: wireFormat)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 2_048, format: inputFormat) { [weak self] buffer, _ in
            self?.capture(buffer)
        }
        engine.prepare()
        try engine.start()
        player.play()
    }

    private func stopAudioEngine() {
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        converter = nil
        pendingByte = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Runs on the audio thread: convert to 24 kHz mono PCM16 and ship it.
    private nonisolated func capture(_ buffer: AVAudioPCMBuffer) {
        Task { @MainActor [weak self] in
            guard let self, self.state != .idle, !self.muted, let converter = self.converter else { return }
            let ratio = self.wireFormat.sampleRate / buffer.format.sampleRate
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 32)
            guard let output = AVAudioPCMBuffer(pcmFormat: self.wireFormat, frameCapacity: capacity) else { return }
            var consumed = false
            var error: NSError?
            converter.convert(to: output, error: &error) { _, status in
                if consumed { status.pointee = .noDataNow; return nil }
                consumed = true; status.pointee = .haveData; return buffer
            }
            guard error == nil, output.frameLength > 0, let channel = output.int16ChannelData else { return }
            var bytes = Data(bytes: channel[0], count: Int(output.frameLength) * 2)
            if let pending = self.pendingByte { bytes.insert(pending, at: 0); self.pendingByte = nil }
            if bytes.count % 2 == 1 { self.pendingByte = bytes.removeLast() }
            guard !bytes.isEmpty else { return }
            self.send(["type": "session.input_audio.append", "audio": bytes.base64EncodedString()])
        }
    }

    private func play(_ pcm: Data) {
        let frames = AVAudioFrameCount(pcm.count / 2)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: wireFormat, frameCapacity: frames) else { return }
        buffer.frameLength = frames
        pcm.withUnsafeBytes { raw in
            guard let base = raw.baseAddress, let channel = buffer.int16ChannelData else { return }
            memcpy(channel[0], base, Int(frames) * 2)
        }
        // Output level for lip-sync: RMS of this chunk, decayed between chunks.
        var sum: Float = 0
        if let channel = buffer.int16ChannelData {
            for i in 0..<Int(frames) { let v = Float(channel[0][i]) / 32_768; sum += v * v }
        }
        let rms = sqrt(sum / Float(frames))
        outputLevel = max(outputLevel * 0.6, min(1, rms * 6))
        speaking = outputLevel > 0.04
        levelDecay?.cancel()
        levelDecay = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.outputLevel = 0; self?.speaking = false }
        }
        player.scheduleBuffer(buffer, completionHandler: nil)
        if !player.isPlaying { player.play() }
    }
}
