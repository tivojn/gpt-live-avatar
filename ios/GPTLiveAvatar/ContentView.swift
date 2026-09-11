import SwiftUI

/// Full-screen Tia with an overhead bubble: captions, call controls, steering.
struct ContentView: View {
    @StateObject private var live = LiveSession(apiKey: { AppSettings.shared.apiKey }, sessionConfig: { AppSettings.shared.liveSessionConfig() })
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var store = AvatarStore.shared
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var orbit = AvatarOrbit()
    @State private var orbitStart = AvatarOrbit()
    @State private var zoom: CGFloat = 1
    @State private var zoomStart: CGFloat = 1
    @State private var showSettings = false
    @State private var steer = ""
    @State private var mouth = MouthDriver()
    @State private var smoother = PoseSmoother()
    @State private var blinkNext: TimeInterval = 0
    @State private var blinkAt: TimeInterval = -10
    @State private var bubbleHeight: CGFloat = 0

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                Color.black.ignoresSafeArea()
                TimelineView(.animation(minimumInterval: reduceMotion ? 0.25 : 1.0 / 30, paused: scenePhase != .active)) { context in
                    AvatarWebView(pose: pose(at: context.date), orbit: orbit, visibleRect: visibleRect(in: proxy.size),
                                  insets: (settings.showBubble ? bubbleHeight + proxy.safeAreaInsets.top + 16 : proxy.safeAreaInsets.top, proxy.safeAreaInsets.bottom),
                                  isActive: scenePhase == .active)
                }
                .opacity(settings.opacity)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 4).onChanged { value in orbit = orbitStart.dragging(value.translation) }.onEnded { _ in orbitStart = orbit })
                .simultaneousGesture(MagnificationGesture().onChanged { value in zoom = min(2.5, max(0.6, zoomStart * value)) }.onEnded { _ in zoomStart = zoom })
                .onTapGesture(count: 2) { toggleCall() }
                if settings.showBubble {
                    bubble.padding(.horizontal, 12).padding(.top, 8)
                        .background(GeometryReader { g in Color.clear.onAppear { bubbleHeight = g.size.height }.onChange(of: g.size.height) { _, h in bubbleHeight = h } })
                }
                if case .loading = store.loadState { ProgressView("Loading Tia…").tint(.white).foregroundStyle(.white).padding().background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14)).frame(maxHeight: .infinity) }
                if case .failed(let message) = store.loadState { Text(message).foregroundStyle(.white).multilineTextAlignment(.center).padding().background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14)).padding(24).frame(maxHeight: .infinity) }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .onAppear {
            live.onAssistantFinal = { user, reply, turn in AvatarStore.shared.conversation(user: user, reply: reply, turnID: turn) }
            if !settings.hasKey { showSettings = true }
#if DEBUG
            let env = ProcessInfo.processInfo.environment
            if let slug = env["GLA_AVATAR"], !slug.isEmpty { settings.avatar = slug }
            if let clip = env["GLA_PLAY"], !clip.isEmpty {
                // Unattended motion test without a live session: GLA_PLAY=kung-fu-punch
                Task {
                    while store.loadState != .ready { try? await Task.sleep(nanoseconds: 500_000_000) }
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    let reply = await store.command("clip:" + clip)
                    try? await Task.sleep(nanoseconds: 1_200_000_000)
                    NSLog("GLA play %@ -> %@ status=%@", clip, reply ?? "nil", store.motionStatus)
                }
            }
            if let spec = env["GLA_DOWNLOAD"], spec.contains(":") {
                // Unattended download test: GLA_DOWNLOAD=tia:2k
                let parts = spec.split(separator: ":").map(String.init)
                Task {
                    var last = -1
                    let watcher = Task { while !Task.isCancelled { if let p = AssetStore.shared.progress { let pc = Int(p.fraction * 100); if pc != last { last = pc; NSLog("GLA download %@ %@ %d%%", p.phase, p.tier, pc) } }; try? await Task.sleep(nanoseconds: 300_000_000) } }
                    await AssetStore.shared.download(slug: parts[0], tier: parts[1])
                    watcher.cancel()
                    NSLog("GLA download finished: present=%d model=%@", AssetStore.shared.isPresent(slug: parts[0], tier: parts[1]) ? 1 : 0, AvatarStore.shared.modelURL?.lastPathComponent ?? "nil")
                }
            }
            if env["GLA_AUTOSTART"] == "1" {
                Task {
                    while store.loadState != .ready { try? await Task.sleep(nanoseconds: 500_000_000) }
                    await live.start()
                    if let text = env["GLA_STEER_AFTER"], !text.isEmpty {
                        try? await Task.sleep(nanoseconds: 9_000_000_000)
                        live.appendCommentary(text)
                    }
                }
            }
#endif
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active, live.state != .idle { live.stop(reason: "background") } }
        .preferredColorScheme(.dark)
        .statusBarHidden(true)
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle().fill(dotColor).frame(width: 8, height: 8)
                Text(settings.personaName).font(.headline)
                Text(statusText).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
            }
            if !live.userLine.isEmpty { Text(live.userLine).font(.footnote).padding(6).background(Color.blue.opacity(0.35), in: RoundedRectangle(cornerRadius: 8)).frame(maxWidth: .infinity, alignment: .trailing) }
            if !live.assistantLine.isEmpty { Text(live.assistantLine).font(.footnote).padding(6).background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8)).frame(maxWidth: .infinity, alignment: .leading) }
            HStack(spacing: 8) {
                Button(live.state == .idle ? "Start conversation" : live.state == .connecting ? "Connecting…" : "End") { toggleCall() }
                    .buttonStyle(.borderedProminent).tint(live.state == .idle ? .blue : .red).disabled(live.state == .connecting || !settings.hasKey)
                Button(live.muted ? "Unmute" : "Mute") { live.setMuted(!live.muted) }.buttonStyle(.bordered).disabled(live.state != .connected)
                Button("Stop talking") { live.stopSpeaking() }.buttonStyle(.bordered).disabled(live.state != .connected)
            }.font(.footnote)
            HStack {
                TextField("Steer her: e.g. speak slowly, do a wave…", text: $steer).textFieldStyle(.roundedBorder).font(.footnote).disabled(live.state != .connected)
                    .onSubmit(sendSteer)
                Button("Send", action: sendSteer).buttonStyle(.bordered).font(.footnote).disabled(live.state != .connected || steer.isEmpty)
            }
            if live.state == .connected {
                HStack(spacing: 6) {
                    Image(systemName: live.muted ? "mic.slash" : "mic").font(.caption2)
                    GeometryReader { g in ZStack(alignment: .leading) { Capsule().fill(Color.white.opacity(0.15)); Capsule().fill(Color.green).frame(width: g.size.width * CGFloat(live.inputLevel)) } }.frame(height: 4)
                    Text(live.sentAudioBytes > 0 ? "\(live.sentAudioBytes / 48000) s sent" : "no audio yet").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            if !live.lastError.isEmpty { Text(live.lastError).font(.caption2).foregroundStyle(.red) }
        }
        .padding(10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .foregroundStyle(.white)
    }

    private var dotColor: Color { live.state == .connected ? (live.speaking ? .green : .green.opacity(0.6)) : live.state == .connecting ? .yellow : .gray }
    private var statusText: String {
        if case .failed = store.loadState { return "Avatar failed to load" }
        switch live.state {
        case .idle: return settings.hasKey ? "Ready. Double-tap me or press Start." : "Add your OpenAI key in Settings."
        case .connecting: return "Connecting to GPT-Live…"
        case .connected: return store.motionStatus.isEmpty ? "Live. Talk to me." : store.motionStatus
        }
    }
    private func toggleCall() {
        if !settings.hasKey { showSettings = true; return }
        if live.state == .idle { Task { await live.start() } } else { live.stop() }
    }
    private func sendSteer() { let text = steer.trimmingCharacters(in: .whitespaces); guard !text.isEmpty else { return }; live.appendCommentary(text); steer = "" }

    /// Full body crop, zoomed around the figure; the renderer widens it to the screen aspect.
    private func visibleRect(in size: CGSize) -> CGRect {
        let frame = AvatarStore.frame
        // Leave headroom above her for the bubble; keep her feet near the bottom.
        let crop = CGRect(x: 0, y: -frame.height * 0.16, width: frame.width, height: frame.height * 1.2)
        let width = crop.width / zoom, height = crop.height / zoom
        return CGRect(x: crop.midX - width / 2, y: crop.maxY - height, width: width, height: height)
    }

    private func pose(at date: Date) -> AvatarPose {
        let time = date.timeIntervalSinceReferenceDate
        var driver = mouth
        driver.update(viseme: live.outputViseme, level: Double(live.outputLevel), at: time)
        if driver != mouth { DispatchQueue.main.async { mouth = driver } }
        var pose = AvatarPose()
        pose.reduceMotion = reduceMotion
        pose.visemeWeights = smoother.smoothed(target: driver.targets(at: time), at: time)
        pose.speaking = driver.isSpeaking
        pose.articulation = pose.speaking ? 1 : 0.85
        if time >= blinkNext { DispatchQueue.main.async { blinkAt = time; blinkNext = time + 2.5 + Double.random(in: 0...3.5) } }
        let t = (time - blinkAt) / 0.17
        let blink = t >= 0 && t < 1 ? sin(t * .pi) : 0
        pose.blinkLeft = blink; pose.blinkRight = blink
        return pose
    }
}
