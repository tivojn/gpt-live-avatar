# GPT-Live Avatar

[Download the signed and notarized Mac installer](https://gpt-live-avatar-downloads.gpt-live-avatar-downloads.workers.dev/releases/).
That page lists the current version, its SHA-256 checksum and the Apple Silicon DMG;
`releases/latest.json` on the same host is the machine-readable release record.
Open the DMG, copy GPT-Live Avatar to Applications, and launch it. Encrypted Sarah
is included; the first launch needs internet for a brief unlock. Sarah is the
default avatar, wearing **Tie top, chain pants & sandals** without the coat or a prop.

## Getting started from a clone

**Coworkers and AI coding assistants: start with [the independent development handoff](docs/DEVELOPER-HANDOFF.md).** It covers using the existing R2 service, running feature changes with isolated settings, and building without the owner's Apple credentials.

The renderer and application code are public. Purchased character assets are
separately licensed and must not be redistributed as raw models or texture ZIPs.
Install the official Mac app first, then:

```bash
npm ci
npm run import-release -- "/Applications/GPT-Live Avatar.app"
npm test
npm run start:isolated
```

The import command verifies and reuses only the encrypted client resources
already included in the release. These remain ignored by Git. No Cloudflare
login or owner API keys are required. Use your own voice and Codex accounts.

The Mac release uses protected downloads from a private Cloudflare R2 bucket.
The v0.2.15 installer includes Sarah’s existing encrypted base and matching motion
package, plus the signed catalogue. First launch briefly connects to unlock Sarah;
subsequent launches work offline. This starter change uses the existing R2 packages.
Choose other characters in **Settings → Avatar**, download their base packages, then
optionally add Balanced (2K) or Best (4K) textures. All five current characters
retain their wardrobe, colors, props, expressions and motion libraries.
Downloaded packages remain encrypted on disk. Content keys are delivered to the
app separately and stored using macOS secure storage; they are not in the
source repository or public installer. See the
[protected asset deployment guide](docs/PROTECTED-ASSETS.md) for the build,
storage cap, traffic limits and protection boundaries.

Older installers and the legacy iOS downloader use the retired raw-file format.
Existing local packages still work. The iOS source requires a protected-loader
port before a new public iOS release; its old GitHub download URLs are not a
supported distribution path.

## Avatar Show · Playwright & Director

The Avatar Show window puts on a play. Tell the **Director** what you want, by
voice (a GPT-Live session) or text. When you are ready, the **Playwright**
(your selected reasoning account) writes a structured script: scenes, roles,
lines, and a motion plus facial expression for every line, chosen from the
characters' installed motion libraries. Motions the script needs but no
character has are generated with Meshy text-to-motion, checked for facing,
retargeted in Blender and installed into every character's library, when
`~/.config/gpt-live-avatar/show-motion.json` provides `meshyApiKey`,
`rigTaskId`, `blend` and the Blender and `uv` paths; otherwise the Director
uses the closest installed motion and says so. The characters then perform
with their GPT-Live voices, and the Director asks for feedback; the script can
be revised or played again.

Tick **I'll act a role** to be cast yourself. A prompter shows each of your
lines; read it aloud into the microphone, type it, or press **I'll pass** (or
simply wait) and the standby character delivers it. When you act, pick at
least two characters: one performs, one stands by for lines you pass.
See [Avatar Show details](docs/AVATAR-SHOW.md).

## Together live conversations

Right-click an avatar and choose **Avatar Show · Playwright & Director**. The
window opens with the show format selected; choose **Have a conversation** (or
one of the other formats) for the earlier free conversation. Each character
keeps independent drag, pinch, rotation and right-click controls. Transparent
spaces let clicks reach the app underneath. Drag the Together title bar, resize
its bottom-right corner, or minimize it to a title bar while talk continues.

The five characters start with feminine voices; voice choices are saved per
character. Speech is indicated by the overhead wave and highlighted name,
without a body shake or speech-driven camera zoom. With actions enabled in
Settings, a human's spoken or typed file/page request uses the same real tools
as solo mode. Address a character by name; it reports the verified outcome.

Solo and Together recognize mouth shapes directly from streaming audio using
a small local 15-viseme model. **Conversation sounds** in Voice settings enables
short sci-fi connecting and ending cues. See [lip-sync details and testing](docs/LIP-SYNC.md).

All participants share the dialogue and verified file results. For example,
ask Tia to create a file and Sarah to delete “that file”; removal uses the
Mac's recoverable Trash. A greeting such as “Hi Tia…” selects Tia and keeps
follow-up replies with her until you address someone else. Say “Everyone,
continue the conversation” to return to the roundtable.
See [shared context and live input](docs/GROUP-CONVERSATIONS.md) for details.

For shell commands, code execution, file editing, screenshots and connected
browser/computer tools, choose **Codex** as the action engine in Settings.
Both solo and Together use the real installed Codex engine and its account.
See [Codex actions and setup](docs/CODEX-ACTIONS.md).

## Instinct · reflexes from a System One model (optional)

