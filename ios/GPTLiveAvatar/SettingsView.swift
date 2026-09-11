import SwiftUI

struct SettingsView: View {
    @ObservedObject private var settings = AppSettings.shared
    @Environment(\.dismiss) private var dismiss
    @State private var keyDraft = ""
    @State private var busy = false

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
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
