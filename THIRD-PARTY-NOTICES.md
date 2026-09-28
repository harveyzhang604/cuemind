# Third-party notices

## Bilibili WBI signing

`extension/services/wbi.js` is adapted from `biuworks/bilibili-digest` (`lib/wbi.js`), an MIT-licensed project. The original repository's license text is preserved at `extension/licenses/bilibili-digest.txt`.

Copyright attribution in the adapted source is retained. The adaptation is limited to the WBI key derivation, MD5 signing and query serialization used to request Bilibili's player subtitle metadata.

## Research-only references

The implementation did not copy source from `VLearn` or `KISS Translator`, both of which are GPL-3.0 projects. Their public architecture and algorithm ideas informed the independent Sentence Engine design. References: https://github.com/ainiaho/VLearn and https://github.com/fishjar/kiss-translator. Historical local research notes are not part of the public installation package.

## YouTube Digest

CueMind integrates and adapts feature behavior from [zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest), reviewed at commit `bb2f7b1aedb6b50c261c0cf35b0acc7ed631d833`: optional Supadata native transcripts, local data controls, quick note feedback, exact selection notes, progressive translation, search and reading state. Copyright (c) 2026 Zara Zhang. The upstream MIT license is preserved in `extension/licenses/youtube-digest.txt`. The adaptation preserves CueMind’s native-caption path, provider selection, persistent caches and original sentence IDs. Public data flow is documented in PRIVACY.md.
