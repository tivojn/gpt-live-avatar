import SwiftUI

struct SettingsView: View {
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var assets = AssetStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var keyDraft = ""
    @State private var busy = false

    @ViewBuilder private func tierRow(_ tier: String) -> some View {
        let slug = settings.avatar
        let present = assets.isPresent(slug: slug, tier: tier), bundled = assets.isBundled(slug: slug, tier: tier)
        let remote = assets.remote(slug: slug, tier: tier)
        let active = assets.progress.flatMap { $0.slug == slug && $0.tier == tier ? $0 : nil }
        let busy = assets.progress != nil && assets.progress?.phase != "done" && assets.progress?.phase != "error"
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(AssetStore.tierLabels[tier] ?? tier).font(.subheadline)
                Spacer()
                if let active, active.phase == "download" {
                    Text("\(Int(active.fraction * 100))%").monospacedDigit().font(.caption)
                    Button("Cancel") { assets.cancel() }.font(.caption)
                } else if let active, active.phase == "verify" { Text("Verifying…").font(.caption).foregroundStyle(.secondary) }
                else if present {
                    Text(bundled ? "Included" : "Ready").font(.caption).foregroundStyle(.green)
                    if !bundled { Button("Remove", role: .destructive) { assets.remove(slug: slug, tier: tier) }.font(.caption).disabled(busy) }
                } else if let remote {
                    Button("Download \(remote.bytes / 1_048_576) MB") { Task { await assets.download(slug: slug, tier: tier) } }.font(.caption).disabled(busy)
                } else { Text("Not published").font(.caption).foregroundStyle(.secondary) }
            }
            if let active, active.phase == "download" || active.phase == "verify" { ProgressView(value: active.fraction) }
            if let active, active.phase == "error" { Text(active.error).font(.caption2).foregroundStyle(.red) }
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("OpenAI") {
                    SecureField("API key (sk-…)", text: $keyDraft).textInputAutocapitalization(.never).autocorrectionDisabled()
                    HStack {
                        Button("Validate & save") { busy = true; Task { await settings.setKey(keyDraft); keyDraft = ""; busy = false } }.disabled(keyDraft.isEmpty || busy)
                        Spacer()
                        Button("Remove", role: .destructive) { settings.clearKey() }.disabled(!settings.hasKey)
                    }
                    Text(settings.keyStatus.isEmpty ? (settings.hasKey ? "API key stored in the Keychain." : "No API key yet.") : settings.keyStatus).font(.caption).foregroundStyle(settings.hasKey ? .green : .secondary)
                    Picker("Backend model", selection: $settings.backendModel) {
                        ForEach(settings.backends, id: \.self) { id in Text(id + (AppSettings.recommendedBackends.contains(id) ? " · recommended" : "")).tag(id) }
                    }
                    Button("Refresh model list") { Task { await settings.refreshModels() } }.disabled(!settings.hasKey)
                    Text("GPT-Live-1 handles the conversation itself and hands harder questions to this Responses model. OpenAI's guide starts with GPT-5.6 Terra and suggests GPT-5.6 Luna for lower cost.").font(.caption).foregroundStyle(.secondary)
                    Picker("Voice", selection: $settings.voice) { ForEach(AppSettings.voices, id: \.self) { Text($0.capitalized + ($0 == "marin" ? " · default" : "")).tag($0) } }
                }
                Section("Persona") {
                    TextField("Name", text: $settings.personaName)
                    TextField("Personality notes", text: $settings.persona, axis: .vertical).lineLimit(2...5)
                    Text("Motion vocabulary (kung fu punch, dance, sit, wave, walk around…) is added automatically.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Avatar") {
                    Picker("Avatar", selection: $settings.avatar) {
                        ForEach(assets.avatars) { a in Text(a.name + (a.bundled ? " · built in" : a.installed ? " · downloaded" : " · cloud")).tag(a.slug) }
                    }
                    ForEach(AssetStore.tiers, id: \.self) { tier in tierRow(tier) }
                    Button("Check cloud catalogue") { Task { await assets.refreshIndex() } }
                    if !assets.indexStatus.isEmpty { Text(assets.indexStatus).font(.caption).foregroundStyle(.secondary) }
                    Text("The app includes Tia at 1K. Balanced and Best quality use 2K and 4K models downloaded once from the cloud; without them the largest installed model is used.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Rendering") {
                    Picker("Quality", selection: $settings.quality) {
                        Text("Resource friendly").tag("friendly"); Text("Balanced").tag("balanced"); Text("Best quality").tag("best")
                    }.pickerStyle(.segmented)
                    Text(settings.quality == "friendly" ? "1K textures, lighter frame budget. Lowest GPU, RAM and battery use." : settings.quality == "best" ? "Full textures and frame rate. Highest memory use; the phone may lower it under pressure." : "2K textures, 30 fps. The recommended setting.").font(.caption).foregroundStyle(.secondary)
                    HStack { Text("Opacity"); Slider(value: $settings.opacity, in: 0.15...1, step: 0.05); Text("\(Int(settings.opacity * 100))%").monospacedDigit().frame(width: 44, alignment: .trailing) }
                    Toggle("Show the bubble", isOn: $settings.showBubble)
                }
                Section("Tips") {
                    Text("Drag to rotate her, pinch to zoom, double-tap to start or end a conversation. Say \"do a kung fu punch\", \"sit down\", \"wave\", \"dance\" or \"walk around\" and she follows her own words.").font(.footnote)
                }
            }
            .navigationTitle("Settings")
            .task { if AssetStore.shared.indexStatus.isEmpty { await AssetStore.shared.refreshIndex() } }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
