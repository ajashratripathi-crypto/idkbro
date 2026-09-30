# NexusEco AI Desktop

A minimal Windows desktop chat application that runs a GGUF language model locally with llama.cpp. The app does not include model weights: a user downloads the model once from a public direct `.gguf` URL they enter in Settings. Chat requests are sent only to the local runtime at `127.0.0.1`.

## Build the Windows installer

Use Windows 10/11 x64. Install Node.js 22 or newer, then open PowerShell in this folder:

```powershell
npm install
npm run dist:win
```

The script downloads the current official llama.cpp Windows CPU x64 release, then creates an NSIS installer under `release/`. On GitHub, push this folder as the repository root and run **Actions → Build Windows installer → Run workflow**. A tagged release such as `v0.1.0` also starts a build. Download the installer from the workflow run’s artifact.

The default runtime is CPU-only for compatibility. That is slower than GPU inference. The model is not bundled, so the installer stays much smaller; users need internet once to fetch their chosen GGUF, storage for the model, and enough RAM to load it. A 3B Q4 GGUF is typically multiple gigabytes, and exact needs depend on the file and context length. The Actions build is not code-signed, so Windows may show an unknown-publisher warning until you sign the installer with a code-signing certificate.

## First launch

1. Accept the in-app terms/privacy notice.
2. Open **Settings** and paste a public HTTPS direct link to the `.gguf` file. A Hugging Face file link usually uses `/resolve/main/<filename>.gguf` (optionally `?download=true`). The repo must be public; this app does not handle gated repositories or Hugging Face tokens.
3. Choose a model folder if you prefer an external SSD. The model is not repeatedly downloaded: it remains in that folder and the app checks for it at launch.
4. Select **Download**, then **Load model**. Start a new chat.

Downloads can be paused and resumed when the server supports HTTP range requests. The app keeps the partial file in the selected folder until the download completes.

## Known limitations

- This first build is Windows x64 only, text-only, and CPU-only. There is no web browsing, image generation, vision upload, or cloud inference.
- The configured public GGUF link is not filled in yet. Add the exact Hugging Face model file link in Settings before downloading.
- Chat history and preferences are stored in the Electron app profile on the device. The model stays in the model folder you select. Clearing chat history does not delete the model file.
- “Eco checker” records generation time, estimates local energy from a user-entered wattage, and optionally calculates a comparison from user-provided water/climate assumptions. These are not verified savings. Per-chat land or local air quality cannot be reliably measured, so no fictional value is shown.
- Policy text is a starter draft and should receive legal review before public release.

## Project structure

- `main.js`, `preload.js`: Electron main process and narrow IPC bridge.
- `renderer/`: interface, local chat history, explainers and Eco checker.
- `scripts/fetch-llama.cjs`: downloads and packages the Windows CPU runtime.
- `.github/workflows/build-windows.yml`: builds an installer and publishes it as an Actions artifact.

## Sources and notices

- llama.cpp: <https://github.com/ggml-org/llama.cpp> (MIT license; runtime release is fetched during the Windows build).
- Electron: <https://github.com/electron/electron> (MIT license; bundled with Electron Builder).
- If distributing NexusEco-3B based on Qwen2.5-3B-Instruct, preserve the base model license and attribution and comply with the terms shown on the model repository. Include the model author’s license and notice in the final distribution. The GGUF file itself is intentionally not bundled here.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) before redistributing a built installer.
