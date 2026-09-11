import CoreGraphics
import Foundation

/// The 15 Meta/Oculus XR visemes the renderer understands (`avatar3d.js`).
enum AvatarViseme: String, CaseIterable, Sendable {
    case silence = "sil", bilabial = "PP", labiodental = "FF", dental = "TH", alveolar = "DD", velar = "kk"
    case postalveolar = "CH", sibilant = "SS", nasal = "nn", rhotic = "RR", open = "aa", wide = "E"
    case nearClose = "ih", openRounded = "oh", rounded = "ou"
}

/// Camera angles for the orbit gesture.
struct AvatarOrbit: Equatable, Sendable {
    var yaw: Double = 0
    var pitch: Double = 0
    var sanitized: Self {
        let y = yaw.isFinite ? yaw : 0, p = pitch.isFinite ? pitch : 0
        return Self(yaw: atan2(sin(y), cos(y)), pitch: min(.pi * 0.44, max(-.pi * 0.44, p)))
    }
    func dragging(_ translation: CGSize) -> Self {
        Self(yaw: yaw - Double(translation.width) * 0.009, pitch: pitch + Double(translation.height) * 0.007).sanitized
    }
}

enum AvatarModelError: LocalizedError, Equatable {
    case notGLB, invalidJSON, externalResources
    var errorDescription: String? {
        switch self {
        case .notGLB: "The model is not a binary glTF (.glb) file."
        case .invalidJSON: "The model file is damaged."
        case .externalResources: "The model references external files; export a single .glb."
        }
    }
}

enum GLBConstants {
    static let magic: UInt32 = 0x4654_6C67       // "glTF"
    static let jsonChunk: UInt32 = 0x4E4F_534A   // "JSON"
}

/// Per-frame facial state sent to the renderer. Mirrors OpenClam's pose contract.
struct AvatarPose: Equatable, Sendable {
    var visemeWeights: [AvatarViseme: Double] = [:]
    var articulation: Double = 1
    var blinkLeft: Double = 0
    var blinkRight: Double = 0
    var gazeX: Double = 0
    var gazeY: Double = 0
    var brow: Double = 0
    var smile: Double = 0.35
    var sad: Double = 0
    var surprise: Double = 0
    var anger: Double = 0
    var headYaw: Double = 0
    var headPitch: Double = 0
    var headRoll: Double = 0
    var speaking = false
    var reduceMotion = false

    var webState: [String: Any] {
        ["visemeWeights": Dictionary(uniqueKeysWithValues: visemeWeights.map { ($0.key.rawValue, $0.value) }),
         "intensity": articulation, "blink": ["l": blinkLeft, "r": blinkRight],
         "gaze": ["x": gazeX, "y": gazeY], "brow": brow,
         "expression": ["smile": smile, "sad": sad, "surprise": surprise, "anger": anger],
         "head": ["yaw": headYaw, "pitch": headPitch, "roll": headRoll],
         "speaking": speaking, "reduce": reduceMotion]
    }
}

/// One smoothed weight per viseme so fast consonant–vowel runs pass through
/// real in-between shapes instead of snapping.
final class PoseSmoother: @unchecked Sendable {
    static let attack: TimeInterval = 0.038, release: TimeInterval = 0.064
    private var weights: [AvatarViseme: Double] = [:]
    private var lastTime: TimeInterval?
    private let lock = NSLock()
    func smoothed(target: [AvatarViseme: Double], at time: TimeInterval) -> [AvatarViseme: Double] {
        lock.lock(); defer { lock.unlock() }
        let elapsed = lastTime.map { min(0.12, max(0.001, time - $0)) } ?? 0.016
        lastTime = time
        var result: [AvatarViseme: Double] = [:]
        for viseme in AvatarViseme.allCases where viseme != .silence {
            let wanted = min(1, max(0, target[viseme] ?? 0)), current = weights[viseme] ?? 0
            let tau = wanted > current ? Self.attack : Self.release
            let next = current + (wanted - current) * (1 - exp(-elapsed / tau))
            weights[viseme] = next
            if next > 0.002 { result[viseme] = next }
        }
        return result
    }
    func reset() { lock.lock(); weights = [:]; lastTime = nil; lock.unlock() }
}

/// Audio-energy lip-sync with hysteresis bands (OpenClam's Live Talk mouth
/// driver): silence → narrow → wide → open, each with a minimum hold and a
/// crossfade between the outgoing and incoming shapes.
struct MouthDriver: Equatable, Sendable {
    static let minimumHold: TimeInterval = 0.105
    static let speechEnter = 0.018, speechExit = 0.010
    private static let wideEnter = 0.060, wideExit = 0.040
    private static let openEnter = 0.135, openExit = 0.090
    private static let attack: TimeInterval = 0.060, release: TimeInterval = 0.140

    private enum Band: Equatable, Sendable {
        case silence, narrow, wide, open
        var viseme: AvatarViseme { switch self { case .silence: .silence; case .narrow: .nearClose; case .wide: .wide; case .open: .open } }
    }
    private var smoothed = 0.0
    private var lastSampleAt: TimeInterval?
    private var band = Band.silence
    private var previous = AvatarViseme.silence
    private var current = AvatarViseme.silence
    private var transitionedAt: TimeInterval = -1

    mutating func update(level: Double, at time: TimeInterval) {
        let raw = level.isFinite ? min(1, max(0, level)) : 0
        if let last = lastSampleAt {
            let elapsed = min(0.5, max(0, time - last))
            let tau = raw > smoothed ? Self.attack : Self.release
            smoothed += (raw - smoothed) * (1 - exp(-elapsed / tau))
        } else { smoothed = raw }
        lastSampleAt = time
        let candidate = nextBand(for: smoothed)
        guard candidate != band, time - transitionedAt >= Self.minimumHold else { return }
        previous = current; current = candidate.viseme; band = candidate; transitionedAt = time
    }
    mutating func reset(at time: TimeInterval) { smoothed = 0; lastSampleAt = time; band = .silence; previous = .silence; current = .silence; transitionedAt = time }

    /// Viseme targets at `time`: a crossfade between the previous and current shapes.
    func targets(at time: TimeInterval) -> [AvatarViseme: Double] {
        var result: [AvatarViseme: Double] = [:]
        let blend = previous == current ? 1 : min(1, max(0, (time - transitionedAt) / 0.09))
        if current != .silence { result[current] = blend }
        if previous != .silence, previous != current { result[previous] = 1 - blend }
        return result
    }
    var isSpeaking: Bool { band != .silence }

    private func nextBand(for level: Double) -> Band {
        switch band {
        case .silence: if level >= Self.openEnter { return .open }; if level >= Self.wideEnter { return .wide }; return level >= Self.speechEnter ? .narrow : .silence
        case .narrow: if level < Self.speechExit { return .silence }; if level >= Self.openEnter { return .open }; return level >= Self.wideEnter ? .wide : .narrow
        case .wide: if level < Self.speechExit { return .silence }; if level >= Self.openEnter { return .open }; return level < Self.wideExit ? .narrow : .wide
        case .open: if level < Self.speechExit { return .silence }; return level < Self.openExit ? .wide : .open
        }
    }
}
