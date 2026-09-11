# GPT-Live Avatar for iPhone

The same Tia on OpenAI GPT-Live-1, as a native iOS app. The three.js renderer
from the Mac app runs inside a WKWebView fed by a custom URL scheme; Swift
owns the GPT-Live WebSocket, the microphone, playback, lip-sync and settings.

- `GPTLiveAvatar/Live/LiveSession.swift`: WebSocket client, 24 kHz PCM
  capture and playback, transcript segments, mute, steering.
- `GPTLiveAvatar/Avatar/`: model/texture pipeline (`ModelResources.swift`),
  WebView bridge and scheme handler (`AvatarWebView.swift`), pose, orbit and
  lip-sync driver (`AvatarModel.swift`).
- `GPTLiveAvatar/Web/`: the iOS frame loop (`avatar-ios.js`) and page shell;
  the shared modules and three.js come from `../web/` at build time.
- `Resources/`: Tia's model with textures re-encoded at 2K
  (`tools/shrink-glb.py`) and the 62 motion clips as raw deflate.

Build: `xcodegen generate`, then build the `GPTLiveAvatar` scheme. Archive and
upload with `ExportOptions-AppStore.plist` (destination upload, automatic
signing, team X7R8N6MMSU). Debug builds accept `GLA_OPENAI_KEY`,
`GLA_AUTOSTART=1` and `GLA_STEER_AFTER` launch environment variables for
unattended simulator tests.