Add a [TypeSafe](https://typesafe.ai) key in Settings and the avatar gains
reflexes. Jev, a model that cannot talk and answers typed questions in about a
third of a second, decides whether she just committed to a motion and which
installed clip fits, so the motion starts while she is still saying the
sentence, and her face responds while you are still speaking. GPT-Live stays
the only voice. Without a key, or whenever Jev is slow or unsure, the built-in
rules decide as before. See [Instinct](docs/INSTINCT.md).

## Avatars and texture tiers

The updated local Mac portrait build includes Tia's original 2K/4K maps,
authored lighting environment and 4K color variants. Best selects these
installed originals; Balanced and Friendly retain smaller texture budgets.
Rebuild that package with `tools/complete-tia-colors.py --textures <original textures>
--package build/assets/bundle/tia --resident <matching original resident folder>
--environment <studio.rgba16f>` after the base asset build. Use
`tools/export-tia-lighting.py` in Blender to convert the original lighting EXR.
`qa/portrait-app.cjs` verifies the real renderer, quality transitions and timing.
`tools/export-tia-expressions.py` restores three original open-mouth expressions
as GPU position/normal morphs. It also exports a separately identified custom
jaw refinement, now disabled to retain Tia's original jaw proportions. Run it in Blender
against the original `.blend` with `-- --package build/assets/bundle/tia` after
building the appearance pack. The source file is never saved by the exporter.

Pipeline (`tools/`):

- `build-assets.py <openclam avatar dir> <slug>`: bundle package, tier zips,
  iOS 1K/2K/4K GLBs, catalogue entry (`build/assets/`).
- `inject-library.py in.glb out.glb [clip.json]`: embeds the `openclamAvatar`
  options library (rig bones the motion clips drive), fixes cornea materials
  and rebinds unweighted vertices; needed for models not built by OpenClam.
- Sarah comes from the Auto-Rig Pro Sara blend
  (`~/Downloads/Sara-003_ARP3`), exported headless with Blender
  (materials flattened to Principled BSDF, hair bound to the head bone), then
  `inject-library.py`, OpenClam's `avatar_resources.py` for the resident
  texture tiers, and `build-assets.py`.
- Sarah's complete original wardrobe, props, facial expressions, colors and
  smooth surfaces: [rebuild and verification guide](docs/SARAH-ASSETS.md).

Mac: after configuring the verified R2 gateway and private release files, run
`npm run pack` (app folder) or `npm run dmg` (installer). Both include encrypted
Sarah with her matching motion overlay, the signed catalogue and app connection information. Raw models and
content keys are never bundled.
Notarization: put an App Store Connect API key (Developer role) at
`~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8` and create
`~/.config/gpt-live-avatar/notarize.env` exporting `APPLE_API_KEY` (path),
`APPLE_API_KEY_ID` and `APPLE_API_ISSUER`; `npm run dmg` then notarizes and
staples automatically. Without that file the DMG is signed but not notarized.


## Desktop controls

[Live group conversations](docs/GROUP-CONVERSATIONS.md): two to five characters, optional human participation, spoken actions and speech interruption.

Avatar and voice selection, voice previews, reliable bubble modes and Tia's original colors: [usage and verification](docs/DESKTOP-CONTROLS.md).

## Handoff for other hosts (EnConvo)

See [the EnConvo integration handoff](docs/ENCONVO-HANDOFF.md) for the v0.2.15
component map, current audio-to-viseme pipeline, protected R2 setup, proposed
host adapter and staged acceptance checks. EnConvo keeps its own credentials,
voice/delegate sessions, reasoning and agentic tools; this repository supplies
the avatar layer. Native audio/webview adaptation still needs implementation.


Desktop Delegate mode supports OpenAI and xAI reasoning with API keys or account
sign-in. OpenAI also offers **Codex App Server** under Authentication: it reuses
your local Codex sign-in and selected model for both reasoning and enabled
actions in solo and Together. Use **Settings → Reasoning → Delegate mode**.
GPT-Live voice still needs an OpenAI API key. Defaults, authentication behavior,
and test commands are documented in [Desktop controls](docs/DESKTOP-CONTROLS.md#delegate-mode).

## Local agent engines

Settings is a sidebar of panes (Voice, Character, Appearance, Reasoning, Actions, Agents, Instinct, Shortcuts and tips), each with a one-line status. The whole app shares one monochrome theme that follows the macOS light or dark appearance.

Settings supports **Codex App Server**, **OpenClaw**, **Hermes**, **Grok Build** and **EnConvo** for delegated reasoning and enabled actions. Choose the runtime under Reasoning, then use **Agents for each character** to select an OpenClaw agent, Hermes profile or EnConvo agent (Mavis or any custom agent) for each avatar. Missing installations are disabled. Each runtime uses its own configured account and tools; GPT-Live voice still uses the voice API key. See [setup and connection details](docs/AGENT-RUNTIMES.md).

The right-click menu is grouped: talk and **Ask…** at the top; **Perform** (motions by category, Dance Along, Stay Still, Stop), **Look** (outfit, pose, props, accessories, expression, lighting, colors), **Character** (avatar and voice), **Agent** (reasoning provider and action permissions) and **View** (bubble, close-up, bring back) in the middle; **Avatar Show**, **Settings…**, **Check for Updates…** and the installed version at the bottom. The version is always visible there; **Check for Updates…** opens the window with the release description and official downloads (it replaced About), and the row reads **Update to …** when a newer version is known. From there you can **Download** the update and **Install and Relaunch**: the installer is checked against the published checksum, the developer's signature and Apple's notarization first, and the old version goes to the Trash. The app checks quietly once after launch and otherwise on demand; it reads `releases/latest.json` from the private release service; no GitHub account or public repository is involved.
