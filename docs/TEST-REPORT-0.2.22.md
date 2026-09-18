# GPT-Live Avatar · full-scale test report

**Build under test:** v0.2.22 (milestone, commit `e8631d8`) plus the fixes made
during this pass · **Date:** 2026-09-18 · **Machine:** Apple Silicon Mac,
1512×949 work area, Electron 43 · **Role:** test engineer (function, usability,
UI and UX), with authority to fix what is clearly worth fixing.

## 1. Summary

| | |
| --- | --- |
| Automated regression | `npm test` (37 Node suites): **pass**. App-level suite (real windows, WebGL, native menus): **17 of 18 pass in the final run; the 18th (`placement-app`) is intermittent and passed 3/3 on re-run; 2 further scripts are stale and handed off** |
| Exploratory, on the real app over CDP | Solo window, Settings, Together window, Avatar Show: panel, header, prompter, recording, steering, loading, dark mode, Chinese captions, top-of-screen placement |
| Real end-to-end show | 1 show, 14 lines, real EnConvo Playwright + real GPT-Live voices, recorded to MP4 and probed with ffmpeg |
| Defects fixed | **27** product defects (4 high, 15 medium, 8 low) + copy and accessibility items |
| Your five reports from this afternoon | all five fixed and verified (section 4) |
| Requested changes | Sing-along removed; seven Meshy motions added to all five characters (section 5) |
| Test-suite repairs | 9 stale assertions corrected, 1 assertion restored, 12 new regression checks added |
| Left open | 2 stale QA scripts (`props-app`, `portrait-app`) handed off as a task; items in section 8 |

The most valuable findings were not crashes but **quiet failures**: Meshy jobs
that kept running (and billing) after Stop, a Director voice session that kept
billing when the window was hidden, recordings that lost the end of a line on
every pause, a recording lost entirely when the window was closed mid-show, a
resize corner that could not actually be grabbed, and captions that vanished
whenever a gesture played. None of these produced an error message.

## 2. Plan and method

1. **Regression baseline**: every Node suite and every non-live app-level
   script, each with a 7-minute cap, recorded pass/fail and duration.
2. **Two independent static reviews** (Show logic and state machines; copy and
   accessibility). Every finding was verified against the code before it was
   fixed; speculation was discarded.
3. **Exploratory testing on the real app** through the DevTools protocol: real
   mouse drags, DOM geometry, hit-testing (`elementsFromPoint`), emulated dark
   mode, screenshots, state timelines sampled every 250 ms.
4. **One real show** (paid voices, kept short) to validate what stubs cannot:
   captions while gestures play, the recorder with real audio, the Record light.
5. **Baseline discipline**: when a script failed, the same script was run
   against the untouched release commit (changes stashed) to separate
   regressions from pre-existing failures. A symlinked worktree proved invalid
   for this (the app refuses symlinked asset roots), which is itself recorded.
6. **Fix policy**: fix user-visible defects, stuck states, cost leaks,
   misleading copy and cheap accessibility misses; report (not change) anything
   that is a product decision.

## 3. Defects found and fixed

Severity: **H** loses money/data or blocks a feature · **M** wrong or confusing
behaviour · **L** polish, robustness.

### Avatar Show

