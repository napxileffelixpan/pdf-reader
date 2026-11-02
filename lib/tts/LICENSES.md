# Drittanbieter-Komponenten der neuronalen Sprachausgabe

| Datei | Projekt | Lizenz |
|---|---|---|
| `ort.wasm.min.js`, `ort-wasm*.wasm` | [onnxruntime-web 1.18.0](https://github.com/microsoft/onnxruntime) | MIT |
| `piper_phonemize.js/.wasm/.data` | [@diffusionstudio/piper-wasm 1.0.0](https://github.com/diffusion-studio/piper-wasm) – WebAssembly-Build von [piper-phonemize](https://github.com/rhasspy/piper-phonemize) (MIT) mit [eSpeak NG](https://github.com/espeak-ng/espeak-ng) | MIT; enthält eSpeak NG (GPL-3.0) |
| `piper-worker.js` | eigener Code dieser App | – |

Die Stimmenmodelle selbst sind nicht Teil dieses Repositorys. Sie werden bei der ersten Auswahl direkt von
[rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) geladen und im Browser gespeichert; es gelten die
Lizenzen aus der jeweiligen MODEL_CARD (z. B. Thorsten: CC0).
