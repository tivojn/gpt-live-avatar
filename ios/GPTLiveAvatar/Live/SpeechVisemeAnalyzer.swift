import Accelerate
import Foundation

/// Classifies playing speech into a viseme from its spectrum, mirroring the
/// Mac app's analyser-based rules (band energies, centroid, zero crossings).
/// Called on the audio render thread; keeps only small private state.
final class SpeechVisemeAnalyzer: @unchecked Sendable {
    struct Result { let level: Float; let viseme: AvatarViseme; let speaking: Bool }

    private let size = 1024
    private var dft: vDSP.DFT<Float>?
    private var window: [Float]
    private var real: [Float], imag: [Float], outReal: [Float], outImag: [Float]
    private var peak: Float = 0.018
    private var current = AvatarViseme.silence
    private var changedAt: TimeInterval = 0
    private var audibleUntil: TimeInterval = 0
    private let lock = NSLock()

    init() {
        window = vDSP.window(ofType: Float.self, usingSequence: .hanningDenormalized, count: size, isHalfWindow: false)
        real = [Float](repeating: 0, count: size); imag = real; outReal = real; outImag = real
        dft = vDSP.DFT(count: size, direction: .forward, transformType: .complexComplex, ofType: Float.self)
    }
    func reset() { lock.lock(); defer { lock.unlock() }; peak = 0.018; current = .silence; changedAt = 0; audibleUntil = 0 }

    func analyze(samples: UnsafePointer<Float>, count: Int, sampleRate: Float) -> Result {
        lock.lock(); defer { lock.unlock() }
        let n = min(count, size)
        guard n > 32, let dft else { return Result(level: 0, viseme: .silence, speaking: false) }
        // Time-domain features.
        var squareSum: Float = 0; var crossings = 0; var previous: Float = 0
        for i in 0..<n { let v = samples[i]; squareSum += v * v; if i > 0, (v >= 0) != (previous >= 0) { crossings += 1 }; previous = v }
        let rms = sqrt(squareSum / Float(n))
        let zcr = Float(crossings) / Float(max(1, n - 1))
        // Spectrum: windowed DFT, magnitudes mapped to the WebAudio byte scale
        // (-100...-30 dB -> 0...1) so the Mac thresholds carry over.
        for i in 0..<size { real[i] = i < n ? samples[i] * window[i] : 0; imag[i] = 0 }
        dft.transform(inputReal: real, inputImaginary: imag, outputReal: &outReal, outputImaginary: &outImag)
        let bins = size / 2, nyquist = max(1, sampleRate) * 0.5
        let bands: [(Float, Float)] = [(80, 520), (520, 2200), (2200, 7200)]
        var totals: [Float] = [0, 0, 0]; var counts: [Float] = [0, 0, 0]
        var weighted: Float = 0, energyTotal: Float = 0
        for i in 1..<bins {
            let f = Float(i) / Float(bins) * nyquist
            if f > 7200 { break }
            let mag = sqrt(outReal[i] * outReal[i] + outImag[i] * outImag[i]) * 2 / Float(size)
            let db = 20 * log10(max(mag, 1e-9))
            let m = min(1, max(0, (db + 100) / 70)); let e = m * m
            energyTotal += e; weighted += f * e
            for (b, range) in bands.enumerated() where f >= range.0 && f < range.1 { totals[b] += e; counts[b] += 1; break }
        }
        let low = sqrt(totals[0] / max(1, counts[0])), mid = sqrt(totals[1] / max(1, counts[1])), high = sqrt(totals[2] / max(1, counts[2]))
        let centroid = energyTotal > 0 ? min(1, weighted / energyTotal / 7200) : 0
        peak = max(0.018, rms, peak * 0.994)
        let intensity = min(1, rms / peak)
        let now = Date().timeIntervalSinceReferenceDate
        let audible = rms > 0.012
        if audible { audibleUntil = now + 0.16 }
        let speaking = now < audibleUntil
        guard speaking else { current = .silence; return Result(level: 0, viseme: .silence, speaking: false) }
        let wanted: AvatarViseme
        if !audible { wanted = current == .silence ? .nearClose : current }
        else if (zcr > 0.145 && high > low * 0.82) || high > max(low, mid) * 1.22 { wanted = .sibilant }
        else if centroid < 0.31 && low > high * 1.12 { wanted = intensity > 0.72 ? .openRounded : .rounded }
        else if intensity > 0.78 { wanted = .open }
        else if centroid > 0.55 { wanted = intensity > 0.46 ? .wide : .nearClose }
        else if intensity > 0.48 { wanted = .wide }
        else { wanted = .nearClose }
        if wanted != current, now - changedAt > 0.07 { current = wanted; changedAt = now }
        return Result(level: min(1, rms * 6), viseme: current, speaking: true)
    }
}
