HeadAudio by Mika Suominen — https://github.com/met4citizen/HeadAudio
Pinned revision: d3af5f9ff86ab6b2b1913d411a4e1922ec101953 (MIT).

Bundled runtime modules and model-en-mixed.bin retain the upstream license.
The English mixed-voice model contains learned MFCC/Gaussian prototypes, not a
neural network. Audio recognition is approximate, not a synthesis phoneme track.
GPT-Live Avatar supplies its own worklet lifecycle, clock alignment, playback,
and avatar integration. The classifier's voting window is reduced to 3 frames
by the adapter to retain short consonants. No training code runs in the app.
