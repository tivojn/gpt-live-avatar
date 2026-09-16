// gla-audio-tap - capture the audio of ONE running application.
//
// Why a Core Audio process tap and not the obvious alternatives:
//
//   getDisplayMedia   captures the whole machine, which includes the avatar's
//                     own speech. She would lip-sync to herself. It also needs
//                     Screen Recording permission just to listen to a song.
//   Electron loopback audio:'loopback' is Windows only (Electron 43).
//   BlackHole         asks the user to install a virtual device and re-route
//                     their default output. Breaks normal listening.
//
// A process tap (macOS 14.4+) sits in the HAL *after* the app has decoded its
// own audio, so Spotify and Music work despite DRM, the sound still reaches the
// speakers untouched, and only the tapped process is heard.
//
// Protocol on stdout: one JSON header line, then raw PCM forever.
//
//   {"sampleRate":48000,"channels":2,"format":"f32","interleaved":true}\n
//   <float32 le> <float32 le> ...
//
// Stereo is deliberate: the vocal isolator upstream separates the singer from
// the band by per-band L/R coherence, and a mono mixdown destroys exactly the
// information it needs.

import Foundation
import AudioToolbox
import CoreAudio
import AppKit

let SYS = AudioObjectID(kAudioObjectSystemObject)

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

// ------------------------------------------------------------ property sugar

func address(_ selector: AudioObjectPropertySelector,
             _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func propertySize(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
  var a = address(selector), size: UInt32 = 0
  return AudioObjectGetPropertyDataSize(object, &a, 0, nil, &size) == noErr ? size : nil
}

func scalar<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ zero: T) -> T? {
  var a = address(selector), out = zero, size = UInt32(MemoryLayout<T>.size)
  let err = withUnsafeMutablePointer(to: &out) { AudioObjectGetPropertyData(object, &a, 0, nil, &size, $0) }
  return err == noErr ? out : nil
}

func text(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var a = address(selector), size = UInt32(MemoryLayout<CFString?>.size)
  var value: CFString? = nil
  let err = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &a, 0, nil, &size, $0) }
  guard err == noErr, let value else { return nil }
  return value as String
}

// --------------------------------------------------------------- processes

struct AudioProcess {
  let object: AudioObjectID
  let pid: pid_t
  let bundleID: String
  let name: String
  let playing: Bool
}

func audioProcesses() -> [AudioProcess] {
  var a = address(kAudioHardwarePropertyProcessObjectList)
  guard var size = propertySize(SYS, kAudioHardwarePropertyProcessObjectList), size > 0 else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  let err = ids.withUnsafeMutableBufferPointer { AudioObjectGetPropertyData(SYS, &a, 0, nil, &size, $0.baseAddress!) }
  guard err == noErr else { return [] }

  return ids.compactMap { object in
    guard let pid: pid_t = scalar(object, kAudioProcessPropertyPID, pid_t(0)) else { return nil }
    let bundle = text(object, kAudioProcessPropertyBundleID) ?? ""
    let running = NSRunningApplication(processIdentifier: pid)
    let name = running?.localizedName ?? bundle.split(separator: ".").last.map(String.init) ?? "pid \(pid)"
    let playing = (scalar(object, kAudioProcessPropertyIsRunningOutput, UInt32(0)) ?? 0) != 0
    return AudioProcess(object: object, pid: pid, bundleID: bundle, name: name, playing: playing)
  }
}

