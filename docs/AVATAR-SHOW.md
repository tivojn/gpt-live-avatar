# Avatar Show · Playwright & Director

The Avatar Show window (right-click an avatar → **Avatar Show · Playwright &
Director…**) stages a short play with the installed characters. It replaces
the earlier *Bring Characters Together* entry; the free conversation is still
available as the **Improvise together** format in the same window.

## Flow

1. **Brief the Director.** Choose the characters, optionally tick *I'll act a
   role* and give your name, then talk to the Director. *Talk to the Director*
   opens one GPT-Live voice session that stays open for the whole visit; the
   text box works without a microphone. The Director discusses the idea, asks
   what is unclear and remembers the conversation.
2. **Prepare the show.** Say something like "I'm ready, prepare the show"
   (or 准备开始吧), press **Prepare the show**, or wait for the Director to call
   "Places, everyone!". The **Playwright** — the reasoning model selected in
   Settings, through the long delegation path — writes a JSON script: title,
   synopsis, cast, scenes, and for every line the speaker, text, motion and
   facial expression. Motions are limited to what the characters have
   installed; up to three missing motions can be requested with a Meshy prompt
   and an installed fallback.
3. **Custom motions.** Each requested motion is generated with Meshy
   text-to-motion, checked so the character keeps facing the audience (one
   retry with a stricter prompt), retargeted in Blender onto the character rig
   and installed into every character's motion library. Progress is shown in
   the panel. When the tools are not configured or a motion fails, the
   Director says so and uses the fallback motion.
4. **Performance.** Lines play in order: motion and expression start, the
   character speaks with its GPT-Live voice, the bubble and transcript show
   the line. Your lines appear in the prompter at the bottom of the screen:
   read the line aloud (the Director's microphone hears it), type it and send,
   press **I said it**, or press **I'll pass**. If nothing arrives within 25
   seconds the standby character takes the line. **Standby takes the rest**
   hands all remaining lines to the standby.
5. **Curtain call.** The Director asks how it was. Say what to change and
   press **Revise the show** (or say "revise the script"); the Playwright
   rewrites with the previous script and your feedback. **Play it again**
   repeats the performance.

Say **stop** or press **Stop** at any time; the Director keeps the script.

## Custom motion configuration

Create `~/.config/gpt-live-avatar/show-motion.json` (mode 600):

```json
{
 "meshyApiKey": "msy_…",
 "rigTaskId": "<Meshy rigging task id of the shared rig>",
 "blender": "/Applications/Blender.app/Contents/MacOS/Blender",
 "uv": "/Users/you/.local/bin/uv",
 "blend": "/path/to/Tia-001.1.blend",
 "donor": "tia"
}
```

`MESHY_API_KEY` and `MESHY_RIG_TASK_ID` in the environment are accepted as
well; `GLA_SHOW_MOTION_CONFIG` points at a different file. Generation costs
Meshy credits (about 13 per attempt). Work files live under
`build/show-motions/` next to the app root; library backups are taken before
the first change to each character.

## Files

| File | Role |
| --- | --- |
| `electron/show.cjs` | IPC: Playwright, Director (text and live), pipeline status, generate, cancel |
| `electron/show-script.cjs` | Casting, Playwright brief, script parsing and validation, cue sheet |
| `electron/show-motions.cjs` | Motion pipeline orchestration and configuration |
| `tools/show-motion.py`, `tools/show-motion-facing.py` | Meshy, facing gate, retarget and integrate commands |
| `web/show.js` | Panel logic, preparation, prompter, revision |
| `web/show-player.js` | Performance runner with standby takeover |
| `web/show-director.js` | Persistent GPT-Live Director session |
| `web/show-cues.js` | Spoken cue phrases (English and Chinese) |
| `qa/show.cjs`, `qa/show-app.cjs`, `qa/show-live.cjs` | Unit, app-level and real-service tests |
