# Instinct · System One reflexes (TypeSafe Jev)

Optional. GPT-Live-1 remains the only voice and the only model that talks.
Instinct adds a second, much faster kind of model for the many small decisions
an embodied character makes: [TypeSafe Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
a "System One" model that cannot generate text. It takes state plus typed
questions and returns a yes/no probability, a choice among options you list, or
a score, in roughly 70 to 500 ms, at $0.042 per million input tokens with free
output (TypeSafe's published figures, September 2026; early access).

## What changes for the user

| Moment | Before | With Instinct |
| --- | --- | --- |
| She says "Sure, I'll try a kung fu punch" | The motion starts after the transcript segment settles (1.2 s finalize timer), then regex parsing | One request on the partial transcript; the motion starts while she is still saying the sentence |
| "Show me something triumphant" → "Watch this!" | Nothing: no regex or synonym matches | Jev chooses among the installed clips by meaning (`victory-cheer`) |
| "If I could dance all day I would. I'll do a little dance in my head." | Depends on hand-written veto lists | Commitment probability near zero vetoes the motion |
| A reaction is due and several clips qualify | `Math.random()` | The qualifying clip Jev rated the best fit for this reply |
| The user is still speaking | Fixed resting smile | Her face listens: softens for bad news, smiles at good news, laughs at a joke, before the turn ends |

## Design rules

1. **Code keeps control.** Jev only fills parameters the companion already
   validated: `clip:<installed id>`, `action:<one of the finite actions>`,
   `veto`, a reaction kind, and a per-clip ranking. The renderer checks every
   clip against the installed library again. Transcript text is untrusted; at
   worst it selects a wrong animation.
2. **Spoken refusals and grief still win.** The companion's denial and
   bereavement vetoes run before any Instinct suggestion.
3. **Never wait on a second provider.** No retries. 900 ms (reply) and 700 ms
   (listening) timeouts. Three consecutive failures pause all traffic for
   30 s. A rejected key stops traffic until the key changes. Every miss
   resolves to `null`, which means "local rules decide", exactly the behaviour
   without a key.
4. **Confidence-gated.** A finished reply acts at commitment ≥ 0.5 and choice
   probability ≥ 0.6, reacts at confidence ≥ 0.75, vetoes at commitment ≤ 0.2 with `none` ≥ 0.7, and
   otherwise defers to the local rules. An unfinished reply may only act, at
   ≥ 0.6 and ≥ 0.85, once per turn. A missing answer is never treated as "no".
5. **One request, several questions.** Jev evaluates questions in parallel
   against the same state, so commitment, clip choice and reaction share one
   round trip (TypeSafe's "speculative fan-out" pattern).

## Privacy and cost

While enabled, the text of the current exchange (and, for listening, up to
four earlier turns) is sent to `api.typesafe.ai`. Audio never is. The key is
encrypted with Electron `safeStorage` in `delegate-credentials/typesafe-key.bin`
and never enters the renderer or `config.json`. A reply request with a
62-clip library is roughly 2,000 input tokens and a turn makes at most four
early requests plus one per finished segment, so a busy hour of conversation
is on the order of a million tokens: a few cents, against roughly $3 for the
voice minutes.

## Files

- `electron/instinct.cjs`: questions, thresholds, key storage, circuit breaker.
- `web/instinct-client.js`: pacing against the transcript stream.
- `web/avatar.html`: `considerReply`, `listenTo`, resting-smile easing.
- `web/avatar3d-companion.js`: `veto`, separate `reaction`, ranked clip pick.
- `web/settings.html`: "Instinct · TypeSafe Jev" section with a Test button.

## Testing

```bash
node qa/instinct.cjs                 # unit: shapes, gates, storage, failures, pacing
npx electron qa/instinct-app.cjs     # real app, simulated Jev and voice transport
```

Neither uses a TypeSafe key or a paid voice session.

```bash
npx electron qa/instinct-live.cjs    # 48 real exchanges through Jev, under one cent
```

This one uses the key saved in the app's own profile (decrypted in-process,
never printed) and prints every raw answer beside the decision. Run it after
changing any instruction or gate in `electron/instinct.cjs`.

## Measured on jev-1.13 (2026-09-18)

- 48 of 48 cases correct after tuning (39 replies incl. Chinese, partial
  sentences, hypotheticals, refusals, past and future tense, an uninstalled
  motion, a prompt injection in the user turn; 9 listening cases).
- Latency from this Mac: median 357 ms, p90 443 ms, max 566 ms; six requests
  at once finish in about 600 ms. TypeSafe advertises 70 to 500 ms; budget a
  third of a second, not a tenth.
- About 3,000 input tokens per reply request with 62 clips; the whole run
  costs $0.006.
- **Use `net.fetch`, not Node's `fetch`.** Through Node's fetch every request
  paid a new connection (about 1.15 s). Chromium's stack holds the connection
  for at least 25 s idle (about 370 ms). The first request is still about
  1.2 s, so the renderer sends `{kind:'warm'}` when a conversation connects.
- Jev reads instructions literally, as documented. "Does she commit to a
  movement?" scored "I'll stay right here" at 0.15, because staying is not a
  movement; naming stopping, staying and following in the question fixed it.
  Loose reaction descriptions made every "Sure, ..." an `agreement` and "I love
  kung fu" an `affection`; say who the feeling is directed at.
- True commitments score 0.5 to 0.94, never near 1, while the clip choice is
  usually 0.95 or more. Gate on both and let the choice carry the precision.

## Facial expressions

`web/avatar3d-expressions.js` is the one vocabulary: 21 expressions (smile,
beam, laugh, affection, flirty, playful wink, silly, pout, proud, concern, sad,
apologetic, surprise, shock, curious, thinking, skeptical, stern, angry,
disgust, sleepy), each with the text Jev reads (`when`), a `family`, a hold
time and a recipe. Jev chooses from the whole list twice: while the user is
still talking ("which face would a listening friend show?") and while she
speaks ("which face is on her own face as she says this?"), including on
partial replies. `FaceDirector` eases and cross-fades, and gives the mouth
back to the visemes while she talks.

The five characters use four shape dialects, and the generic mood channels
are nearly invisible on some of them (on Sarah `mouthFrown*`, `browInnerUp`
and `mouthSmile*` do nothing you can see). So every recipe slot lists
alternatives, best first, and the first one a rig fully has is used:
Auto-Rig (`Brow.sad.up`, `Eye.happy`, `Mth.Sml.Cls.1`; Sarah, Seraphim),
Iselda (`Brows Worried`, `Smile Wide Open`, `Eyes Part-closed`), Ming-Mei
(`Brow sad`, `Mouth smile big-`, `Eyes wide`), Tia (ARKit brows plus her
authored `portraitSmile/Laugh/Grin`). Named shapes reach the renderer as
`expression.channels`. The renderer floors the smile at `RESTING_SMILE`, so
sadness must go through `sad`, never a lower `smile`.

How a face moves matters as much as which face. Each expression has a quick
onset (150 ms), a brief apex (600 to 1200 ms), then settles to a fainter
trace (`sustain`, 35 to 85 percent) and lets go slowly (420 ms). The same
feeling again extends the hold but never restarts the apex, and renewals are
capped (`max`), so a laugh that Jev reports four times during one reply does
not freeze on her face. A different feeling waits out a 1.1 s dwell, so she
never flickers. A laugh is a grin with squeezed eyes plus a short decaying
chuckle on the jaw (`shake`), never a held open mouth; winks, tongue and
bite-lip are pulses. Weights are modest on purpose: a listener mirrors at 0.8
of a speaker, and every showing is scaled by a random 0.88 to 1.12 so no two
smiles match. A confident `neutral` from Jev releases a lingering face early
(`relax`). She blinks as a new feeling starts (`attention.nextBlink`).

Chinese, Japanese and Korean pack a sentence into a few characters, so text
thresholds use `textWeight` (a CJK character counts as three), and listening
also runs on the final user transcript, because short lines may never yield
a usable partial. Before that fix a Chinese line drew no listening reaction at
all. 28 Chinese cases now score 27 (the one miss keeps her face still).

Decisions arriving is not the same as a face changing: check pixels.
`gla_face('angry')` shows any expression with no paid session,
`gla_face({'Brow.up': 1})` probes raw shapes when authoring, `gla_faces` lists
the names. `qa/fixtures/face-channels.json` holds each character's shape
names; `qa/instinct.cjs` fails if any expression resolves to nothing on any
character. Contact sheets of all 21 on all five are in
`build/qa-instinct-live/faces/`. Tia's rig is the thinnest: her smiles are
strong, her brows are subtle.

Gate, measured on jev-1.13: the right face often scores only 0.5 to 0.58
because a near-synonym takes the rest (sad/concern, surprise/shock). A clear
choice (confidence >= 0.6) passes alone; a split one passes when its family
holds >= 0.7, it holds >= 0.35 and `neutral` <= 0.15. With that, 35 listening
and speaking cases in English, Chinese, Spanish and Japanese score 34 right
and 1 still face, and the 39 motion cases stay 39 of 39.

Use the in-flight user segment (`live.conversation()`), not `latestUser`, as
the request text: she can start answering before the user's transcript is
final, and the stale request made her repeat the previous motion.

## Not done yet

- iOS (`ios/GPTLiveAvatar`): the same `suggestion` parameter is plumbed
  (`AvatarWebView.swift` passes `""`), so a small Swift client would bring
  parity.
- Together mode: `needsAgent`, addressee resolution and `playbackEcho` in
  `web/group-*.js` are regex decisions of the same kind.
- Music commands (`web/music-command.js`) and Avatar Show cue matching
  (`web/show-cues.js`, `lineCoverage`).
- A pre-gate for "should this turn be delegated to the reasoning model?".
