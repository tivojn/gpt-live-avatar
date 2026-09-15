# Independent development handoff

For an authorized coworker making feature changes to GPT-Live Avatar while
continuing to use the existing protected avatar download service. No owner
Cloudflare login, Blender originals or private release keys are needed.

If you are integrating the avatar layer into **EnConvo**, start with
[ENCONVO-HANDOFF.md](ENCONVO-HANDOFF.md). It separates reusable rendering/audio
components from the account, voice and agent systems EnConvo already owns.

Updated for **v0.2.10**, released September 15, 2026. The signed/notarized reference
build is Apple Silicon only. [Release notes and checksums](https://github.com/tivojn/gpt-live-avatar/releases/tag/v0.2.10)
identify the exact installer; no new DMG is needed for documentation-only updates.

## First successful run

Use an Apple Silicon Mac (M1 or newer) with macOS 14 or newer, Git and a current
Node.js LTS with npm. Node 22.12.0 or newer is required by Electron.

1. Download the official signed installer:
   https://github.com/tivojn/gpt-live-avatar/releases/download/v0.2.10/GPT-Live.Avatar-0.2.10-arm64.dmg
2. Copy **GPT-Live Avatar.app** into Applications. Launch it while online and
   confirm Tia appears. This is also the reference app for comparing changes.
3. Clone the source and create your own branch:

```bash
git clone https://github.com/tivojn/gpt-live-avatar.git
cd gpt-live-avatar
git switch -c codex/coworker-feature
npm ci
npm run import-release -- "/Applications/GPT-Live Avatar.app"
npm test
npm run start:isolated
```

`import-release` verifies the signed catalogue and Tia's full SHA-256 checksum.
It imports only these **already shipped** resources:

| From the installed app's Contents/Resources | In the clone |
| --- | --- |
| assets-runtime.json | build/protected/assets-runtime.json |
| assets-index.json | build/protected/index.json |
| avatars/tia/base.gla | build/protected/starter/tia/base.gla |

It also links the encrypted starter into `build/assets/bundle/tia` so the
unpackaged development app can display Tia. Files stay encrypted and ignored by
Git. The command is safe to rerun with identical resources and refuses to
replace different ones. For a different release, use a fresh clone or back up
and move conflicting imported files before importing again.

`start:isolated` uses `build/dev-profile` for its settings, downloads and locally
protected credentials. It does not use the normal installed app's profile or
inherit the owner's voice-key environment variable. Close the development app
before restarting it after source changes. No npm compile step is needed for
ordinary Electron/HTML/JavaScript edits.

## Accounts and additional characters

- Tia is included; her first unlock needs internet. No voice key is needed just
  to display or manipulate her. Download other characters in Settings → Avatar.
- Voice and Together talk need **your own OpenAI API key with GPT-Live access**.
  OpenAI account sign-in for reasoning does not replace the voice key.
- To use Codex for both reasoning and actions, install/sign in to Codex, choose
  Settings → Reasoning → Delegate mode → OpenAI → Authentication → Codex App
  Server, and Check Codex connection. Enable actions below. The same model serves
  solo and Together; a separate OAuth sign-in in the avatar app is unnecessary.
  Browser/computer tools need your own connected setup and macOS permissions.
- Codex permissions default to Full access. You can choose Ask for approval or
  Approve for me in Settings or the avatar's right-click menu.
- OpenClaw, Hermes and Grok Build are alternative reasoning/action engines in v0.2.10.
  Install and configure the chosen runtime with your own account; the avatar
  installer does not bundle it. Select its provider in Reasoning, enable
  actions, then choose native agents/profiles in **Agents for each character**.
  Missing runtimes are disabled. With direct API/OAuth reasoning, the action
  engine can be selected separately. See [AGENT-RUNTIMES.md](AGENT-RUNTIMES.md)
  for setup, Hermes OpenAI OAuth2, profile routing and native permission limits.
- The old built-in file/browser action engine has been removed. Browser/computer tools and file permissions belong to the selected external runtime. Right-click **Delegate Reasoning Provider** to switch the engine and configure its separate permission choice.
- Native agents, Hermes profiles and account sign-ins are not shipped in this
  repo or DMG. The owner's locally configured Hermes `tia` profile is an example,
  not an account your clone inherits. Ordinary visual feature work needs none
  of these runtimes.

See [Codex actions](CODEX-ACTIONS.md) and
[Together conversations](GROUP-CONVERSATIONS.md).

### Usage costs

The local Codex app-server connection has no separate connection fee. Codex
tasks authenticated with ChatGPT consume that account's subscription allowance;
API-key authentication uses separately billed API usage. Subscription limits
still apply, and additional credits or third-party services can cost extra.
See [Codex authentication](https://learn.chatgpt.com/docs/auth) and
[usage limits](https://learn.chatgpt.com/docs/pricing).

GPT-Live voice uses the app's API key. As of September 15, 2026, the rate is
$0.05 per connected session-minute, billed per second. Together opens one
session per character: five connected characters are approximately $0.25/minute
or $15/hour for voice alone, even when they take turns speaking. Group human
input also uses the separately billed `gpt-4o-mini-transcribe` API. API-key
reasoning backends and paid external tools are additional. Stop live talk to end
the voice sessions; muting the microphone does not disconnect them.
See [GPT-Live pricing](https://developers.openai.com/api/docs/models/gpt-live-1).

## Keep the current R2 connection

Keep `electron/asset-download.json`, the protected loader and the imported
runtime configuration/catalogue compatible. Ordinary UI and behavior changes,
app version changes and your local build do not require a new bucket or Worker.
The existing gateway checks the download token; it does not require the
original Apple signing identity. A new profile obtains its own locally stored
unlock keys through that gateway.

Do **not** run `build-protected-assets`, `tools/cloud/deploy.cjs`,
`tools/cloud/upload-r2.cjs` or rotate keys for feature-only work. Those are
maintainer publishing operations, not developer setup. Do not commit imported
resources, raw models, runtime download tokens, personal profiles or credentials.
Do not request the owner's Cloudflare administration token, private-build.json,
model content keys or Apple signing credentials.

The shared gateway has a hard daily request cutoff. If it is unavailable or
returns a limit error, leave the configuration intact and retry later. This
workflow downloads existing content; it never creates billable cloud resources
or uploads duplicate models. See [protected delivery](PROTECTED-ASSETS.md).

## Build a local test app or DMG

```bash
npm test
npm run pack:local       # unsigned local .app in dist/mac-arm64/
# Or, when you need a local installer:
npm run dmg:local        # unsigned, unnotarized local DMG in dist/
```

These commands explicitly disable Apple identity discovery and notarization, so
they do not need the owner's Apple account. Local outputs are for development;
they do not have the official release's Gatekeeper acceptance. Test a local app
with a separate profile to avoid replacing normal app settings:

```bash
"dist/mac-arm64/GPT-Live Avatar.app/Contents/MacOS/GPT-Live Avatar" \
  --user-data-dir="$PWD/build/packaged-test-profile"
```

A publicly distributed signed/notarized release needs the responsible
publisher's own Apple Developer ID and notarization setup. `npm run dmg` is the
maintainer signing workflow; do not use it expecting the owner's credentials to
exist. A source branch or local build does not automatically publish a GitHub
release. Push your branch and open a PR if you have repository access; otherwise
use your own fork. The 3D asset licenses are separate from source-code rights.

Right-click → **About GPT-Live Avatar** shows the installed version and bundled
description; **Check for Updates…** queries this repository's published releases
on demand. It opens the official download and does not auto-install. If you
distribute a separate app/fork, update `electron/releases.cjs` and
`electron/release-info.json` for your own release destination and description;
an EnConvo integration should use EnConvo's updater. Keep the R2 asset service
configuration separate from the app-update destination.

## What to test before handing back changes

1. `npm test` passes. It uses generated fixtures; no original Blender files,
   API key or live microphone is needed.
2. Start with a fresh `--user-data-dir` and confirm bundled Tia unlocks and
   renders. Check Settings opens without a voice key. Do not delete your normal
   app profile to simulate a new user.
3. In the development/test profile, download a second character and verify it
   renders. Restart and confirm the downloaded character remains available.
4. Exercise the feature you changed in solo and Together where relevant.
   Check right-click controls, drag/resize, transparency, task progress and
   addressed-character routing. Live tests need your own account and may incur
   its normal API usage.
5. Keep source changes separate from assets and credentials. Run `git status`
   before committing. Report your macOS version, hardware, tested features and
   any remaining issue; do not claim another machine was tested.

Useful entry points: `electron/main.cjs` (desktop windows/settings),
`web/avatar.html` (solo UI), `web/group.js` (Together),
`electron/codex-agent.cjs` (Codex tasks), `electron/agent-permissions.cjs`
(permissions), `electron/runtime-agents.cjs` / `electron/acp-agent.cjs`
(OpenClaw/Hermes/Grok tasks and native agent assignments), `electron/app-info.cjs` (version and
updates), and `web/agent-progress.js` (overhead task updates).