| # | Sev | Symptom | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| 1 | H | Stop during "preparing motions" said "Preparation cancelled" but Meshy generation, Blender retarget and library integration ran on (credits spent; progress lines later overwrote the next run) | `halt()` cancelled only the Playwright scope; the jobs' `AbortController` was only reachable by the unscoped cancel | New `generate` cancel scope; `halt()` picks the scope by phase (Playwright, Meshy jobs, or a Director answer, which previously was mislabelled too) | code path + `qa/show-app` |
| 2 | H | After Stop during your line, the next thing typed to the Director vanished; on "Play it again" a stale timer wrote `0 s` to the prompter forever | the prompter's wait was never finished on Stop; its interval could not clear itself once a new wait existed | `hidePrompter()` finishes any pending wait; the interval is cleared before the ownership check | `qa/show-app` |
| 3 | H | Every pause, audience note or voice note cut the rest of the current line out of the MP4; a standby line played during a pause was missing entirely | the recorder paused when the hold was *requested*; the show only holds after the current line | the player announces when the hold *takes effect* (`stage.held`); the recorder pauses there | new `qa/show.cjs` check: order is `speak → paused → held` |
| 4 | M | Pausing during your own line did not pause your countdown; the standby took the line while the show looked paused | the prompter clock ignored the player's pause | the clock (and its ceiling) freeze while paused | code path |
| 5 | M | Closing the window mid-show lost the recording | close destroyed the window while the file was still being written | close waits for the recording to settle (20 s cap) | code path; streaming writer also keeps whatever was written |
| 6 | M | "Play it again" while the previous recording was still saving left a second recorder, audio context and canvas stream running until the window closed | a global `saving` guard returned before the new recorder was released | per-recording bookkeeping, no global guard | code path |
| 7 | M | Hiding the window ended the conversation but left the Director's per-minute voice session open indefinitely | the hidden-window stop never touched the Director | both hidden paths hang the Director up and say so | code path |
| 8 | M | Closing a character's bubble during a voice note resumed the show while her live session kept running; Escape or a click on the stage left the show held with no way back but "continue" | a guard on a variable that was never assigned (dead transcription-steer code) | `cancelSteer()`; Escape behaves like close; leaving the field empty resumes the show; dead code removed | `qa/show-app`, `qa/music-bubbles` |
| 9 | M | Pausing for breath while reading your line could turn the rest of the sentence into a "note for the cast" | the settle timer was not reset by partial transcripts | cleared on partials | code path |
| 10 | M | "Let's go with a comedy about…" hung up the Director and started writing mid-briefing | the prepare cue matched "let's go" anywhere | the phrase only counts at the end of the utterance | new cue tests |
| 11 | M | A note given on the last line left her live session open up to 45 s after the curtain | the curtain call did not end the steer session | `endSteer()` at the curtain | code path |
| 12 | M | Stop during the countdown turned the show into "curtain call": buttons said "Play it again / Revise", and Revise sent the whole briefing as "feedback" | `ready` was treated like a performance | the script stays ready; status says how to start | new `qa/show-app` scenario |
| 13 | M | A Director who was already connected when the curtain rose was missing from the recording | the recorder only learnt of the Director's stream when it connected | the stream is kept and added at recording start | code path |
| 14 | L | A 10-minute recording was held in memory and copied twice (about 1 GB transient) and written synchronously by the main process; two recordings of one title in the same minute overwrote each other | whole-file save at the end; minute-resolution file names | the file is opened at curtain-up and each encoded second is appended in order; names get ` (2)`, ` (3)`… | real show: 83.5 MB, H.264 1280×720 + AAC, 133.9 s, mean −23 dB |
| 15 | L | Screen readers re-read the whole Director chat on every partial transcript | the log was rebuilt on every event | incremental rendering; `role="log"` | DOM inspection |
| 16 | L | With the network down a 20-line show crawled through every line's timeout in silence | no bail-out | three failed lines in a row end the show with a clear message; isolated failures do not | new `qa/show.cjs` checks |
| 17 | L | A Director rejoining after the curtain greeted with "what show would you like?" | the live opening ignored the phase | opening line per phase (finished, ready, preparing, planning) | code path |
| 18 | L | Double-clicking a folded header unfolded and immediately refolded it | click and double-click both toggled | double-click only folds an open panel | code path |
| 19 | L | A recorder that failed to start leaked an `AudioContext` | no cleanup on the failure path | closed on failure | code path |
| 20 | M | The Playwright wrote the pre-filled default topic ("lost crown", 14 lines) although the briefing asked for "a lost hat, two lines each" | the request listed "Theme" and "Conversation" with no precedence | the conversation is declared the user's latest word, including counts | found in the real show; `qa/show.cjs` |
| 21 | L | Recording captions showed the role's whole description, cut mid-phrase ("…certain the crown has been:") | the Playwright may describe a role at length | the caption names the part only; the Playwright is asked for roles of at most five words | frame extracted from the real MP4 |

### Bubbles and the panel (includes your reports)

