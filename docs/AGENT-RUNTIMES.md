# Local agent engines

GPT-Live Avatar v0.2.9 can use Codex App Server, OpenClaw or Hermes for delegated reasoning and enabled actions. These are separate local runtimes. Installing the avatar app does not install them or configure their provider accounts.

## Choose a connection

- **Codex:** Settings → Reasoning → Delegate mode → OpenAI → Codex App Server. Uses local Codex sign-in and tools. See [CODEX-ACTIONS.md](CODEX-ACTIONS.md).
- **OpenClaw:** Settings → Reasoning → Delegate mode → OpenClaw. Install/configure OpenClaw and keep its gateway running. Verify `openclaw agents list --json` and `openclaw acp --help` locally. The gateway controls each agent’s model.
- **Hermes:** Settings → Reasoning → Delegate mode → Hermes. Install Hermes with ACP support and verify `hermes acp --check`. Configure its provider with `hermes model` or its native configuration tools. The app lists the models advertised by ACP; a listed model still requires an eligible configured account.

When a runtime is selected for reasoning, enabled actions use the same runtime. To retain direct API/OAuth reasoning, choose the action engine separately under Actions and page context. An unavailable selected runtime produces a setup error; the app does not silently substitute Codex or an API provider.

Voice and voice previews still use the OpenAI voice API key, and existing transcription usage is unchanged. Local runtimes use their own provider credentials and billing/allowance. GPT-Live Avatar neither copies nor embeds their OAuth tokens.

## Assign an agent to each avatar

Settings → **Agents for each character** lists all five characters, with separate OpenClaw-agent and Hermes-profile dropdowns. Refresh after installing a runtime or creating an agent. The chosen reasoning/action engine determines which column is active.

OpenClaw discovery uses `openclaw agents list --json`. Requests open isolated ACP sessions with `agent:<agent-id>:gpt-live-avatar:<uuid>` routing. Hermes uses its official named profiles: each selected profile is started with `hermes --profile <id> acp`. The blank Runtime default choice follows the native default at task start. Explicit assignments remain pinned; deleted profiles/agents cause an error instead of falling back to someone else. Changing the selection cancels current tasks but retains actions already completed.

Hermes profile example (does not change its sticky global default):

```sh
hermes profile create tia --no-alias --description "Tia desktop companion"
hermes --profile tia config set model.provider openai-codex
hermes --profile tia config set model.default gpt-5.6-sol
hermes --profile tia config set model.base_url https://chatgpt.com/backend-api/codex
hermes --profile default auth add openai-codex --type oauth
hermes --profile tia auth status openai-codex
```

Complete the browser sign-in started by Hermes. In Hermes v0.21.3, a fresh named profile can report successful `auth add` without persisting its first OAuth credential. Authenticating the default Hermes profile and using Hermes’s native per-provider credential fallback works; do not copy or manually forge token files. The Tia profile retains its own personality, model, skills, memory and sessions while the runtime manages the shared sign-in. Availability of Sol depends on the signed-in account.

## Tools, permissions and task updates

Both adapters use ACP over a private child process’s stdin/stdout. They stream public progress and verified tool results to the addressed avatar’s overhead bubble. Private thought events are ignored. Solo and Together share the same backend; Together passes the addressed character plus the shared conversation and completed-action receipts.

Code, shell and general file work use the runtime’s own tools. Avatar movement, animation and current-page extraction use a short-lived loopback endpoint restricted to the existing app tool allowlist. The runtime accesses it with its native terminal tool. It has a random per-task secret, rejects browser-origin requests, expires at completion/cancellation, and is never a public server. An agent needs a working terminal tool to invoke these avatar-specific controls. This is used because the installed OpenClaw ACP bridge does not accept per-session MCP servers.

The runtime retains its own security configuration. The app can either ask when ACP requests approval or allow a request once for the current task; it never installs a permanent allowlist entry. Codex automatic review/sandbox semantics are not claimed for these other runtimes. Native OS permissions and external app prompts may still appear. The installed OpenClaw/Hermes bridges do not expose a tool-free mode, so actions must be enabled to use them; use Codex or an API connection for reasoning with actions disabled.

Tasks use isolated sessions, a ten-minute request timeout, explicit cancellation and bounded protocol messages. Cancellation cannot undo already completed external work. Global runtime settings, gateway permissions and default agents are not modified by choosing an avatar assignment.

## Verification

`npm test` covers routing, model selection, cancellation, approval denial, public progress, endpoint restrictions and release checking. For opt-in live tests against your configured accounts:

```sh
./node_modules/.bin/electron qa/runtime-app.cjs --live
```

This uses a disposable app profile, local avatar assets under `build/characters`, and files under `build/qa-runtime-app/files`. It makes real model/tool requests through Hermes and OpenClaw and checks solo/Together profile routing, file creation/readback, Sarah’s avatar motion receipt and Settings/About screens. It does not open the microphone or create voice sessions. The local test fixture expects OpenClaw `main` and Hermes `default`/`tia`; adapt those IDs for another machine.

Validated with OpenClaw 2026.9.4 and Hermes 0.21.3. Browser/computer capabilities depend on the chosen runtime’s installed tools and accounts; connecting ACP does not grant every Codex capability automatically.
