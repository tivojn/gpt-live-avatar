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
   hands all remaining lines to the standby. Reading earns time: the 25
   seconds extend while more of the line is heard, never past about a minute.
   Something off-script while your line is up ("can you do this in an Irish
   accent?") is taken as a note for the cast, not as your line, and the
   prompter stays up.
   **Notes mid-show.** Call out or type a note at any time during the
   performance. The show holds after the current line; the Director (if the
   voice is on) acknowledges it in one sentence, and the show continues by
   itself. Say **continue** (or 继续) to resume sooner. Notes such as an
   accent or a mood reach every later line as the director's ask.
   **Private notes to one character.** During a show, a character's own
   microphone (her bubble mic, or double-clicking her head) and her composer
   are steering notes to her alone: "be furious about it", "slower", "say it
   in Cantonese". By voice this is real time through gpt-live-1: the show
   holds after the current line, a short live session opens in her own voice,
   she hears you as you speak (your words appear in her bubble), and when you
   press **Done** or the mic she acknowledges in one sentence in character.
   The note then lands on her next lines and the show carries on. Typed notes
   apply without a session. Other characters never see it.
5. **Curtain call.** The Director asks how it was. Say what to change and
   press **Revise the show** (or say "revise the script"); the Playwright
   rewrites with the previous script and your feedback. **Play it again**
   repeats the performance.

Say **stop** or press **Stop** at any time; the Director keeps the script.
**Pause** (or say "pause", 等一下) holds the show after the current line;
**Resume** (or "continue") carries on.

## Recording

Tick **Record to MP4** (or click the **Record** light in the panel header,
which is grey when off, red when armed for the next show and breathes while a
show records; mid-show it starts or stops the recording) and the performance is saved
to *Movies › GPT-Live Avatar Shows* as `<title> <date>.mp4` when it finishes,
is stopped, or is interrupted. The recording is made inside the app: the
characters are composited from their own canvases onto a stage backdrop at
1280×720, every voice (the cast and the Director, including a Director already
on the line when the curtain rises) is mixed in, and captions show the
speaker's role and line. The file is written to disk as the show plays, so a
long show never sits in memory; a second recording in the same minute gets a
number instead of replacing the first. A held or paused show pauses the
recording once the hold takes effect, after the line under way, so no line is
cut short in the file. Closing the window mid-show lets the file finish
writing first. **Show recording in Finder** reveals the file; nothing leaves
the Mac.

## The panel is the window

The characters stand on the transparent desktop stage; the Avatar Show panel
is the window you work with. Its header has traffic-light close and minimize
buttons, drags the panel, and double-clicks to minimize; the corner handle
resizes it; position and size are remembered between sessions. The panel and
the prompter share the overhead bubble's design. *I'll act a role* is off by
default.

## The Director's voice and cost

The microphone button starts a live GPT-Live voice session with the Director
(billed per connected minute, muting does not stop the meter). It shows its
state: grey to start, green and breathing while listening, red with a slashed
microphone while muted. **Hang up** ends the voice session and nothing else:
the script, custom motions and the performance continue, and the phase chip
keeps counting the elapsed time. The app hangs up by itself when the
Playwright starts writing, because writing and motion preparation can take
minutes; tap the microphone to talk again, and the Director rejoins with the
current context. Joining during a performance is silent: the Director only
speaks to answer a note.

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