| # | Sev | Symptom | Root cause | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| 22 | H | **Show captions appeared late or not at all** | a bubble is hidden while its character's motion is active, and nearly every show line plays a gesture, so the caption only appeared once the gesture ended | a show line's caption stays up for the whole line | real show: **519 caption samples while speaking, 0 hidden, 345 of them during a gesture**; `qa/show-app` |
| 23 | M | The same rule hid her words and task progress during any gesture in the solo and Together windows (two 14 September tests asserted the opposite and had silently broken in 0.2.19) | the 0.2.19 "keep status bubbles off the performance" rule hid everything | a bare status ("Ready", "Listening") still steps aside; a fresh message or work in progress stays readable; a dance-along still clears the stage for the whole song | `controls-app`, `agent-progress-app` (restored to its original assertion), `music-bubbles` |
| 24 | M | **The bubble covered her face** when she stood near the top of the screen | the bubble was clamped to the screen and slid down over her head | when there is no room above, the bubble sits beside her head (side chosen by available room), located from the rig's own head projection | measured on the live app: no overlap, fully on screen, Chinese caption wrapping intact |
| 25 | M | **Steering bubbles lingered** after the note was taken | a voice note opened the composer and nothing closed it | the bubble closes when the note is applied, dropped or times out | `qa/show-app` |
| 26 | M | The panel's resize corner could not be grabbed: a drag on the corner fell through to the stage | the themed rule made the grip `position:absolute` but the older rule's `margin-bottom:-15px` pushed it under the panel's clipped edge; its triangular `clip-path`, its own rounded corner and the panel's 17 px radius removed the rest of the hit area (**present in 0.2.22**) | grip inset 6 px, 20×20, unclipped | real CDP mouse drag: pointer target is the grip, 610×599 → 670×649; `group-controls-app` |
| 27 | L | A synthetic wheel event on `window` threw in the solo window (`contains` on a non-Node) and the pinch did not take over from walking | handler assumed a Node target | guarded | `placement-app` now passes |

### Copy and accessibility

- README said "choose **Improvise together**" (no such format) and "three or
  more characters when you act" (two are enough); `AGENT-RUNTIMES.md` named
  v0.2.11 and omitted EnConvo.
- Settings: "Backend model for *delegated* reasoning" was shown only when
  Delegate mode is **off**; now "Model for harder questions". Three long notes
  tightened. Three controls had no accessible name (agent folder, avatar
  select, avatar folder).
- Panel: the Arrange tooltip hard-coded ⌘⇧0 although the shortcut is
  rebindable; the format select read as "Let's… combo box"; the cast list's
  label was ignored (no role); the resize handle was a dead tab stop; Pause and
  Stop had tooltips in the header but not in the panel; the hang-up tooltip was
  a paragraph; the 428-character format hint was cut to about 330.
- Prompter: a new line, the "heard" echo and the countdown were silent to
  assistive technology (now live regions and a timer); the hint said "type it
  below" while the only text box is in the folded panel.

## 4. Your five reports from this afternoon

| Report | What was done |
| --- | --- |
| Record button in the header, off by default, breathing "Recording" when the show starts with Record ticked | New **Record light** next to Pause/Stop: grey = off, red = armed for the next show (mirrors the checkbox, remembered), breathing red + "Recording" while a show records. Clicked mid-show it stops (and saves) or starts the recording. Verified in `show-app` and in the real show timeline (`Record` → `Recording*` → `Record`). |
| Bubble blocking Iselda's face | Defect 24. |
| Bubbles sticky after steering | Defect 25 (and 8 for the abandoned-note cases). |
| "Loading characters…" easier to spot, with animation | The phase chip turns accent-coloured with a spinner and the status line breathes while characters load; the Director mic and Prepare stay disabled until they appear. Sampled on the live app during a real load. |
| Bubbles delayed during the show: find out why | Defect 22: it was the hide-while-a-motion-plays rule, not latency. Fixed and measured on a real show. |

## 5. Changes you asked for during the pass

### Sing-along removed (dance-along stays)

- `web/sing.js` rewritten as dance-along only: audio tap → beat clock → dance
  clips; the mouth stays still. The lip-sync path, the developer sync source,
  the vocal-isolation chain and the vocal detector are gone.
- Deleted: `web/vocal-detector*.js`, `web/vocal-worklet.js`,
  `web/vendor/yamnet/` (**15 MB** model), `qa/vocal-detector.cjs`,
  `docs/SING-ALONG-QA.md`, `docs/SINGING-DETECTOR-QA.md`.
- Menus: **Dance Along to Current Song** and **Stop Dancing**. Agent tools:
  `dance_along`, `stop_dancing` (the `sing_along` tool is gone). The live
  prompt, the macOS audio-capture permission text, tips and handoff docs were
  updated.