func emitProcessList() {
  let rows: [[String: Any]] = audioProcesses()
    .sorted { ($0.playing ? 0 : 1, $0.name.lowercased()) < ($1.playing ? 0 : 1, $1.name.lowercased()) }
    .map { ["pid": Int($0.pid), "bundleId": $0.bundleID, "name": $0.name, "playing": $0.playing] }
  let data = try! JSONSerialization.data(withJSONObject: ["processes": rows])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

// ------------------------------------------------------------- stdout pump
//
// The IO proc runs on a realtime thread; a blocking write(2) there would glitch
// the user's music. Frames are copied into a ring and drained by a normal
// thread. Overflow drops the oldest audio rather than stalling the tap: late
// audio is worthless to a lip-sync anyway.

final class PCMPump {
  private let capacity: Int
  private var ring: UnsafeMutablePointer<UInt8>
  private var head = 0, tail = 0, used = 0
  private let lock = NSCondition()
  private var running = true

  init(capacity: Int = 1 << 21) {
    self.capacity = capacity
    ring = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
    Thread.detachNewThread { [weak self] in self?.drain() }
  }

  func push(_ bytes: UnsafeRawPointer, _ count: Int) {
    guard count > 0, count <= capacity else { return }
    lock.lock()
    if used + count > capacity {
      let discard = used + count - capacity
      tail = (tail + discard) % capacity
      used -= discard
    }
    let first = min(count, capacity - head)
    ring.advanced(by: head).update(from: bytes.assumingMemoryBound(to: UInt8.self), count: first)
    if first < count {
      ring.update(from: bytes.advanced(by: first).assumingMemoryBound(to: UInt8.self), count: count - first)
    }
    head = (head + count) % capacity
    used += count
    lock.signal()
    lock.unlock()
  }

  func stop() { lock.lock(); running = false; lock.signal(); lock.unlock() }

  private func drain() {
    var scratch = [UInt8](repeating: 0, count: 1 << 16)
    while true {
      lock.lock()
      while used == 0 && running { lock.wait() }
      if used == 0 && !running { lock.unlock(); return }
      let count = min(used, scratch.count)
      let first = min(count, capacity - tail)
      scratch.withUnsafeMutableBufferPointer { out in
        out.baseAddress!.update(from: ring.advanced(by: tail), count: first)
        if first < count { out.baseAddress!.advanced(by: first).update(from: ring, count: count - first) }
      }
      tail = (tail + count) % capacity
      used -= count
      lock.unlock()

      var written = 0
      while written < count {
        let n = scratch.withUnsafeBufferPointer { write(1, $0.baseAddress!.advanced(by: written), count - written) }
        if n > 0 { written += n } else if errno == EINTR { continue } else { exit(0) }  // parent went away
      }
    }
  }
}

// -------------------------------------------------------------------- tap

var tapID = AudioObjectID(kAudioObjectUnknown)
var aggregateID = AudioObjectID(kAudioObjectUnknown)
var ioProcID: AudioDeviceIOProcID?

func teardown() {
  if let proc = ioProcID, aggregateID != AudioObjectID(kAudioObjectUnknown) {
    AudioDeviceStop(aggregateID, proc)
    AudioDeviceDestroyIOProcID(aggregateID, proc)
  }
  if aggregateID != AudioObjectID(kAudioObjectUnknown) { AudioHardwareDestroyAggregateDevice(aggregateID) }
  if tapID != AudioObjectID(kAudioObjectUnknown) { AudioHardwareDestroyProcessTap(tapID) }
  aggregateID = AudioObjectID(kAudioObjectUnknown)
  tapID = AudioObjectID(kAudioObjectUnknown)
}

func startTap(describedBy description: CATapDescription) {
  description.uuid = UUID()
  description.muteBehavior = .unmuted  // the user keeps hearing their music

  var status = AudioHardwareCreateProcessTap(description, &tapID)
  guard status == noErr, tapID != AudioObjectID(kAudioObjectUnknown) else {
    fail("tap-create-failed \(status) - macOS 14.4+ and audio-recording permission are required")
  }

  // The tap only produces audio while it is a member of a running device.
  guard let outputUID = scalar(SYS, kAudioHardwarePropertyDefaultOutputDevice, AudioDeviceID(0))
    .flatMap({ text($0, kAudioDevicePropertyDeviceUID) }) else { fail("no-default-output") }

  let aggregate: [String: Any] = [
    kAudioAggregateDeviceNameKey: "GPT-Live Avatar Listen",
    kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceMainSubDeviceKey: outputUID,
    kAudioAggregateDeviceIsPrivateKey: true,   // never appears in Sound settings
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
    kAudioAggregateDeviceTapListKey: [[
      kAudioSubTapDriftCompensationKey: true,
      kAudioSubTapUIDKey: description.uuid.uuidString,
    ]],
  ]
  status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID)
  guard status == noErr, aggregateID != AudioObjectID(kAudioObjectUnknown) else { fail("aggregate-create-failed \(status)") }

  var formatAddress = address(kAudioTapPropertyFormat)
  var asbd = AudioStreamBasicDescription()
  var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
  guard AudioObjectGetPropertyData(tapID, &formatAddress, 0, nil, &size, &asbd) == noErr, asbd.mSampleRate > 0 else {
    fail("tap-format-unavailable")
  }

  let channels = Int(asbd.mChannelsPerFrame)
  let nonInterleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
  let header = "{\"sampleRate\":\(Int(asbd.mSampleRate)),\"channels\":\(channels),\"format\":\"f32\",\"interleaved\":true}\n"
  FileHandle.standardOutput.write(header.data(using: .utf8)!)

  let pump = PCMPump()
  var interleaved = [Float](repeating: 0, count: 8192 * max(channels, 1))

  status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, nil) { _, input, _, _, _ in
    let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
    guard list.count > 0 else { return }

    if !nonInterleaved {
      // Already interleaved: hand the bytes straight over.
      for buffer in list {
        guard let data = buffer.mData, buffer.mDataByteSize > 0 else { continue }
        pump.push(data, Int(buffer.mDataByteSize))
      }
      return
    }

    // Planar: weave the channels so the consumer sees one stereo stream.
    let frames = Int(list[0].mDataByteSize) / MemoryLayout<Float>.size
    guard frames > 0 else { return }
    let planes = min(list.count, channels)
    if interleaved.count < frames * channels { interleaved = [Float](repeating: 0, count: frames * channels) }
    interleaved.withUnsafeMutableBufferPointer { out in
      for plane in 0..<planes {
        guard let source = list[plane].mData?.assumingMemoryBound(to: Float.self) else { continue }
        for frame in 0..<frames { out[frame * channels + plane] = source[frame] }
      }
      pump.push(out.baseAddress!, frames * channels * MemoryLayout<Float>.size)
    }
  }
  guard status == noErr, let proc = ioProcID else { fail("ioproc-create-failed \(status)") }

  status = AudioDeviceStart(aggregateID, proc)
  guard status == noErr else { fail("device-start-failed \(status)") }
}

