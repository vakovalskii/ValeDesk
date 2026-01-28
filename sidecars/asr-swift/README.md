# asr-sidecar (macOS)

Swift sidecar that runs offline ASR (Parakeet TDT v3 CoreML) and communicates via NDJSON over stdin/stdout.

## Build

```bash
cd LocalDesk/sidecars/asr-swift
swift build -c release
```

The binary will be at:

```bash
.build/release/asr-sidecar
```

## Run (stdin protocol)

```bash
MODELS_DIR="$HOME/Library/Application Support/ValeDesk/models"

echo '{"cmd":"init","config":{"sample_rate":16000,"mode":"file","model_key":"asr_tdt_v3"}}' > /tmp/asr.in
echo "{\"cmd\":\"file\",\"path\":\"/ABS/PATH/TO/16k_mono.wav\"}" >> /tmp/asr.in

.build/release/asr-sidecar --models-dir "$MODELS_DIR" < /tmp/asr.in
```

## Model layout expectation

`--models-dir` must contain:

- `$MODELS_DIR/parakeet-tdt-0.6b-v3-coreml/*`

For dictation (mode=`mic`), it must also contain:

- `$MODELS_DIR/silero-vad-coreml/silero-vad-unified-256ms-v6.0.0.mlmodelc/*`

