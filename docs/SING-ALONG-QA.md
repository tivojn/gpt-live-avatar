# Sing/dance-along regression checks — 17 September 2026

These checks used the running macOS development build, not only mocked API responses. No release DMG has been produced from this working tree.

## Commands and ownership

- Typed “Sarah, sing along with this song” with a paused player returned “Nothing is playing right now.” It did not claim to have started.
- Typed “Sarah, sing a long with the song” started the actual Spotify audio tap. Ten seconds of samples contained 12 viseme classes; every automatic overhead bubble sample was hidden during the performance.
- Typed “Sarah, dance along to this song” retained dance motion with silent mouth output; “Sarah, stop dancing” stopped the session.
- A real GPT-Live connection transcribed prerecorded test speech (“Sarah, sing along with the song”, “Sarah, dance along to this song”, “Sarah stop dancing”). All three commands reached the local music controller successfully. The hardware microphone was not captured for these automated tests.
- Hanging up live talk while music continued closed the live speech output without breaking music mouth/motion output.
- Pausing Spotify stopped the performance within 713 ms in the measured run.
- In Together, typed requests made Sarah sing along and Tia dance along using one audio-tap session. Both bubbles were hidden, Tia's mouth remained silent, and Sarah's vocal gate stayed closed during the instrumental introduction.
- Stopping Sarah left Tia dancing. Each bubble returned after its actor stopped. Stopping Tia then closed the shared session.
- After the final host update, a full one-shot Kung Fu Punch run in solo mode showed the bubble before the motion, hid it during playback, completed naturally, and restored it afterward.
- Final host regressions verify that an incoming approval question and an explicitly reopened input remain accessible, and Stop cancels music startup before a session exists.

The tested tracks were Beat It and Sweet Child O' Mine. These are functional checks, not a claim of measured phoneme accuracy for those songs. Test audio and recordings are not included in the repository.

## Automated checks

The full `npm test` suite passed after integration, including new command/routing, session ownership/cancellation, live-analysis timing, audio-tap player selection, tap ownership, PCM/worklet health and vocal-detector tests. Follow-up motion-finger and bubble-priority regressions are included for their respective corrections.

## Accuracy limits

The app now uses local learned vocal-activity detection to suppress mouth motion during instruments. It still estimates phonemes from a cleaned music mixture. This is not isolated-vocal source separation, lyric transcription or exact lyric-to-viseme alignment. See [SINGING-DETECTOR-QA.md](SINGING-DETECTOR-QA.md) for held-out measurements, delays and known false positives/negatives.

The reported Meshy exports have wrist motion but no changing finger animation. The runtime now preserves true finger tracks when present; it does not invent articulation for the existing presets. See [MESHY-HAND-AUDIT.md](MESHY-HAND-AUDIT.md).

## 0.2.19 menu and composer integration

The full suite passes after integration. `qa/music-menu.cjs` exercises the real
solo and Together native menu builders with stub windows. Pending music starts
remain cancellable, unloaded actors are unavailable, and stopping a different
actor cannot cancel the pending target.

`qa/music-controls-app.cjs` runs the actual Electron solo/Together renderers with
a stubbed music request result: idle and post-conversation input, Enter/send,
clicked-character routing, focus persistence, automatic bubble suppression,
explicit reopening and restoration pass. Microphone buttons keep the existing
voice-session path; these UI checks do not open paid voice sessions.

The release checks ran on Apple M5 Max / 128 GiB, macOS 27.0. Smaller-memory
machines have not been revalidated here. Music capture requires macOS 14.4+.