// -------------------------------------------------------------------- main

let arguments = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> String? {
  guard let i = arguments.firstIndex(of: name), i + 1 < arguments.count else { return nil }
  return arguments[i + 1]
}

if arguments.contains("--list") { emitProcessList(); exit(0) }

var targets: [AudioObjectID] = []
var excluded: [AudioObjectID] = []

if let pidText = option("--pid"), let pid = pid_t(pidText) {
  guard let match = audioProcesses().first(where: { $0.pid == pid }) else { fail("no-audio-process-for-pid \(pid)") }
  targets = [match.object]
} else if let bundle = option("--bundle") {
  let matches = audioProcesses().filter { $0.bundleID.caseInsensitiveCompare(bundle) == .orderedSame }
  guard !matches.isEmpty else { fail("no-audio-process-for-bundle \(bundle)") }
  targets = matches.map { $0.object }   // a player can own several audio processes
} else if arguments.contains("--system") {
  // Everything except us, so the avatar never hears her own voice.
  let mine = Set(option("--exclude")?.split(separator: ",").compactMap { pid_t($0) } ?? [])
  excluded = audioProcesses().filter { mine.contains($0.pid) }.map { $0.object }
} else {
  fail("usage: gla-audio-tap --list | --pid <pid> | --bundle <id> | --system [--exclude pid,pid]")
}

let description = targets.isEmpty
  ? CATapDescription(stereoGlobalTapButExcludeProcesses: excluded)
  : CATapDescription(stereoMixdownOfProcesses: targets)

for signalNumber in [SIGINT, SIGTERM, SIGHUP] {
  signal(signalNumber, { _ in teardown(); exit(0) })
}
signal(SIGPIPE, SIG_IGN)

// The parent closing stdin is the normal stop signal - but only when stdin is
// really a pipe from that parent. Run from a shell with stdin on /dev/null and
// the read returns EOF at once, which would stop the tap before it started.
var stdinInfo = stat()
if fstat(0, &stdinInfo) == 0, stdinInfo.st_mode & S_IFMT == S_IFIFO {
  Thread.detachNewThread {
    var byte: UInt8 = 0
    while read(0, &byte, 1) > 0 {}
    teardown()
    exit(0)
  }
}

startTap(describedBy: description)
CFRunLoopRun()
