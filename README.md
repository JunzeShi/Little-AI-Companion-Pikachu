# Little AI Companion Pikachu

Little Companion is a macOS desktop pet that talks to a language model running on the same Mac. It can help with a document, read a selected part of the screen, run a Pomodoro, and celebrate when you finish.

## Install on a Mac

The release is a universal Mac app for Apple silicon and Intel. It requires macOS 13 or later. Screen capture requires macOS 14 or later.

1. Download the Mac ZIP from **Releases**. To move the app between Macs, share that same ZIP in Finder using **Share → AirDrop**. [Apple’s AirDrop guide](https://support.apple.com/guide/mac-help/mh35868/mac)
2. Open the ZIP on the destination Mac, move **Little Companion.app** into **Applications**, and open it. The build is ad hoc signed and has no Apple notarization. macOS may block the downloaded copy. Use the source build below as an alternative. [Apple’s guide to opening downloaded apps](https://support.apple.com/en-us/102445)
3. Install **Bionic** or **LM Studio** on that Mac and download or import a compatible model. Select a model running locally on the destination Mac. In Bionic, turn on the server under **Settings → Local Model API**. In LM Studio, start the server in **Developer**. [Bionic local models](https://lmstudio.ai/docs/bionic/models/download-local-models), [Bionic local API](https://lmstudio.ai/blog/muse-glimmer), [LM Studio local server](https://lmstudio.ai/docs/developer/core/server)
4. In Little Companion, open the gear menu, enter the local API address shown by the server, and click **Detect**. Select a model and save. A typical address is `http://127.0.0.1:1234/v1`. Model size, context length, and image support depend on your model and server. [LM Studio compatibility endpoints](https://lmstudio.ai/docs/developer/openai-compat)

The ZIP contains the app and its bundled art and fonts. Model files, previous chats, system permissions, and credentials are separate. Set **Your name (optional)** in Settings if you want a personalized greeting.

## What it does

- **Chat** streams replies, saves conversations locally, and lets you archive or delete them. Older turns can be summarized when a request approaches the estimated model context limit. The original transcript stays available in chat history.
- **Files and folders** support common documents, spreadsheets, slides, and images. The app supplies selected excerpts and searches a chosen folder by keyword. Results can miss details, and interpreting an image requires a compatible vision model.
- **Screen awareness** captures a display, window, application, or selected area on demand. A compatible local vision model can interpret the image. Otherwise, the app uses on-device text recognition when available.
- **Everyday tools** include arithmetic, model-based translation, dictation, countdown timers, a stopwatch, and Pomodoro. The morning greeting, raised-paw cheer, and fireworks for finished timers, focus sessions, and explicit “I get it” moments are adjustable in **Settings → Pet routines**. Use **Celebrate** to trigger the effect manually.

## Local data and optional services

- The app accepts loopback HTTP model addresses. Chat files are stored in `~/Library/Application Support/com.localcompanion.pet/Chats`, and app preferences use macOS preferences. Screen captures and selected document excerpts are temporary. A reply that refers to them can still appear in the saved conversation.
- New chats start with web search set to **Offline**. **Auto** and **Always** can send search queries to a search provider. Auto may use recent messages to resolve what a follow-up is asking about. Web search is skipped on requests that use selected file, folder, or screen context. You can optionally enter your own Tavily key in Settings. macOS Keychain stores the key. Free RSS sources are also available, with more limited results.
- macOS requests permission when you first use screen capture, the microphone, or notifications. Dictation uses on-device speech recognition when supported. Apple’s network speech service requires opt-in.

## Build from source

Install the Xcode Command Line Tools with `xcode-select --install`, then run these commands from the project folder.

```sh
./build-macos.sh
open 'build.noindex/Little Companion.app'
```

To install under `~/Applications`, run `./install-macos.sh`. The installer updates an existing copy with the same bundle identifier. The model server is set up separately.

To make your own transferable ZIP, run `./package-macos.sh`. It builds for your Mac and places the ZIP in `build.noindex/`. To build one ZIP for Apple silicon and Intel, run `./package-macos.sh --universal` with a macOS SDK that supports both architectures. If your default SDK lacks Intel support, set `COMPANION_MACOS_SDK` to the path to an installed SDK with Intel support, such as macOS 26.5.

The native app uses Swift, AppKit, and a local WKWebView interface. The Swift sources in `Sources/` handle the model and native tools. `index.html`, `renderer.js`, and `styles.css` implement the interface.

## Attribution

Little Companion is an unofficial fan project. Pikachu and Pokémon belong to their respective rights holders. Bundled KaTeX is distributed under its [MIT license](vendor/katex/LICENSE).
