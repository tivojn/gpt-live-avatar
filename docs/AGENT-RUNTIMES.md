# Local agent engines

GPT-Live Avatar v0.2.11 can use Codex App Server, OpenClaw, Hermes or Grok Build for delegated reasoning and enabled actions. These are separate local runtimes. Installing the avatar app does not install them or configure their provider accounts.

## Choose a connection

- **Codex:** Settings → Reasoning → Delegate mode → OpenAI → Codex App Server. Uses local Codex sign-in and tools. See [CODEX-ACTIONS.md](CODEX-ACTIONS.md).
- **OpenClaw:** Settings → Reasoning → Delegate mode → OpenClaw. Install/configure OpenClaw and keep its gateway running. Verify `openclaw agents list --json` and `openclaw acp --help` locally. The gateway controls each agent’s model.
- **Hermes:** Settings → Reasoning → Delegate mode → Hermes. Install Hermes with ACP support and verify `hermes acp --check`. Configure its provider with `hermes model` or its native configuration tools. The app lists the models advertised by ACP; a listed model still requires an eligible configured account.

- **EnConvo:** Settings → Reasoning → Delegate mode → EnConvo. Keep the EnConvo app open; the adapter talks to its local API (default `http://localhost:54535`, configurable under Service URL) with `POST /api/agent/session/new` then `POST /api/agent/messages`, one session per request. Agents are listed from `GET /api/agent/list`: Mavis (`main`) is the default and every custom EnConvo agent is selectable per character. Each agent keeps its own model, tools, account and permissions inside EnConvo; the app shows no model picker for it. Verify with `curl http://localhost:54535/api/agent/list`.
- **Grok Build:** Install Grok Build and complete its native `grok login`. Select Grok Build in Reasoning and check the connection. The adapter launches `grok --no-auto-update agent --no-leader stdio`, authenticates with its cached native login (or native `XAI_API_KEY` environment credential), and lists models advertised by the agent. It is the real agent runtime, not a direct xAI chat API relabelled as an agent. See [Grok headless scripting](https://docs.x.ai/build/cli/headless-scripting).

Right-click **Delegate Reasoning Provider → provider** to choose reasoning. **Action Engine & Permissions → provider** contains that engine’s permissions and the option to use it for actions. The active action engine is checked and named explicitly. Missing installations are disabled.

**Follow reasoning agent** is on by default: OpenClaw reasoning uses OpenClaw actions, for example. Choose a different action engine to turn following off. It stays selected when you change reasoning later. Direct API/OAuth and managed reasoning have no native action engine, so following uses the saved external action-engine choice. When the two engines differ, their models and permissions stay independent. An unavailable selected engine reports setup is needed; there is no silent fallback.

The built-in action engine, file tools and app-owned page extraction were removed in v0.2.10. Old `basic` engine selections migrate to Codex; following uses a selected external reasoning engine. If it is unavailable, the app reports setup is needed. No local file-tool fallback remains. Browser/computer use belongs entirely to the selected agent; configure those connections there. The starting folder is its working directory, not an app-enforced file boundary. It defaults to `~/Downloads` in v0.2.14; Settings can change it. Typed requests and runtime questions are entered directly in each avatar’s overhead bubble.

Voice and voice previews still use the OpenAI voice API key, and existing transcription usage is unchanged. Local runtimes use their own provider credentials and billing/allowance. GPT-Live Avatar neither copies nor embeds their OAuth tokens.

## Assign an agent to each avatar

Settings → **Agents for each character** lists all five characters, with separate OpenClaw-agent, Hermes-profile and EnConvo-agent dropdowns. Refresh after installing a runtime or creating an agent. The chosen reasoning/action engine determines which column is active.

OpenClaw discovery uses `openclaw agents list --json`. Requests open isolated ACP sessions with `agent:<agent-id>:gpt-live-avatar:<uuid>` routing. Hermes uses its official named profiles: each selected profile is started with `hermes --profile <id> acp`. EnConvo lists its agents by their command name (`main` for Mavis, plus custom agents) and opens a titled session per request. The blank Runtime default choice follows the native default at task start. Explicit assignments remain pinned; deleted profiles/agents cause an error instead of falling back to someone else. Changing the selection cancels current tasks but retains actions already completed.

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

The ACP adapters use ACP over a private child process’s stdin/stdout. They stream public progress and verified tool results to the addressed avatar’s overhead bubble. Private thought events are ignored. Solo and Together share the same backend; Together passes the addressed character plus the shared conversation and completed-action receipts.

Code, shell and general file work use the runtime’s own tools. Avatar movement and animation use a short-lived loopback endpoint restricted to the three visual tools: `avatar_state`, `move_avatar`, and `play_motion`. The runtime accesses it with its native terminal tool. It has a random per-task secret, rejects browser-origin requests, expires at completion/cancellation, and is never a public server. An agent needs a working terminal tool to invoke these avatar-specific controls. This is used because the installed OpenClaw ACP bridge does not accept per-session MCP servers.

The runtime retains its own security configuration. The app can either ask when ACP requests approval or allow a request once for the current task; it never installs a permanent allowlist entry. Codex automatic review/sandbox semantics are not claimed for these other runtimes. Native OS permissions and external app prompts may still appear. The installed OpenClaw/Hermes/Grok bridges and EnConvo agents do not expose a tool-free mode, so actions must be enabled to use them; cancelling an EnConvo request stops waiting for it but cannot interrupt work the agent already started inside EnConvo; use Codex or an API connection for reasoning with actions disabled.

Tasks use isolated sessions, a ten-minute request timeout, explicit cancellation and bounded protocol messages. Cancellation cannot undo already completed external work. Global runtime settings, gateway permissions and default agents are not modified by choosing an avatar assignment.

## Verification

`npm test` covers routing, model selection, cancellation, approval denial, public progress, endpoint restrictions and release checking. For opt-in live tests against your configured accounts:

```sh
./node_modules/.bin/electron qa/runtime-app.cjs --live
```

This uses a disposable app profile, local avatar assets under `build/characters`, and files under `build/qa-runtime-app/files`. It makes real model/tool requests through Hermes, OpenClaw and Grok Build and checks solo/Together profile routing, file creation/readback, Sarah’s avatar motion receipt and Settings/About screens. It does not open the microphone or create voice sessions. The local test fixture expects OpenClaw `main` and Hermes `default`/`tia`; adapt those IDs for another machine.

Validated with OpenClaw 2026.9.4, Hermes 0.21.3, Grok Build 1.0.5 and EnConvo 2.5.6 (local API 1.0.0). Browser/computer capabilities depend on the chosen runtime’s installed tools and accounts; connecting ACP does not grant every Codex capability automatically.