- A spoken or typed "sing along" (English or Chinese) is still understood: she
  dances along and says so ("I don't sing along, but I'll dance along to …")
  rather than ignoring the request.
- Tests updated: `music-commands`, `music-routing`, `music-menu`,
  `music-controls-app`, `agent`, and `sing-session` → `dance-session`.

### Seven Meshy motions for all five characters

Fetched through the Meshy API against the **existing rig task** (nothing new was
uploaded), retargeted in Blender with the app's own pipeline (retarget v12) and
installed for Tia, Sarah, Iselda, Ming-Mei and Seraphim (92 clips each, motion
revision `presets-20260918`). 3 credits per library preset.

| Motion | Category | Source | Length |
| --- | --- | --- | --- |
| Pop Dance LSA2 | Dances | preset 80 | 11.1 s |
| Denim Pop Dance | Dances | preset 71 | 16.0 s |
| Love You Pop Dance | Dances | preset 76 | 10.0 s |
| Superlove Pop Dance | Dances | preset 83 | 8.5 s |
| Break Dance | Dances | **text-to-motion** (see note) | 6.0 s |
| Flying Fist Kick | Kung fu & fitness | preset 94 | 4.7 s |
| Counter Strike | Kung fu & fitness | preset 90 | 6.5 s |

*Break Dance:* Meshy's library has exactly one break entry, "Breakdance_1990"
(preset 395), and it is a 0.5-second acting snippet (16 frames), not a dance. It
was installed, recognised as unusable, removed, and replaced with a Meshy
text-to-motion clip (toprock, six-step floor footwork, freeze) through the same
pipeline the Show uses.

Verification: every clip prepares and plays on the solo avatar (mid-motion
screenshots reviewed), and all five Together characters load all seven with no
failures. The dances join the dance-along pool automatically; the two fighting
clips use fists like their siblings; English and Chinese aliases were added.

**Distribution note:** these live in `build/characters` (the development app
uses them immediately). A packaged install resolves motions from the published
motion pack, currently `music-pelvis-20260917` (62 clips), so **the new motions
and the Theatre/Show motions reach packaged users only after a motion update is
built and published** (`tools/build-motion-update.cjs` plus the cloud upload).
That is an outward-facing publish, so it was not done here.

## 6. Test-suite maintenance

- The first sweep launched three `--live`-only scripts without the flag; they
  sat on Electron's error dialog until the cap (one process was still alive
  three hours later and was killed). macOS has no `timeout` command; a small
  Node runner now enforces the cap.
- Stale assertions corrected: exact clip count `===62` in three scripts (the
  built libraries had 85, now 92); "bubble text" read from the whole bubble
  (which now contains the composer tip) in three places; muted listening-pill
  opacity `0.6` → `0.75`; "Always mode during dance" (a status bubble does step
  aside); the group music menu still dispatched `music:sing`.
- Restored rather than rewritten: "Long work remains visible during motion"
  was right all along; the product was wrong (defect 23).
- New regression checks: cue anchoring; hold timing; three-strike bail-out;
  captions during gestures; composer closes after a voice note; Record light
  on/off; Stop during the countdown.
- Pre-existing failures proven against the untouched release commit:
  `group-controls-app` (the resize corner, a real bug, fixed) and
  `placement-app` (fixed).
- Still failing, unrelated to this pass, handed off as a task:
  `portrait-app` (`unifiedHair` not built for the 4K portrait, with GL texture
  errors) and `props-app` (drag assertions that depend on timing and on the
  avatar starting 21 px from the stage clamp on this display).

## 7. Final automated results

`npm test` (37 Node suites): **pass** (exit 0).

App-level suite on the final code (real windows, WebGL, native menus):

