# Windows

One codebase, a small platform layer. Started 2026-09-19 on Windows 11 (10.0.26200), RTX 4090, one 4K
display at 250 % scaling, Node 22. Releases are still cut on the Mac; nothing here touches that flow.

## Run and build

```powershell
npm.cmd ci
node node_modules\electron\install.js      # only if npm ci did not fetch Electron's binary
$env:ELECTRON_RUN_AS_NODE=$null            # if set, Electron runs as plain Node
.\node_modules\electron\dist\electron.exe .
```

Not in git, copied from a Mac that has them: `build\assets\bundle\<slug>` (encrypted `.gla` packs),
`build\protected\index.json`, `build\protected\assets-runtime.json` (holds the download token: never print
or commit it).

| | |
|---|---|
| `npm.cmd test` | the whole pure-Node suite; passes on Windows |
| `npm.cmd run pack:win` | unpacked app in `dist\win-unpacked` (runs `tools/verify-release.cjs` first) |
| `npm.cmd run dist:win` | unsigned NSIS installer, x64, per-user: `dist\gpt-live-avatar-<version>-win-x64.exe` |
| `electron.exe qa\windows-first-run-app.cjs [--no-flourish] [--no-motion]` | first-run probe: isolated profile, no keys, nothing spent; facts in `build\qa-first-run\report.json`, pictures of the app's own windows only |
| `node qa\windows-packaged-check.cjs` | starts the BUILT app with a throwaway profile and asks its pages over a local DevTools port: avatar unlocked, drawn, Settings opens |

`verify-release` wants the starter packs the signed catalogue names under
`build\protected\starter\sarah\{base,motions}.gla`, in the catalogue's revision, or it refuses, rightly.
`electron.exe tools\fetch-starter.cjs` fetches them with the app's own downloader (every part and the whole pack
checked against the signed catalogue; about 650 MB and a dozen requests of the service's daily limit; packs that
already match are not fetched again), and hard-links them into `build\assets\bundle\sarah` for development
runs. A pack it replaces is renamed `*.superseded-<time>`, never deleted.
The installer is unsigned until there is a certificate, so SmartScreen warns.

## What differs from macOS

- **Tray icon** (`installTray` in `electron/main.cjs`, `electron/tray.ico`): no Dock, and her window is not in
  the taskbar. Click shows her; right-click has Show Avatar, Bring Avatar Back, Avatar Show, Settings, updates,
  Quit. Her frameless window ignores a polite close request (`taskkill` without `/F`); Quit is in the menus.
- **Agent engines start without a shell** (`electron/win-command.cjs`). `npm install -g` leaves three shims
  (`name`, `name.cmd`, `name.ps1`); none can be spawned directly and this app never uses a shell. Codex: the
  native `codex.exe` inside the npm package is started (`electron/codex-client.cjs`). Script engines
  (OpenClaw): the `.cmd` shim is read, never run; the script it names must lie inside the shim's folder and is
  started as `node.exe <script>`. OpenClaw refuses older Node versions, so the one it installs for itself
  (`~\.openclaw\tools\cli-node`) comes first. OpenClaw's ACP bridge needs its gateway
  (`openclaw gateway`); when it is down the app says so. Hermes and Grok Build are looked for as `.exe`
  (`venv\Scripts`, `~\.grok\bin`, the path) and have not been tried on Windows. EnConvo is a Mac product.
- **Codex CLI 0.121 and earlier** refuse `app-server --stdio` (stdio is their default). The client retries
  once without the flag, only when the flag itself was refused.
- **Child environment** (`electron/child-env.cjs`): a copy of `process.env` is case-sensitive and Windows
  calls the variable `Path`. Writing `env.PATH` adds a second one that wins and drops the system's folders.
- **Names inside an avatar package and URLs always use `/`.** Never build them with `path.join`; disk paths
  always are.
- **Dance Along** is a macOS Core Audio tap. Off macOS the row is disabled and says so; `osascript` is never
  started. A spoken request answers "The audio listener is not available on this system." (Phase C.)
- **Updates**: the window says in-app install is not available on Windows yet. `electron/releases.cjs` offers
  no installer off macOS, so the macOS verifier is never reached. (Phase B.)
- **DPI rounding**: at 250 % a 360 x 510 window is created 360 x 512 and comes back from the stage 362 x 512.
  Never wait for an exact size or compare bounds for equality; `stageGrown` allows 2 px.
- **Checkouts are CRLF** (`core.autocrlf=true`). Tests that match source text use `\r?\n`.

## Found on Windows, fixed for every platform

- She went into the full-display stage window while standing still (first at once, then about 12 s in, then
  whenever an idle pose spread her arms or shifted her weight). The overflow test now measures her without the
  render rectangle's breathing room, bone by bone rather than by the corners of one box around her, from the
  vertices a bone mostly moves, and downwards by her feet (layout bounds and joints) rather than by the box around
  a sandal, whose corner lies under the floor (`points.tight` from `meshPoints()` in
  `web/avatar3d-options.js`; the decision is in the paint loop of `web/avatar.html`). The loose corners still size the render rectangle, so nothing is clipped.
  `window.gla_overflow` records the first time she did not fit, and why.

## Not done

- A person at the machine: a real conversation (echo on speakers, both voice systems), dragging to the
  screen edges, click-through around her at 250 %, flicker when the window resizes (captures show none).
- App-level QA scripts that link `build/characters` with `fs.symlinkSync`, use `say` or `osascript`.
- Running the installer end to end (install, first start, uninstall) on a clean account.
- Code signing, a Windows update path (Phase B). System-audio dancing (Phase C).
