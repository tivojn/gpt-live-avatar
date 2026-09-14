# Codex actions

Choose **Settings → Actions and page context → Action engine → Codex**, then
**Check Codex**. Codex must be installed and signed in on this Mac. This is the
actual Codex app-server engine, not a prompt that imitates it. Voice still uses
the app's voice API key; Codex uses its own existing account and configuration.

Codex can run shell commands and code, inspect and edit files, use images, and
call its configured MCP tools. The application contributes tools for moving
and animating the visible characters. API-key Codex accounts default to
`gpt-5.6-luna`; ChatGPT accounts default to `gpt-5.6-sol`. A model override is
available in Settings. The full dropdown includes GPT‑5.6 Sol, Terra, Luna, and
GPT‑6 Astra, with a custom model option. Account availability is checked by
Codex itself. The desktop engine is preferred over older standalone CLI
installations; GLA_CODEX_PATH can explicitly select a different executable.

Choose **Codex permissions** in Settings or any character’s right-click menu:

- **Ask for approval**: work in the selected folder; ask for additional access.
- **Approve for me**: use Codex’s own risk reviewer for additional access requests.
- **Full access**: allow files, commands and internet without execution prompts.
  This is the default for new profiles. Existing saved choices are preserved.

The choice is shared by solo and Together and persists across restarts. Changing
it stops current tasks before the next request uses the new policy. Unknown
saved values fall back to Ask for approval. macOS, connected apps and Computer
Use retain their own permission flows. Completed actions remain after stopping.

Approve for me uses `on-request`, `workspace-write` and
`approvalsReviewer: "auto_review"` in the Codex app server. It does not locally
accept approval requests. A denial can block an action or require user input;
managed Codex restrictions still apply. See [Codex Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review).

Browser/computer control depends on the connected tools, not just the language
model. On a Mac with the Codex Computer Use plugin configured, its `cua_repl`
tools can be reached through the app-server connection. Keep the desktop host
running and grant its macOS Screen Recording/Accessibility and app/site
permissions as required. **Check Codex** reports tool availability. A standalone
CLI installation does not include the desktop browser automatically. The app
does not install hidden GUI automation or bypass the plugin's approvals.

Examples:

- “Sarah, run Python to calculate the totals and save a CSV on my Desktop.”
- “Tia, read that CSV and make a chart.”
- “Sarah, look at this browser page and tell me what you think.”
- “Tia, use the browser to open the preview and test the buttons.”
- “Sarah, use Calculator and verify the result from a screenshot.”

Solo and Together use the same engine. Named requests and their verified tool
results keep the addressed character's identity. The other participants receive
the conversation and action context, including command results and file paths.
They do not receive another character's audio as fabricated human input.

The routing regression from the promo is covered by replaying the original
paused “Sarah” audio through the microphone worklet, voice gate, transcription,
and real Codex backend. Pending recognition retains the original audio buffer.
A recognized name alone selects the listener and waits for the instruction.

Validation includes real Python/file execution, a Tia-to-Sarah file handoff,
browser clicks plus a screenshot read, native Calculator use, cancellation,
denied approvals, and stale tool-call rejection. The Codex process starts on
demand and shuts down after a minute without work.

References: [Codex App Server](https://learn.chatgpt.com/docs/app-server),
[Computer Use](https://learn.chatgpt.com/docs/computer-use),
[Browser](https://learn.chatgpt.com/docs/browser).

Task progress appears in the addressed avatar’s overhead bubble in solo and
Together mode. Public Codex commentary streams into the bubble; tool activity
uses readable labels. Private reasoning and raw command output are excluded.
Auto mode keeps the bubble visible until the task finishes, then briefly shows
the result. Bubble Off still hides it. Cancelling or starting a newer task
prevents late updates from replacing the current task.