| Script | Result | Time |
| --- | --- | --- |
| `show-app.cjs` | pass | 46 s |
| `group-app.cjs` | pass | 28 s |
| `group-controls-app.cjs` | pass | 13 s |
| `controls-app.cjs` | pass | 54 s |
| `placement-app.cjs` | **fail** (see note) | 96 s |
| `music-controls-app.cjs` | pass | 14 s |
| `agent-progress-app.cjs` | pass | 30 s |
| `overhead-composer-smoke.cjs` | pass | 9 s |
| `motions-app.cjs` | pass | 8 s |
| `app-smoke.cjs` | pass | 61 s |
| `instinct-app.cjs` | pass | 35 s |
| `shortcuts-app.cjs` | pass | 8 s |
| `wardrobe-app.cjs` | pass | 19 s |
| `protected-app.cjs` | pass | 11 s |
| `delegate-app.cjs` | pass | 3 s |
| `agent-app.cjs` | pass | 19 s |
| `agent-permissions-app.cjs` | pass | 6 s |
| `appearance-defaults-app.cjs` | pass | 35 s |

`placement-app` timed out once inside this long run ("Recovery restores upper right") and then passed three times in a row in isolation (8 s each): intermittent, 1 failure in 5 runs today, worth watching.

Live checks: **Instinct against real Jev** — 94 cases, 1 miss, latency min 326 / median 386 / p90 524 / max 880 ms, burst of six 831 ms, about $0.011. **Real show** — section 3, rows 14 and 22.

Not green and handed off: `portrait-app`, `props-app` (section 6).

## 8. Not tested, and why

| Item | Reason |
| --- | --- |
| Codex-backed live scripts (`codex-app`, `codex-server-app`, `codex-permissions-live`, `delegate-live`, `agent-live`) | the Codex account is out of credit; retest after the top-up |
| `installer-app` | drives the *packaged* app and downloads a 900 MB pack; it reported "Sarah unlock and pelvis fingerprints; live Tia base/motion download passed" before hitting the cap, but no DMG was built for these fixes |
| Live voice steering with a paid session | covered with a stubbed live session in `show-app`; verified live for 0.2.22 earlier today |
| `lip-sync-app`, `group-lip-sync-app`, `group-live-app`, `runtime-app`, `enconvo-app` | live/provider scripts; EnConvo was exercised for real by the end-to-end show instead |
| Multi-display, display hot-plug, low-memory Macs | single-display machine |
| A notarized build of these fixes | not requested; the fixes are source-only until the next DMG |

## 9. UX and UI recommendations (not changed; product decisions)

1. **Naming.** The window is "Avatar Show" in the menu, title and panel, but
   Settings and the README still say "Together" in eight places. Pick one.
2. **Pre-filled topic.** "A short comedy about a lost crown…" is a *value*, not
   a placeholder, so it competes with what the user tells the Director (defect
   20 fixes the precedence; a placeholder would remove the conflict).
3. **Two status lines.** In show mode the Director section and the panel foot
   show the same sentence; hide the foot line while they agree.
4. **Dark mode.** The panel, prompter and bubbles are light-only under a dark
   system appearance. Deliberate minimalism is fine, but it should be a choice.
5. **Approval wording.** "Allow for this task" sits above a note saying
   "allows are per request"; the scope of one click is unclear.
6. **Prompter input.** While the panel is folded the only way to type your
   line is to unfold it; a small field in the prompter would close the gap.
7. **"Steer" versus "note".** The solo menu says "Steer Her…", the show says
   "private note", the tips say "steer". One word would be easier to learn.
8. **Keyboard.** The panel can be folded and closed from the keyboard but not
   moved; arrow keys on the header would complete it.
9. **Internal names.** `web/sing.js` and the `gla_sing_*` entry points kept
   their names (shared by both windows and the harnesses); rename when
   convenient.
10. **Publish the motion update** (section 5) so packaged users get the
    Theatre, Show and new dance/fight motions.

## 10. Files of interest

- Show: `web/show.js`, `web/show-player.js`, `web/show-recorder.js`,
  `web/show-director.js`, `web/show-cues.js`, `electron/show.cjs`,
  `electron/show-script.cjs`, `electron/preload.cjs`
- Bubbles and panel: `web/group.js`, `web/group.html`, `web/group-panel.js`,
  `web/avatar.html`, `web/bubble-policy.js`
- Music: `web/sing.js`, `web/music-command.js`, `electron/music-menu.cjs`,
  `electron/avatar-tools.cjs`, `electron/main.cjs`
- Tests: `qa/show.cjs`, `qa/show-app.cjs`, `qa/dance-session.cjs` and the
  scripts named in section 6
- Motions: `docs/MOTION-AUDIT.md` (preset table),
  `build/motion-audit/presets-20260918/` (sources, logs, library backups)
