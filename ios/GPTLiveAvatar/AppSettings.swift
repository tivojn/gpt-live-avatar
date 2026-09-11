import Foundation
import Security

/// User settings in UserDefaults; the OpenAI key in the Keychain.
@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()
    static let liveModel = "gpt-live-1"
    static let voices = ["marin", "beacon", "bossa", "cinder", "delta", "gleam", "meridian", "quartz", "ripple", "stone", "tempo", "vesper", "willow"]
    static let recommendedBackends = ["gpt-5.6-terra", "gpt-5.6-luna"]
    static let qualities = ["friendly", "balanced", "best"]

    @Published var backendModel: String { didSet { save("backendModel", backendModel) } }
    @Published var voice: String { didSet { save("voice", voice) } }
    @Published var quality: String { didSet { save("quality", quality); AvatarStore.shared.applyQuality(quality) } }
    @Published var personaName: String { didSet { save("personaName", personaName) } }
    @Published var persona: String { didSet { save("persona", persona) } }
    @Published var opacity: Double { didSet { save("opacity", opacity) } }
    @Published var showBubble: Bool { didSet { save("showBubble", showBubble) } }
    @Published private(set) var hasKey: Bool
    @Published var backends: [String]
    @Published var keyStatus = ""

    private let defaults = UserDefaults.standard
    private init() {
        backendModel = defaults.string(forKey: "backendModel") ?? "gpt-5.6-terra"
        voice = defaults.string(forKey: "voice") ?? "marin"
        quality = defaults.string(forKey: "quality") ?? "balanced"
        personaName = defaults.string(forKey: "personaName") ?? "Tia"
        persona = defaults.string(forKey: "persona") ?? "You are Tia, a warm, playful companion who loves to move."
        opacity = defaults.object(forKey: "opacity") as? Double ?? 1
        showBubble = defaults.object(forKey: "showBubble") as? Bool ?? true
        backends = defaults.stringArray(forKey: "backends") ?? Self.recommendedBackends
        hasKey = Keychain.read() != nil
        AvatarStore.shared.applyQuality(quality)
#if DEBUG
        // Development: seed the key from the launch environment once.
        if !hasKey, let seed = ProcessInfo.processInfo.environment["GLA_OPENAI_KEY"], seed.hasPrefix("sk-") { Keychain.write(seed); hasKey = true }
#endif
    }
    private func save(_ key: String, _ value: Any) { defaults.set(value, forKey: key) }

    var apiKey: String { Keychain.read() ?? "" }

    func clearKey() { Keychain.delete(); hasKey = false; keyStatus = "Key removed." }

    /// Validate against the API before storing.
    func setKey(_ raw: String) async {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard key.hasPrefix("sk-"), key.count > 20 else { keyStatus = "That does not look like an OpenAI API key."; return }
        keyStatus = "Validating with OpenAI…"
        do {
            let ids = try await Self.fetchModels(key: key)
            Keychain.write(key); hasKey = true
            backends = Self.candidates(ids); save("backends", backends)
            if !backends.contains(backendModel) { backendModel = backends.first ?? backendModel }
            keyStatus = ids.contains(Self.liveModel) ? "Key saved. GPT-Live-1 is available on this account." : "Key saved. GPT-Live-1 is not listed for this account yet."
        } catch { keyStatus = error.localizedDescription }
    }
    func refreshModels() async {
        guard hasKey else { return }
        do { let ids = try await Self.fetchModels(key: apiKey); backends = Self.candidates(ids); save("backends", backends); keyStatus = "Model list refreshed." }
        catch { keyStatus = error.localizedDescription }
    }
    static func fetchModels(key: String) async throws -> [String] {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/models")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw NSError(domain: "gla", code: 401, userInfo: [NSLocalizedDescriptionKey: "OpenAI rejected this API key."]) }
        guard status == 200, let json = try JSONSerialization.jsonObject(with: data) as? [String: Any], let list = json["data"] as? [[String: Any]] else {
            throw NSError(domain: "gla", code: status, userInfo: [NSLocalizedDescriptionKey: "OpenAI answered \(status) while listing models."])
        }
        return list.compactMap { $0["id"] as? String }
    }
    static func candidates(_ ids: [String]) -> [String] {
        let wanted = ids.filter { $0.range(of: "^gpt-5(\\.\\d+)?(-[a-z]+)?$", options: .regularExpression) != nil && $0.range(of: "codex|search|chat", options: .regularExpression) == nil }
        var seen = Set<String>(); var out: [String] = []
        for id in recommendedBackends.filter(ids.contains) + wanted where seen.insert(id).inserted { out.append(id) }
        return out
    }

    /// The GPT-Live session configuration: voice persona plus motion vocabulary,
    /// and the backend Responses model for delegated reasoning.
    func liveSessionConfig() -> [String: Any] {
        let labels = AvatarStore.shared.motionLabels.prefix(96).joined(separator: ", ")
        let instructions = [
            "You are \(personaName), the voice of an animated 3D companion on the user's phone. Speak warmly and naturally at an unhurried pace, in plain spoken language. Be concise by default, usually one to three sentences, and ask only one question at a time. Never use markdown, lists, code or emojis, and never describe your voice, models or delivery. Reply in the language the user speaks.",
            "Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.",
            "Interruption policy: Stop speaking when the user interrupts. Listen to what they say.",
            labels.isEmpty ? "" : "You embody the on-screen avatar. The app can play these installed body animations: \(labels). When the user asks you to perform one, or a demonstration clearly fits the conversation, say a natural affirmative intention that names the animation, such as \"Sure, I'll try a kung fu punch\" or \"I'll do a little dance\". The app follows your spoken intention, not the user's words. You can also sit down, stand up, wave, make a heart, walk around or run around the screen, come closer, step back, walk to any corner, and stay still; say those the same way, such as \"I'll sit down now\" or \"I'll walk to the upper-right corner\". Never deny having an installed animation, never invent one that is not installed, and never claim real physical abilities.",
            "Delegation policy:\nBackend tools:\n- Knowledge assistant: answers questions that need careful reasoning or knowledge you are unsure about.\n\nDelegate to the backend when:\n- The request needs careful reasoning, detailed facts or figures you are not confident about.\n\nDo not delegate to the backend when:\n- It is a greeting, small talk, a feeling, a compliment or something you can answer from the conversation.\n- The user asks for an animation, pose, dance, gesture or movement: answer yourself with the affirmative intention described above.\n\nDelegate before giving an answer that depends on backend work. Do not guess the result while waiting.",
            "Persona notes from the user: \(persona)",
        ].filter { !$0.isEmpty }.joined(separator: "\n\n")
        return [
            "model": Self.liveModel,
            "instructions": instructions,
            "audio": ["format": ["type": "audio/pcm", "rate": 24000], "output": ["voice": voice]],
            "delegation": ["type": "responses", "responses": [
                "model": backendModel,
                "instructions": "You are the backend for \(personaName), the voice of an animated companion. Answer delegated questions with short, plain-language results the voice model can read out: no markdown, lists, code or emojis. Be accurate and candid about uncertainty. Persona notes from the user: \(persona)",
                "reasoning": ["effort": "low"], "max_output_tokens": 600,
            ]],
        ]
    }
}

enum Keychain {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "GPTLiveAvatar", kSecAttrAccount as String: "openai-api-key"]
    static func read() -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ value: String) {
        delete()
        var q = query; q[kSecValueData as String] = Data(value.utf8); q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
    static func delete() { SecItemDelete(query as CFDictionary) }
}
