# CueMind · Video Reading & Replay

**Understand a whole video, one sentence at a time.**

CueMind is an open-source desktop Chrome extension for reading YouTube and Bilibili transcripts, learning with bilingual subtitles, replaying selected sentences, and keeping notes with their original sources. It can also transcribe the currently playing audio on Migu sports pages. Use it for language practice, courses, interviews, and talks.

Bring your own model account and API key. Learning records stay on your device. There is no CueMind account, developer server, credit system, or telemetry.

[Install](#install) · [Configure services](#configure-services) · [Features](#features) · [FAQ](#faq) · [简体中文](README.md)

## What can you do with it?

- **Replay exactly what you missed.** Select one sentence or several consecutive sentences, then listen once, three times, or on a loop.
- **Read the original and understand the meaning.** Switch between original, bilingual, and translated text. With a configured model, bilingual mode translates the whole video in batches.
- **Notice the vocabulary you want to learn.** Three emphasis levels reflect your exam or professional goal. Add your own glossary and mark familiar expressions as mastered.
- **Ask with the source in view.** Explain a selected word in context, or ask about a sentence, passage, or whole video. Follow citations back to the source.
- **Keep your understanding.** Press `N` while watching to capture a note with its transcript and timestamp. Search, revisit, and export it later.
- **Reuse completed work.** Restore matching transcripts and AI results locally. Interrupted tasks retain completed batches and retry missing work.

![Bilingual reading, glossary emphasis and a three-sentence replay selection](docs/assets/readme-subtitles.png)

*Actual UI using CueMind's original built-in demo. Emphasis comes from a manual glossary, with no model request. The demo supports reading, notes, and export; it does not connect to a video player.*

## Install

Use **desktop Chrome 116 or later**. You do not need Node.js, Python, or a build step for ordinary installation. CueMind currently installs as an unpacked extension.

1. Open [this repository](https://github.com/harveyzhang604/cuemind), then choose **Code → Download ZIP**, or [download the main branch directly](https://github.com/harveyzhang604/cuemind/archive/refs/heads/main.zip).
2. Extract it into a permanent folder. Keep this folder after installation.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked**.
6. Select the project's **`extension/` folder**, usually `cuemind-main/extension/` after extracting the download. This folder contains `manifest.json`.
7. Open Chrome's puzzle-piece menu and pin CueMind to the toolbar.
8. Open a YouTube or Bilibili video, click the extension icon or the video's **CueMind** button, and click **读取当前视频** (Read current video). On a Migu sports page, select a programme first, then click the CueMind toolbar icon.

**Load `extension/`, not the repository root or the ZIP file.** To explore without a video or API key, choose **先体验示例** (Try the demo). The current interface is in Chinese; labels below include translations where useful.

<details>
<summary>Install with a coding assistant</summary>

Give your assistant this prompt. Enter your keys yourself in the extension's settings.

```text
Help me install the CueMind Chrome extension:
https://github.com/harveyzhang604/cuemind

Download or clone it into a permanent local folder and retain the files.
Check extension/manifest.json and tell me the absolute path to extension/.
Guide me through enabling Developer mode at chrome://extensions,
loading that extension folder, and opening the CueMind panel on a video.
A normal installation does not require a build.
Do not read my browser profile, API keys, or learning backups.
I will enter keys myself in the extension settings; do not put them in code or Git.
```

</details>

## Configure services

**Native subtitles, search, replay, manual notes, and export do not require an API key.** Configure a text model when you want translation, explanations, Q&A, or analysis.

| What you need | Service |
| --- | --- |
| Read existing platform captions, replay, keep manual notes | None |
| Translate, explain, ask questions, generate an overview, analyze vocabulary, refine notes | Text model |
| Use a fallback to retrieve existing YouTube captions | Supadata, optional |
| Generate captions from audio when none are available | Speech transcription, optional |
| Transcribe a Migu sports programme | Speech transcription |
| Translate transcribed speech into Chinese | Text model |

### Text model: DeepSeek example

1. Create a key in your own account at the [DeepSeek API platform](https://platform.deepseek.com/api_keys). Ensure the account has an available balance.
2. Click **⚙** in the panel, then find **文本模型** (Text model).
3. Choose **DeepSeek**. The preset fills the base URL and model:

   | Setting | Value |
   | --- | --- |
   | Provider | DeepSeek |
   | API base URL | `https://api.deepseek.com` |
   | Model | `deepseek-flash` |
   | API key | Your own key, entered locally |
   | Target language | Your choice, such as Simplified Chinese |

4. Click **保存设置** (Save settings). Allow access to the service domain if Chrome asks.
5. Return to the video and select **双语** (Bilingual). Translations appear as batches complete.

These values match the current preset. Providers may change model availability; consult [DeepSeek's official documentation](https://api-docs.deepseek.com/). CueMind does not provide API credits or collect provider payments.

Settings also support OpenAI, Google Gemini, and OpenAI-compatible services, including local Ollama. Use a preset or enter your endpoint, model, and authentication details. Cloud keys are available from [OpenAI](https://platform.openai.com/api-keys), [Google AI Studio](https://aistudio.google.com/apikey), or your provider's official console.

<details>
<summary>Optional: Supadata captions</summary>

CueMind reads YouTube and Bilibili captions directly by default. Supadata is not required.

For a YouTube fallback, create a key in the [Supadata dashboard](https://dash.supadata.ai/). In **字幕服务** (Subtitle service), enter the Supadata key and choose **平台读取失败时使用 Supadata** (Use Supadata if platform reading fails), then save.

Its key is separate from the text-model key. CueMind requests existing captions only, rather than automatically generating AI captions. Bilibili continues to use direct platform reading. The video URL and source language are sent to Supadata; charges may apply.

</details>

<details>
<summary>Optional: transcribe audio</summary>

Configure Groq, OpenAI, or a timestamp-capable Whisper-compatible service in the speech section of settings. Groq keys are available from the [Groq console](https://console.groq.com/keys).

Choose **⋯ → 导入字幕与音频** (Import subtitles and audio) to import SRT/VTT, upload an audio file, or choose **识别当前视频音频** (Transcribe current video audio). CueMind captures only the playing audio, not video frames, and sends it to your selected transcription service. Playback runs at 1× so the transcript aligns with video timestamps. Transcription starts only when you request it; provider charges may apply. The panel plans the remaining video in an initial roughly 30-second segment followed by roughly two-minute segments, with status for each.

Text models, Supadata, and transcription use separate settings and keys. A video with available platform captions usually does not need a speech service.

</details>

### Migu sports videos

On a playable Migu sports programme, select the English audio programme, click the CueMind toolbar icon, then **读取当前视频 → 从当前位置连续识别** (Read current video → Transcribe continuously from the playhead). When no readable subtitle track is available, CueMind transcribes audio as it plays: the first segment is about 30 seconds and later segments are about two minutes each. The side panel lists the planned ranges through the end of the video, the current range, and each range's transcription and translation status or error. With a text model configured, successful source segments are translated automatically and bilingual captions appear progressively in the panel and over the video. Completed captions and translations remain in local storage. Continuing skips contiguous completed audio without skipping failed gaps. Programmes are stored separately.

The player must play at 1× speed. Unplayed audio cannot be transcribed in advance. Pausing, seeking, changing speed, or switching videos ends the current capture while preserving completed segments. Failed ranges show their time and error so you can seek back and retry. If Migu blocks playback because of copyright or region restrictions, CueMind cannot obtain that audio. You can import an audio or subtitle file you already have instead.

## Features

### Read and replay selected sentences

The side panel shows timestamped captions and follows the current sentence during playback. Switch between original, bilingual, and translated text. **复制 / 导出 / 读取** (Copy / Export / Read) and subtitle search are directly accessible on the toolbar.

Click a sentence to anchor your replay selection, expand it with the bottom left/right buttons, then click replay or press Space. Change **听 1 次** (Listen once) to three repetitions or a continuous loop.

| Action | Shortcut |
| --- | --- |
| Replay the selected range | `Space` |
| Leave replay and resume normal playback | `Space` during replay |
| Play or pause normally | `Space` with no armed replay range |
| Expand the selected range | Bottom arrow buttons, or two consecutive `←` / `→` presses |
| Stop replay | `Esc` |
| Search subtitles | `/` |
| Capture the current content as a note | `N` |

Typing fields retain their normal input behavior. After manually scrolling away, **当前句** (Current sentence) restores following. **字幕开头** (Transcript start) changes the reading position without seeking the video.

### Bilingual translation and vocabulary emphasis

With a text model configured, selecting bilingual or translated mode in the panel or video overlay automatically fills missing translations for the whole video, prioritizing the playback area. Each finished batch appears and is saved locally.

Open **重点** (Focus) to select CET-4, CET-6, IELTS, TOEFL, medicine, finance, computing, or a custom goal. Click **分析重点词** (Analyze focus words) to generate three emphasis levels. Results are saved separately per goal and restored when you switch back.

Adjust the sidebar, video-original, and video-translation font sizes independently. Manual glossary entries and mastered words apply immediately without a model request. AI emphasis reflects context and your goal; it is not an official exam vocabulary list.

### Explain and ask in context

Select a word or phrase and choose **解释选中内容** (Explain selection) for contextual meaning, pronunciation, and Chinese/English explanations. The background transcript stays still while the explanation dialog is open.

In **问答** (Q&A), ask about the current sentence, selected passage, or whole video. Answers include source citations and can be saved as notes. Matching explanations and answers reuse locally stored results.

### Explore an overview and keep source-linked notes

In **概览** (Overview), click **生成概览** (Generate overview) for chapters, memorable quotes, and segment explanations. **复听地图** (Replay map) in the subtitle menu helps identify passages worth listening to again.

Click **Note · N** on the video or press `N` to capture current content. The original is saved first; a configured model can refine it afterward. Notes retain timestamps and sources so you can edit, search, replay, or copy a timestamped link.

| Chapter map | Local note with its source |
| --- | --- |
| ![Chapter map from the original demo](docs/assets/readme-overview.png) | ![A note saved through the demo UI](docs/assets/readme-notes.png) |

*Both images use the built-in original demo: chapter content ships with the sample, and the note was saved manually through the actual UI. They are not real-video model results.*

### Export and back up

| Format | Use |
| --- | --- |
| TXT / SRT | Transcript text or timestamped captions for another player |
| Markdown | Continue working with learning content and notes in a notes app |
| Outline / Mermaid mind map | Take away the structure of an existing overview |
| Full JSON backup | Restore learning data through the import entry |

JSON backups remove all three settings keys. Enter them again after restoring on another device. Backups still contain learning content and should remain private. Model-response and transcription intermediate caches are excluded; missing restored results may require a first service request.

## Local data and costs

Original captions, completed translations, analyses, Q&A, and notes are stored locally. Refreshing or reopening a video prioritizes existing records. Interrupted tasks retain completed batches and retry unfinished work.

Cache matching considers content, context, endpoint, model, prompts, and other relevant settings. Changing those inputs or the learning goal may need a new result. Explicit regeneration or cache removal can also call a service again; reuse does not mean applying an old answer to every changed request.

Cloud translation, analysis, note refinement, Supadata, and audio transcription may incur provider charges. Automatic whole-video translation is a model request, too. A failed or timed-out request may still be billed. Set a spending limit with your provider and consult its current pricing.

**Keys are entered only in local settings and stored in `chrome.storage.local`, not uploaded to this repository.** Calls authenticate directly with the selected provider and send the relevant captions, questions, or audio. There is no CueMind developer server collecting this data. See [Privacy](PRIVACY.md) for the full data flow; local storage is not an encrypted password vault.

## Update

1. Export a full JSON backup if you need to preserve learning records.
2. Download the new version and replace files in the **same folder Chrome originally loaded**.
3. Open `chrome://extensions` and click CueMind's **Reload** button.
4. Refresh open video pages so they reconnect to the updated extension.

Unpacked extensions do not update automatically. Keep the original folder and avoid uninstalling to update: uninstalling deletes local extension data, and changing the folder can create a different extension identity.

## FAQ

**Can I use it without a key?** Yes: native captions, search, replay, manual notes, and export do not need one. The built-in demo also works without a key. AI features on real videos need a configured model.

**Why does bilingual mode initially show only the original?** Check the saved text-model configuration and target language. Translations arrive in batches; unfinished sentences show the original first. Retry incomplete batches after failure. A Supadata key alone cannot translate text.

**What if no captions are available?** Use a standard YouTube `/watch` or Bilibili `/video` page, refresh, and click Read. If the platform has no accessible track, try a fallback service, import SRT/VTT, or explicitly transcribe audio. Burned-in text cannot be removed from video frames.

**Why did selecting TOEFL not enlarge words?** Selecting a goal and analyzing it are separate steps. Open Focus and click Analyze focus words. Unanalyzed goals show ordinary text; manual font and glossary changes do not need AI.

**Do prompt preferences require JSON or variables?** No. Write ordinary language under **提示词偏好** (Prompt preferences), such as “Explain for a beginner, give the main idea first, then an example.” The extension retains evidence, sentence-ID, and output-format rules. Leave preferences empty to use built-in defaults.

**What should I check after an API error?** Verify the provider, endpoint, model, key, account balance, and Chrome domain permission. Service keys are not interchangeable. Retry later after rate limiting. See [Troubleshooting](docs/TROUBLESHOOTING.md), and never post a real key when reporting a problem.

**How can I free storage?** Settings show local usage and provide separate actions to clear analysis caches, delete notes, or reset all extension data. Back up first. A full reset also removes settings and keys; data does not expire automatically.

## Supported environments

| Environment | Status |
| --- | --- |
| Desktop Chrome 116+, standard YouTube / Bilibili video pages | Primary supported and tested environment; Bilibili multipart videos supported |
| Desktop Edge | Same Chromium APIs, but no independent compatibility acceptance yet |
| Firefox, Safari, mobile browsers | Not supported |
| Shorts, live streams, embedded pages, restricted videos | Platform caption retrieval not guaranteed |

AI sentence boundaries, translations, and explanations may be wrong. Caption timing is not word-level audio alignment. Check factual claims against the original source.

## Develop and contribute

Report reproducible problems through [Issues](https://github.com/harveyzhang604/cuemind/issues), including the extension version and steps. Remove keys, account details, and private content from screenshots. Follow [Security](SECURITY.md) for private vulnerability reports. Improvements and pull requests are welcome.

Development requires Node.js 22+. Browser tests additionally require Python 3.12 and the pinned Playwright version. The extension has no third-party JavaScript runtime dependencies.

```bash
git clone https://github.com/harveyzhang604/cuemind.git
cd cuemind
npm ci
npm test
npm run check
npm run format:check
npm run build
```

Builds produce extension and public-source archives, SHA-256 hashes, and file lists. An explicit public-file allowlist rejects unexpected Git files, common credential patterns, and learning backups. GitHub Actions is configured for file/key checks, unit tests, formatting, packaging, and critical browser regression tests. Real videos and paid services still require separate acceptance testing.

[Development](docs/DEVELOPMENT.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Privacy](PRIVACY.md) · [Security](SECURITY.md)

## License and acknowledgements

CueMind's own code is [MIT licensed](LICENSE). Thanks to [YouTube Digest](https://github.com/zarazhangrui/youtube-digest) for its open-source reference. The onboarding order draws on its user-oriented README; the instructions and features here describe CueMind's implementation.

Third-party code and licenses are documented in [Third-party notices](THIRD-PARTY-NOTICES.md). Public screenshots use CueMind's original demo; see [Asset provenance](docs/ASSETS.md).
