# YAMNet singing activity classifier

Google's YAMNet TFJS model, version 1, downloaded 2026-09-17 from:
https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1

Model source and class map:
https://github.com/tensorflow/models/tree/master/research/audioset/yamnet

Apache License 2.0; see LICENSE. The four original float32 model weight shards
and model.json are unmodified. Classification runs locally. This model predicts
sound classes; it does not separate a vocal waveform or transcribe lyrics.

The application's activity gate uses voice-class evidence from both the raw
mono mixture and a centre-enhanced mixture. Stereo location alone never opens
the gate. Faint singing and dense arrangements can still be misclassified.
